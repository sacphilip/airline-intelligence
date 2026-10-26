/**
 * Social login providers (US-012). Each one is OAuth 2.0 Authorization Code + PKCE.
 * To add a provider: add an entry here and its CLIENT_ID / CLIENT_SECRET to the environment.
 */

export interface ProviderProfile {
  providerUserId: string;
  /** Lower-cased, and only set when the provider says it is verified. */
  verifiedEmail: string | null;
  firstName: string | null;
}

export interface OAuthProvider {
  id: string;
  label: string;
  envPrefix: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Reads the profile with the access token; the token is discarded afterwards. */
  fetchProfile(accessToken: string, fetchJson: FetchJson): Promise<ProviderProfile>;
}

export type FetchJson = <T = any>(url: string, init?: RequestInit) => Promise<T>;

const firstWord = (name: unknown) =>
  typeof name === 'string' && name.trim() ? name.trim().split(/\s+/)[0].slice(0, 100) : null;

export const PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    id: 'google',
    label: 'Google',
    envPrefix: 'GOOGLE',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    async fetchProfile(token, fetchJson) {
      const p = await fetchJson<{ sub: string; email?: string; email_verified?: boolean; given_name?: string; name?: string }>(
        'https://openidconnect.googleapis.com/v1/userinfo',
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return {
        providerUserId: String(p.sub),
        verifiedEmail: p.email && p.email_verified === true ? p.email.toLowerCase().trim() : null,
        firstName: firstWord(p.given_name) ?? firstWord(p.name),
      };
    },
  },
  github: {
    id: 'github',
    label: 'GitHub',
    envPrefix: 'GITHUB',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    async fetchProfile(token, fetchJson) {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'flight-tracker' };
      const user = await fetchJson<{ id: number; login: string; name?: string | null }>('https://api.github.com/user', { headers });
      // The profile email can be unverified or hidden; use the primary verified address.
      const emails = await fetchJson<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', { headers });
      const primary = emails.find((e) => e.primary && e.verified) ?? null;
      return {
        providerUserId: String(user.id),
        verifiedEmail: primary ? primary.email.toLowerCase().trim() : null,
        firstName: firstWord(user.name) ?? firstWord(user.login),
      };
    },
  },
};
