import '../test-env';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { Collection, type Client } from 'discord.js';
import { CacheService } from '../cache/cache.service';
import type { ChatRow, ChatsService } from '../chats/chats.service';
import type { LibraryService } from '../library/library.service';
import type { LiveService } from '../live/live.service';
import type { SettingsService } from '../settings/settings.service';
import type { Me } from '../shared/schemas';
import type { StorageService } from '../storage/storage.service';
import { ChatRelayService, hookName, type Pending, pendingKey, threadName } from './chat-relay.service';
import type { MembersService } from './members.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({ id, name: id, avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: true, timezone: null, needsSetup: false, ...roles });
const people = [person('a'), person('b'), person('admin', { isAdmin: true })];

const runner = (id: string, ownerId: string | null, handle = id) => ({ id, ownerId, handle, status: 'active' as const, imageId: null, slug: id, fixerSlug: null });
/** A group chat between these runners, with a thread. */
const chatWith = (...runners: ReturnType<typeof runner>[]) =>
    ({
        id: 'chat',
        kind: 'group',
        name: null,
        crewId: null,
        gigId: null,
        threadId: 'thread',
        archivedAt: null,
        crew: null,
        gig: null,
        staff: [],
        members: runners.map((r) => ({ chatId: 'chat', runnerId: r.id, joinedAt: new Date(), runner: r })),
    }) as unknown as ChatRow;

describe('ChatRelayService', () => {
    let relay: ChatRelayService;
    let cache: CacheService;
    let chat: ChatRow | null;
    let voice: string | null;
    let sent: { user: string; runner: string; body: string; kept?: string }[];
    let threadPosts: string[];

    /** A message typed in the thread. */
    const typed = (authorId: string, content: string, extra: Record<string, unknown> = {}) => {
        const message = {
            author: { id: authorId, bot: false },
            webhookId: null,
            system: false,
            channelId: 'thread',
            content,
            attachments: new Collection(),
            deleted: false,
            channel: {
                isThread: () => true,
                send: async (m: { content: string }) => {
                    threadPosts.push(m.content);
                    return { delete: async () => {} };
                },
            },
            delete: async () => {
                message.deleted = true;
            },
            ...extra,
        };
        return message;
    };
    const receive = (message: ReturnType<typeof typed>) => relay.onMessage([message] as never);

    beforeEach(() => {
        chat = chatWith(runner('vex', 'a'), runner('kade', 'b'));
        voice = null;
        sent = [];
        threadPosts = [];
        cache = new CacheService();
        const chats = {
            attachRelay: () => {},
            byThread: async (id: string) => (chat?.threadId === id ? chat : null),
            voice: async () => voice,
            send: async (user: Me, _chatId: string, input: { asRunnerId: string; body: string }, opts: { discordMessageId?: string } = {}) => {
                sent.push({ user: user.id, runner: input.asRunnerId, body: input.body, kept: opts.discordMessageId });
                return { id: 'm1' };
            },
            audience: () => [],
        } as unknown as ChatsService;
        const members = { me: async (id: string) => people.find((p) => p.id === id) ?? null } as unknown as MembersService;
        const settings = { get: () => ({ dmChannelId: null }), onSave: () => {} } as unknown as SettingsService;
        relay = new ChatRelayService({} as Client, chats, settings, members, {} as LibraryService, {} as StorageService, cache, { toUsers: () => {} } as unknown as LiveService);
    });

    it('swaps a typed message for one from the player’s character', async () => {
        const message = typed('a', 'meet at the Afterlife');
        await receive(message);
        assert.equal(message.deleted, true);
        assert.deepEqual(sent, [{ user: 'a', runner: 'vex', body: 'meet at the Afterlife', kept: undefined }]);
    });

    it('ignores the webhook’s own posts, bots and other threads', async () => {
        await receive(typed('a', 'echo', { webhookId: 'hook' }));
        await receive(typed('a', 'bot', { author: { id: 'a', bot: true } }));
        await receive(typed('a', 'elsewhere', { channelId: 'other' }));
        assert.deepEqual(sent, []);
    });

    it('turns away someone with no character in the chat', async () => {
        const message = typed('admin', 'hello?');
        await receive(message);
        assert.equal(message.deleted, true);
        assert.deepEqual(sent, []);
        assert.match(threadPosts[0], /can't speak in this chat/);
    });

    it('asks which character when there are several, then uses the one remembered', async () => {
        chat = chatWith(runner('vex', 'a'), runner('nyx', 'a'), runner('kade', 'b'));
        await receive(typed('a', 'who am I?'));
        assert.deepEqual(sent, []);
        assert.match(threadPosts[0], /speak as which character/);

        voice = 'nyx';
        await receive(typed('a', "it's me"));
        assert.deepEqual(sent, [{ user: 'a', runner: 'nyx', body: "it's me", kept: undefined }]);
    });

    it('holds the message for the pick', async () => {
        chat = chatWith(runner('vex', 'a'), runner('nyx', 'a'), runner('kade', 'b'));
        // The prompt's buttons carry a token for the held message
        let token = '';
        const message = typed('a', 'held', {
            channel: {
                isThread: () => true,
                send: async (m: { components: { components: { custom_id: string }[] }[] }) => {
                    token = m.components[0].components[0].custom_id.split('/')[2];
                    return { delete: async () => {} };
                },
            },
        });
        await receive(message);
        const pending = await cache.get<Pending>(pendingKey(token));
        assert.deepEqual(pending, { chatId: 'chat', userId: 'a', body: 'held', imageIds: [] });
    });

    it('keeps a message with files other than pictures, recorded under the character', async () => {
        const attachments = new Collection([['1', { name: 'plan.pdf', contentType: 'application/pdf', size: 100, url: 'x' }]]);
        const message = typed('a', 'the plans', { attachments, id: 'original' });
        await receive(message);
        assert.equal(message.deleted, false);
        assert.deepEqual(sent, [{ user: 'a', runner: 'vex', body: 'the plans\n📎 plan.pdf', kept: 'original' }]);
    });

    it('catches up on what was typed in a thread while it was offline, oldest first, at the time it was typed', async () => {
        const at = (minutes: number) => new Date(Date.UTC(2026, 10, 27, 12, minutes));
        const missed = [typed('b', 'second'), typed('a', 'first'), typed('a', 'webhook copy', { webhookId: 'hook' })].map((m, i) =>
            Object.assign(m, { id: `m${i}`, createdAt: at([5, 1, 3][i]), createdTimestamp: at([5, 1, 3][i]).getTime() }),
        );
        let after = '';
        const thread = { id: 'thread', isThread: () => true, messages: { fetch: async (q: { after: string }) => ((after = q.after), new Collection(missed.map((m) => [m.id, m]))) } };
        const chats = (relay as unknown as { chats: Record<string, unknown> }).chats;
        const times: (Date | undefined)[] = [];
        Object.assign(chats, {
            threaded: async () => [chat],
            lastMirrored: async () => ({ discordMessageId: 'seen', createdAt: at(0) }),
            unmirrored: async () => [],
            send: async (user: Me, _c: string, input: { asRunnerId: string; body: string }, opts: { sentAt?: Date } = {}) => {
                sent.push({ user: user.id, runner: input.asRunnerId, body: input.body });
                times.push(opts.sentAt);
                return { id: 'x' };
            },
        });
        (relay as unknown as { client: unknown }).client = { channels: { fetch: async () => thread } };
        await relay.catchUp();
        assert.equal(after, 'seen');
        assert.deepEqual(sent.map((s) => s.body), ['first', 'second']);
        assert.deepEqual(times, [at(1), at(5)]);
    });

    it('names webhooks and threads within Discord’s rules', () => {
        assert.equal(hookName('Discord Dan'), 'D!scord Dan');
        assert.equal(hookName('x'.repeat(90)).length, 80);
        assert.equal(threadName(chatWith(runner('vex', 'a'), runner('kade', 'b'))), '👥 vex, kade');
        assert.equal(threadName({ ...chatWith(runner('vex', 'a'), runner('kade', 'b')), kind: 'direct' } as unknown as ChatRow), '💬 vex · kade');
        assert.equal(threadName({ ...chatWith(), name: 'The heist' } as unknown as ChatRow), '👥 The heist');
        assert.equal(threadName({ ...chatWith(), kind: 'crew', crew: { name: 'Moxes', imageId: null } } as unknown as ChatRow), '🛡️ Moxes');
        assert.equal(threadName({ ...chatWith(), kind: 'gig', gig: { name: 'Grab the data' } } as unknown as ChatRow), '📋 Grab the data');
    });
});
