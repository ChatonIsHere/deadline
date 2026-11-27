import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, type OnGatewayConnection, type OnGatewayDisconnect, type OnGatewayInit, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { canSee, ChatsService, speakable } from '../chats/chats.service';
import type { Me, TypingEvent } from '../shared/schemas';
import { isUuid } from '../shared/slug';
import { LiveService, SIGNED_IN, userRoom } from './live.service';

/** Typing pings per socket: one every few seconds is plenty. */
const TYPING_GAP_MS = 2500;

/** One cookie from a Cookie header. */
function cookie(header: string | undefined, name: string): string | undefined {
    for (const part of header?.split(';') ?? []) {
        const [key, ...value] = part.trim().split('=');
        if (key === name) return decodeURIComponent(value.join('='));
    }
    return undefined;
}

interface SocketData {
    user: Me;
    /** The session cookie, to look them up again: their roles or player view may have changed since they connected */
    session?: string;
    lastTyping?: number;
}

/**
 * Socket.IO at /live, the same way the Dox Box API does it for Portal and Quinn. Browsers
 * sign in with their session cookie and hear `changed` with the topics to refetch, and `chat`
 * events for their own chats (each person has a room). The only things browsers send are
 * which chat they're looking at, and that they're typing in one.
 */
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(LiveGateway.name);

    constructor(
        private readonly live: LiveService,
        private readonly auth: AuthService,
        private readonly chats: ChatsService,
    ) {}

    afterInit(namespace: Namespace) {
        this.live.attach(namespace);
    }

    async handleConnection(client: Socket) {
        const session = cookie(client.handshake.headers.cookie, SESSION_COOKIE);
        const user = await this.auth.user(session).catch((err) => {
            this.logger.warn(`Couldn't check a live connection: ${(err as Error).message}`);
            return null;
        });
        if (!user) {
            client.disconnect(true);
            return;
        }
        (client.data as SocketData) = { user, session };
        await client.join([SIGNED_IN, userRoom(user.id)]);
    }

    handleDisconnect(client: Socket) {
        const data = client.data as SocketData | undefined;
        if (data?.user) this.live.setViewing(client.id, data.user.id, null);
    }

    /** Who's on this socket now (cached for a minute, like every request), or null once they're signed out. */
    private async current(client: Socket): Promise<SocketData | null> {
        const data = client.data as SocketData | undefined;
        if (!data?.user) return null;
        const user = await this.auth.user(data.session).catch(() => data.user);
        if (!user) return null;
        data.user = user;
        return data;
    }

    /** The chat this page has open and in view, or null. Nobody gets a notification for a chat in front of them. */
    @SubscribeMessage('viewing')
    async viewing(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: unknown }) {
        const data = await this.current(client);
        if (!data) return;
        const chatId = typeof body?.chatId === 'string' && isUuid(body.chatId) ? body.chatId : null;
        if (chatId) {
            const chat = await this.chats.find(chatId);
            if (!chat || !canSee(data.user, chat)) return;
        }
        this.live.setViewing(client.id, data.user.id, chatId);
    }

    /** Someone's typing as one of their characters. The chat's other people hear, briefly. */
    @SubscribeMessage('typing')
    async typing(@ConnectedSocket() client: Socket, @MessageBody() body: { chatId?: unknown; runnerId?: unknown }) {
        const data = await this.current(client);
        if (!data || typeof body?.chatId !== 'string' || typeof body.runnerId !== 'string' || !isUuid(body.chatId)) return;
        const now = Date.now();
        if (data.lastTyping && now - data.lastTyping < TYPING_GAP_MS) return;
        data.lastTyping = now;
        const chat = await this.chats.find(body.chatId);
        if (!chat || !canSee(data.user, chat)) return;
        const runner = speakable(data.user, chat).find((r) => r.id === body.runnerId);
        if (!runner) return;
        const people = (await this.chats.audience(chat)).filter((id) => id !== data.user.id);
        this.live.toUsers(people, 'typing', { chatId: chat.id, runnerId: runner.id, handle: runner.handle } satisfies TypingEvent);
    }
}
