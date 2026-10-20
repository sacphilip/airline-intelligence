import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User } from './user.entity';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

interface RateLimitData {
  attempts: number;
  firstAt: number;
  lockedUntil?: number;
}

export interface SessionData {
  userId: number;
  email: string;
  firstName: string | null;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  async login(email: string, password: string, identifier: string): Promise<{ sessionId: string; user: SessionData }> {
    const rlKey = `auth:rl:${identifier}`;
    const rl: RateLimitData = (await this.cache.get<RateLimitData>(rlKey)) ?? { attempts: 0, firstAt: Date.now() };

    if (rl.lockedUntil && Date.now() < rl.lockedUntil) {
      throw new UnauthorizedException('TOO_MANY_ATTEMPTS');
    }

    const normalised = email.toLowerCase().trim();
    const user = await this.users.findOne({ where: { email: normalised } });
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;

    if (!valid) {
      const withinWindow = (Date.now() - rl.firstAt) < WINDOW_MS;
      const attempts = withinWindow ? rl.attempts + 1 : 1;
      const firstAt = withinWindow ? rl.firstAt : Date.now();
      const lockedUntil = attempts >= MAX_ATTEMPTS ? Date.now() + LOCKOUT_MS : undefined;
      await this.cache.set(rlKey, { attempts, firstAt, lockedUntil } satisfies RateLimitData, WINDOW_MS);
      throw new UnauthorizedException(lockedUntil ? 'TOO_MANY_ATTEMPTS' : 'INVALID_CREDENTIALS');
    }

    await this.cache.del(rlKey);

    const sessionId = crypto.randomUUID();
    const sessionData: SessionData = { userId: user!.id, email: user!.email, firstName: user!.firstName };
    await this.cache.set(`auth:sess:${sessionId}`, sessionData, SESSION_TTL_MS);
    return { sessionId, user: sessionData };
  }

  async logout(sessionId: string): Promise<void> {
    await this.cache.del(`auth:sess:${sessionId}`);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    return (await this.cache.get<SessionData>(`auth:sess:${sessionId}`)) ?? null;
  }
}
