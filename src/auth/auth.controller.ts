import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Logger, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { isProd } from '../config';
import { MembersService } from '../discord/members.service';
import { SettingsService } from '../settings/settings.service';
import { type Me, type PrefsInput, prefsInput, type SetupInput, setupInput } from '../shared/schemas';
import { ZodPipe } from '../zod.pipe';
import { AuthGuard, CurrentUser, SESSION_COOKIE } from './auth.guard';
import { AuthService, SESSION_DAYS } from './auth.service';
import { PrefsService } from './prefs.service';

const STATE_COOKIE = 'deadline_oauth_state';
const cookie: CookieOptions = { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' };

@Controller()
export class AuthController {
    private readonly logger = new Logger(AuthController.name);

    constructor(
        private readonly auth: AuthService,
        private readonly settings: SettingsService,
        private readonly prefs: PrefsService,
        private readonly members: MembersService,
    ) {}

    @Get('api/prefs')
    @UseGuards(AuthGuard)
    getPrefs(@CurrentUser() user: Me) {
        return this.prefs.get(user.id);
    }

    @Put('api/prefs')
    @UseGuards(AuthGuard)
    async setPrefs(@CurrentUser() user: Me, @Body(new ZodPipe(prefsInput)) body: PrefsInput) {
        await this.prefs.set(user.id, body);
        // Player view and timezone are part of the sign-in, so the cached one goes
        await this.members.forget(user.id);
        return this.prefs.get(user.id);
    }

    /** The end of first-time setup: their timezone and whether they want reminders. */
    @Post('api/setup')
    @UseGuards(AuthGuard)
    @HttpCode(204)
    async setup(@CurrentUser() user: Me, @Body(new ZodPipe(setupInput)) body: SetupInput) {
        await this.prefs.finishSetup(user.id, user.isAdmin, body);
        await this.members.forget(user.id);
    }

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
            res.redirect('/gigs');
        } catch (err) {
            this.logger.warn(`Login failed: ${err}`);
            res.redirect('/login?error=failed');
        }
    }

    @Post('auth/logout')
    async logout(@Req() req: Request, @Res() res: Response) {
        await this.auth.end(req.cookies?.[SESSION_COOKIE]);
        res.clearCookie(SESSION_COOKIE, cookie);
        res.status(204).end();
    }

    @Get('api/me')
    @UseGuards(AuthGuard)
    me(@CurrentUser() user: Me) {
        return user;
    }

    /** The roles runners can pick, for the runner form. */
    @Get('api/roles')
    @UseGuards(AuthGuard)
    roles() {
        return this.settings.get().runnerRoles;
    }
}
