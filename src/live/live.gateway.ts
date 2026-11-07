import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, type OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { LiveService } from './live.service';

const SIGNED_IN = 'signed-in';

/** One cookie from a Cookie header. */
function cookie(header: string | undefined, name: string): string | undefined {
    for (const part of header?.split(';') ?? []) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return decodeURIComponent(value.join('='));
    }
    return undefined;
}

/**
 * Socket.IO at /live, the same way the Dox Box API does it for Portal and Quinn. Browsers
 * sign in with their session cookie and hear `changed` with the topics to refetch. Nothing
 * comes back the other way.
 */
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection {
    private readonly logger = new Logger(LiveGateway.name);

    constructor(
        private readonly live: LiveService,
        private readonly auth: AuthService,
    ) {}

    afterInit(namespace: Namespace) {
        this.live.attach(namespace.to(SIGNED_IN));
    }

    async handleConnection(client: Socket) {
        const user = await this.auth.user(cookie(client.handshake.headers.cookie, SESSION_COOKIE)).catch((err) => {
            this.logger.warn(`Couldn't check a live connection: ${(err as Error).message}`);
            return null;
        });
        if (!user) {
            client.disconnect(true);
            return;
        }
        await client.join(SIGNED_IN);
    }
}
