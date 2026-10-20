import { Controller, Post, Get, Body, Res, Req, HttpCode, UnauthorizedException } from '@nestjs/common';
import { IsEmail, IsString, IsNotEmpty } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @IsNotEmpty()
  password: string;
}

const COOKIE = 'sid';
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const ip = forwarded?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? 'unknown';
    const identifier = `${body.email.toLowerCase().trim()}:${ip}`;

    try {
      const { sessionId, user } = await this.auth.login(body.email, body.password, identifier);
      res.cookie(COOKIE, sessionId, { httpOnly: true, sameSite: 'lax', maxAge: MAX_AGE, path: '/' });
      return { id: user.userId, email: user.email, firstName: user.firstName };
    } catch (e: any) {
      const msg = e?.message;
      if (msg === 'TOO_MANY_ATTEMPTS') throw new UnauthorizedException('Too many attempts. Try again in 15 minutes.');
      throw new UnauthorizedException('Incorrect email or password.');
    }
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId: string | undefined = req.cookies?.[COOKIE];
    if (sessionId) await this.auth.logout(sessionId);
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async me(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const sessionId: string | undefined = req.cookies?.[COOKIE];
    if (!sessionId) { res.json(null); return; }
    const session = await this.auth.getSession(sessionId);
    if (!session) { res.json(null); return; }
    return { id: session.userId, email: session.email, firstName: session.firstName };
  }
}
