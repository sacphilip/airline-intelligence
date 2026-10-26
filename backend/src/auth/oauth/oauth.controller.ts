import { Controller, Get, Post, Delete, Param, Query, Body, Req, Res, HttpCode, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, IsNotEmpty } from 'class-validator';
import { Request, Response } from 'express';
import { AuthService } from '../auth.service';
import { COOKIE, setSessionCookie } from '../auth.controller';
import { OAuthService, CallbackResult } from './oauth.service';

class LinkDto {
  /** One-time token from the callback redirect (`link_token`). */
  @IsString()
  @IsNotEmpty()
  linkToken: string;
}

@Controller('api/auth/oauth')
export class OAuthController {
  constructor(
    private readonly oauth: OAuthService,
    private readonly auth: AuthService,
    private readonly cfg: ConfigService,
  ) {}

  private get frontend() {
    return this.cfg.get<string>('FRONTEND_URL', 'http://localhost:3000').replace(/\/+$/, '');
  }

  private async sessionUserId(req: Request): Promise<number | null> {
    const sessionId: string | undefined = req.cookies?.[COOKIE];
    const session = sessionId ? await this.auth.getSession(sessionId) : null;
    return session?.userId ?? null;
  }

  private async requireUserId(req: Request): Promise<number> {
    const id = await this.sessionUserId(req);
    if (!id) throw new UnauthorizedException('Log in first.');
    return id;
  }

  /** Configured providers, e.g. ["google", "github"]; unconfigured ones are left out. */
  @Get('providers')
  providers() {
    return this.oauth.configuredProviders();
  }

  /** Linked providers of the logged-in user, for the account page. */
  @Get('links')
  async links(@Req() req: Request) {
    return this.oauth.linkedAccounts(await this.requireUserId(req));
  }

  /** `?next=/path` to return to after sign-in; `?intent=link` from the account page. */
  @Get(':provider/start')
  async start(
    @Param('provider') provider: string,
    @Query('next') next: string | undefined,
    @Query('intent') intent: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    let linkUserId: number | undefined;
    if (intent === 'link') {
      const id = await this.sessionUserId(req);
      if (!id) return res.redirect(302, `${this.frontend}/login?next=${encodeURIComponent('/account')}`);
      linkUserId = id;
    }
    res.redirect(302, await this.oauth.start(provider, next, linkUserId));
  }

  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
    const result = await this.oauth.callback(provider, { code: str(query.code), state: str(query.state), error: str(query.error) });
    res.redirect(302, await this.redirectFor(provider, result, res));
  }

  private async redirectFor(provider: string, r: CallbackResult, res: Response): Promise<string> {
    const qs = (o: Record<string, string | undefined>) =>
      new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => !!e[1])).toString();
    switch (r.kind) {
      case 'login': {
        const { sessionId } = await this.auth.createSession(r.user);
        setSessionCookie(res, sessionId);
        return `${this.frontend}${r.next}`;
      }
      case 'link':
        return `${this.frontend}/account?${qs({ provider, link_token: r.linkToken })}`;
      case 'already_linked':
        return `${this.frontend}/account?${qs({ provider, linked: '1' })}`;
      case 'error':
        return `${this.frontend}/${r.page}?${qs({
          oauth_error: r.code,
          provider,
          link_token: r.linkToken,
          next: r.next && r.next !== '/' && r.page === 'login' ? r.next : undefined,
        })}`;
    }
  }

  /** Links the provider account from a callback (`link_token`) to the logged-in user. */
  @Post(':provider/link')
  @HttpCode(200)
  async link(@Param('provider') provider: string, @Body() body: LinkDto, @Req() req: Request) {
    return this.oauth.link(provider, body.linkToken, await this.requireUserId(req));
  }

  /** Unlinks the provider, only if the user keeps a password or another provider. */
  @Delete(':provider/link')
  async unlink(@Param('provider') provider: string, @Req() req: Request) {
    return this.oauth.unlink(provider, await this.requireUserId(req));
  }
}
