import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Not, Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';
import { User } from '../user.entity';
import { UserIdentity } from './user-identity.entity';
import { PROVIDERS, OAuthProvider, FetchJson } from './oauth.providers';

const PROVIDER_TIMEOUT_MS = 10_000;

/** What the frontend shows for each failure (see frontend/src/components/auth/oauth-messages.ts). */
export type OAuthErrorCode = 'cancelled' | 'failed' | 'expired' | 'no_email' | 'exists' | 'linked_other';

interface OAuthState {
  provider: string;
  verifier: string;
  next: string;
  /** Set when a logged-in user is linking from the account page. */
  linkUserId?: number;
}

/** A verified provider account waiting to be linked to `userId` by POST /link. */
interface PendingLink {
  provider: string;
  providerUserId: string;
  email: string;
  userId: number;
}

export type CallbackResult =
  | { kind: 'login'; user: User; next: string }
  | { kind: 'link'; linkToken: string; next: string }
  | { kind: 'already_linked'; next: string }
  | { kind: 'error'; code: OAuthErrorCode; page: 'login' | 'account'; next?: string; linkToken?: string };

export interface LinkedAccounts {
  hasPassword: boolean;
  linked: { provider: string; email: string; linkedAt: Date }[];
}

const b64url = (buf: Buffer) => buf.toString('base64url');

/** Only a path on this site: no scheme, no protocol-relative `//host`, no backslash tricks. */
export function safeNext(next: unknown): string {
  if (typeof next !== 'string' || next.length > 2048) return '/';
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\\]/.test(next)) return '/';
  return next;
}

@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
    private readonly cfg: ConfigService,
    private readonly db: DataSource,
  ) {}

  private get stateTtlMs() {
    return Number(this.cfg.get('OAUTH_STATE_TTL_MINS', 10)) * 60 * 1000;
  }

  private credentials(p: OAuthProvider) {
    const clientId = this.cfg.get<string>(`${p.envPrefix}_CLIENT_ID`);
    const clientSecret = this.cfg.get<string>(`${p.envPrefix}_CLIENT_SECRET`);
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  /** Providers with a client ID and secret; the others' buttons are hidden. */
  configuredProviders(): string[] {
    return Object.values(PROVIDERS).filter((p) => this.credentials(p)).map((p) => p.id);
  }

  provider(id: string): OAuthProvider {
    const p = PROVIDERS[id];
    if (!p || !this.credentials(p)) throw new NotFoundException(`Sign-in with "${id}" is not available.`);
    return p;
  }

  private redirectUri(p: OAuthProvider) {
    const base = this.cfg.get<string>('OAUTH_REDIRECT_BASE_URL', 'http://localhost:3100').replace(/\/+$/, '');
    return `${base}/api/auth/oauth/${p.id}/callback`;
  }

  /** Read and delete in one go: state values and link tokens are single-use. */
  private async take<T>(key: string): Promise<T | null> {
    const value = (await this.cache.get<T>(key)) ?? null;
    if (value) await this.cache.del(key);
    return value;
  }

  /** Creates `state` + a PKCE verifier (Redis, OAUTH_STATE_TTL_MINS) and returns the provider's consent URL. */
  async start(providerId: string, next: unknown, linkUserId?: number): Promise<string> {
    const p = this.provider(providerId);
    const { clientId } = this.credentials(p)!;
    const state = b64url(crypto.randomBytes(24));
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const data: OAuthState = { provider: p.id, verifier, next: linkUserId ? '/account' : safeNext(next), ...(linkUserId ? { linkUserId } : {}) };
    await this.cache.set(`oauth:state:${state}`, data, this.stateTtlMs);

    const url = new URL(p.authorizeUrl);
    url.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(p),
      response_type: 'code',
      scope: p.scope,
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }

  async callback(providerId: string, q: { code?: string; state?: string; error?: string }): Promise<CallbackResult> {
    const p = this.provider(providerId);
    // A missing, expired, already-used or other-provider state aborts sign-in (replay protection).
    const st = typeof q.state === 'string' && q.state ? await this.take<OAuthState>(`oauth:state:${q.state}`) : null;
    if (!st || st.provider !== p.id) return { kind: 'error', code: 'expired', page: 'login' };

    const page = st.linkUserId ? 'account' : 'login';
    if (q.error) return { kind: 'error', code: q.error === 'access_denied' ? 'cancelled' : 'failed', page, next: st.next };
    if (!q.code) return { kind: 'error', code: 'failed', page, next: st.next };

    let profile;
    try {
      const accessToken = await this.exchangeCode(p, q.code, st.verifier);
      profile = await p.fetchProfile(accessToken, this.fetchJson);
      // accessToken goes out of scope here: provider tokens are never stored.
    } catch (e: any) {
      this.log.warn(`${p.id} sign-in failed: ${e?.message ?? e}`);
      return { kind: 'error', code: 'failed', page, next: st.next };
    }
    if (!profile.verifiedEmail) return { kind: 'error', code: 'no_email', page, next: st.next };

    const identity = await this.identities.findOne({ where: { provider: p.id, providerUserId: profile.providerUserId } });
    const pending = (userId: number): PendingLink => ({ provider: p.id, providerUserId: profile.providerUserId, email: profile.verifiedEmail!, userId });

    // Linking from the account page.
    if (st.linkUserId) {
      if (identity) {
        return identity.userId === st.linkUserId
          ? { kind: 'already_linked', next: st.next }
          : { kind: 'error', code: 'linked_other', page: 'account' };
      }
      return { kind: 'link', linkToken: await this.savePendingLink(pending(st.linkUserId)), next: st.next };
    }

    // Returning user.
    if (identity) {
      const user = await this.users.findOne({ where: { id: identity.userId } });
      if (!user) return { kind: 'error', code: 'failed', page: 'login', next: st.next };
      return { kind: 'login', user, next: st.next };
    }

    // Same email, not linked: link only after a password login proves ownership.
    const existing = await this.users.findOne({ where: { email: profile.verifiedEmail } });
    if (existing) {
      return { kind: 'error', code: 'exists', page: 'login', next: st.next, linkToken: await this.savePendingLink(pending(existing.id)) };
    }

    // New user: account from the provider profile (first name + email), no password.
    try {
      const user = await this.db.transaction(async (m) => {
        const created = await m.save(m.create(User, { email: profile.verifiedEmail!, passwordHash: null, firstName: profile.firstName }));
        await m.save(m.create(UserIdentity, { userId: created.id, provider: p.id, providerUserId: profile.providerUserId, email: profile.verifiedEmail! }));
        return created;
      });
      return { kind: 'login', user, next: st.next };
    } catch (e: any) {
      this.log.warn(`${p.id} sign-up failed: ${e?.message ?? e}`);
      return { kind: 'error', code: 'failed', page: 'login', next: st.next };
    }
  }

  private async savePendingLink(link: PendingLink): Promise<string> {
    const token = b64url(crypto.randomBytes(24));
    await this.cache.set(`oauth:link:${token}`, link, this.stateTtlMs);
    return token;
  }

  /** POST /link: attach the provider account from a callback to the logged-in user. */
  async link(providerId: string, linkToken: string, userId: number): Promise<LinkedAccounts> {
    const p = this.provider(providerId);
    const pending = await this.take<PendingLink>(`oauth:link:${linkToken}`);
    if (!pending || pending.provider !== p.id) throw new BadRequestException(`This ${p.label} link request has expired. Please try again.`);
    if (pending.userId !== userId) throw new ForbiddenException(`This ${p.label} account can only be linked to the account with the same email.`);

    const identity = await this.identities.findOne({ where: { provider: p.id, providerUserId: pending.providerUserId } });
    if (identity && identity.userId !== userId) throw new ConflictException(`This ${p.label} account is linked to another user.`);
    if (!identity) {
      try {
        await this.identities.save(this.identities.create({ userId, provider: p.id, providerUserId: pending.providerUserId, email: pending.email }));
      } catch {
        // Unique (provider, provider_user_id): someone linked it in the meantime.
        throw new ConflictException(`This ${p.label} account is linked to another user.`);
      }
    }
    return this.linkedAccounts(userId);
  }

  /** DELETE /link: only while the user keeps another way to log in. */
  async unlink(providerId: string, userId: number): Promise<LinkedAccounts> {
    const p = PROVIDERS[providerId];
    if (!p) throw new NotFoundException(`Unknown provider "${providerId}".`);
    const identity = await this.identities.findOne({ where: { userId, provider: p.id } });
    if (!identity) throw new NotFoundException(`${p.label} isn't linked to your account.`);
    const user = await this.users.findOne({ where: { id: userId } });
    const others = await this.identities.count({ where: { userId, provider: Not(p.id) } });
    if (!user?.passwordHash && others === 0) {
      throw new BadRequestException(`${p.label} is your only way to log in. Link another provider before unlinking it.`);
    }
    await this.identities.delete({ id: identity.id });
    return this.linkedAccounts(userId);
  }

  async linkedAccounts(userId: number): Promise<LinkedAccounts> {
    const user = await this.users.findOne({ where: { id: userId } });
    const rows = await this.identities.find({ where: { userId }, order: { createdAt: 'ASC' } });
    return {
      hasPassword: !!user?.passwordHash,
      linked: rows.map((r) => ({ provider: r.provider, email: r.email, linkedAt: r.createdAt })),
    };
  }

  private async exchangeCode(p: OAuthProvider, code: string, verifier: string): Promise<string> {
    const { clientId, clientSecret } = this.credentials(p)!;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(p),
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: verifier,
    });
    const res = await this.fetchJson<{ access_token?: string; error?: string }>(p.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    // GitHub answers 200 with { error } when the exchange fails.
    if (!res.access_token) throw new Error(`token exchange failed: ${res.error ?? 'no access_token'}`);
    return res.access_token;
  }

  private readonly fetchJson: FetchJson = async (url, init) => {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`${new URL(url).host} → ${res.status}`);
    return res.json();
  };
}
