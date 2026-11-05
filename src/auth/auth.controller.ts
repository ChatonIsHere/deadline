import { randomBytes } from 'node:crypto';
import { Controller, Get, Logger, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { isProd } from '../config';
import { MembersService } from '../discord/members.service';
import type { Me } from '../shared/schemas';
import { AuthGuard, CurrentUser, SESSION_COOKIE } from './auth.guard';
import { AuthService, SESSION_DAYS } from './auth.service';

const STATE_COOKIE = 'deadline_oauth_state';
const cookie: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' };

@Controller()
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(
        private readonly auth: AuthService,
        private readonly members: MembersService,
    ) {}

    @Get('auth/login')
    login(@Res() res: Response) {
        const state = randomBytes(16).toString('hex');
        res.cookie(STATE_COOKIE, state, { ...cookie, maxAge: 10 * 60_000 });
        res.redirect(this.auth.loginUrl(state));
    }

    @Get('auth/callback')
    async callback(@Query('code') code: string, @Query('state') state: string, @Req() req: Request, @Res() res: Response) {
        res.clearCookie(STATE_COOKIE, cookie);
        if (!code || !state || state !== req.cookies?.[STATE_COOKIE]) return res.redirect('/login?error=state');

        try {
            const sessionId = await this.auth.start(await this.auth.discordUserId(code));
            if (!sessionId) return res.redirect('/login?error=denied');
            res.cookie(SESSION_COOKIE, sessionId, { ...cookie, maxAge: SESSION_DAYS * 86_400_000 });
            res.redirect('/');
        } catch (err) {
            this.logger.warn(`Login failed: ${err}`);
            res.redirect('/login?error=failed');
        }
    }

    @Post('auth/logout')
    logout(@Req() req: Request, @Res() res: Response) {
        this.auth.end(req.cookies?.[SESSION_COOKIE]);
        res.clearCookie(SESSION_COOKIE, cookie);
        res.status(204).end();
    }

    @Get('api/me')
    @UseGuards(AuthGuard)
    me(@CurrentUser() user: Me) {
        return user;
    }

    /** Edgerunners, for adding people to crews. */
    @Get('api/members')
    @UseGuards(AuthGuard)
    list() {
        return this.members.edgerunners();
    }
}
