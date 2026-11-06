import { randomBytes } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Client } from 'discord.js';
import { CacheService } from '../cache/cache.service';
import { config } from '../config';
import { MembersService } from '../discord/members.service';
import { canLogIn } from '../shared/permissions';
import type { Me } from '../shared/schemas';

export const SESSION_DAYS = 30;
const DISCORD_API = 'https://discord.com/api/v10';

/** Sessions live in the cache (Redis), expiring on their own. A session is just whose it is. */
const sessionKey = (id: string) => `sess:${id}`;

@Injectable()
export class AuthService {
    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly members: MembersService,
        private readonly cache: CacheService,
    ) {}

    /** The bot's application ID doubles as the OAuth client ID. */
    private get clientId(): string {
        const id = this.client.application?.id;
        if (!id) throw new ServiceUnavailableException('The bot is still connecting. Try again in a moment.');
        return id;
    }

    loginUrl(state: string): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: `${config.PUBLIC_URL}/auth/callback`,
            response_type: 'code',
            scope: 'identify',
            state,
            prompt: 'none',
        });
        return `https://discord.com/oauth2/authorize?${params}`;
    }

    /** Swaps an OAuth code for the Discord user's ID. */
    async discordUserId(code: string): Promise<string> {
        const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: config.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: `${config.PUBLIC_URL}/auth/callback`,
            }),
        });
        if (!tokenRes.ok) throw new Error(`Token exchange failed: ${tokenRes.status}`);
        const { access_token } = (await tokenRes.json()) as { access_token: string };

        const userRes = await fetch(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${access_token}` } });
        if (!userRes.ok) throw new Error(`User lookup failed: ${userRes.status}`);
        return ((await userRes.json()) as { id: string }).id;
    }

    /** A new session for someone allowed in, or null if they aren't. */
    async start(userId: string): Promise<string | null> {
        const me = await this.members.me(userId);
        if (!me || !canLogIn(me)) return null;

        const id = randomBytes(32).toString('base64url');
        await this.cache.set(sessionKey(id), { userId }, SESSION_DAYS * 86_400);
        return id;
    }

    /** The signed in user. Roles are checked live (cached a minute), so losing a role takes effect quickly. */
    async user(sessionId: string | undefined): Promise<Me | null> {
        if (!sessionId) return null;
        const session = await this.cache.get<{ userId: string }>(sessionKey(sessionId));
        if (!session) return null;

        const me = await this.members.me(session.userId);
        return me && canLogIn(me) ? me : null;
    }

    async end(sessionId: string | undefined) {
        if (sessionId) await this.cache.del(sessionKey(sessionId));
    }
}
