import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
    type AnyThreadChannel,
    type Attachment,
    ButtonStyle,
    ChannelType,
    Client,
    ComponentType,
    DiscordAPIError,
    type Message,
    PermissionFlagsBits,
    RESTJSONErrorCodes,
    type TextChannel,
    ThreadAutoArchiveDuration,
    type Webhook,
} from 'discord.js';
import { Context, type ContextOf, On, Once } from 'necord';
import { CacheService } from '../cache/cache.service';
import { config } from '../config';
import { type Actor, type ChatRelay, type ChatRow, ChatsService, type MessageRow, speakable } from '../chats/chats.service';
import { LibraryService } from '../library/library.service';
import { LiveService } from '../live/live.service';
import { SettingsService } from '../settings/settings.service';
import { MAX_UPLOAD, plainFile, thumbFile } from '../shared/images';
import { MAX_MESSAGE, type Me, type TypingEvent } from '../shared/schemas';
import { StorageService } from '../storage/storage.service';
import { chatIntroMessage, INTRO_FOOTER } from './chat-messages';
import { MembersService } from './members.service';

const WEBHOOK_NAME = 'Deadline';
/** How long a held message waits for its player to pick a character. */
const PENDING_SECONDS = 120;
/** How long the "speak as" prompt and notices stay up. */
const PROMPT_MS = 60_000;
const NOTICE_MS = 10_000;
/** Discord: thread names, webhook names */
const MAX_THREAD_NAME = 100;
const MAX_HOOK_NAME = 80;

/** A message held until its player says which character it's from. */
export interface Pending {
    chatId: string;
    userId: string;
    body: string;
    imageIds: string[];
}
export const pendingKey = (token: string) => `chat-pending:${token}`;

const isGone = (err: unknown) =>
    err instanceof DiscordAPIError && (err.code === RESTJSONErrorCodes.UnknownChannel || err.code === RESTJSONErrorCodes.UnknownMessage || err.code === RESTJSONErrorCodes.UnknownWebhook);

/** Webhook names can't say "discord" or "clyde". */
export const hookName = (handle: string) => handle.replace(/discord/gi, 'D!scord').replace(/clyde/gi, 'Clyd3').slice(0, MAX_HOOK_NAME) || 'Runner';

/** What a chat's thread is called, with a symbol for its kind so they're told apart in the channel list. */
export function threadName(chat: ChatRow): string {
    const handles = chat.members.map((m) => m.runner.handle);
    const name =
        chat.kind === 'crew'
            ? `🛡️ ${chat.crew?.name ?? chat.name}`
            : chat.kind === 'gig'
              ? `📋 ${chat.gig?.name ?? chat.name}`
              : chat.kind === 'direct'
                ? `💬 ${handles.join(' · ') || 'Chat'}`
                : `👥 ${chat.name ?? (handles.join(', ') || 'Group')}`;
    return name.length > MAX_THREAD_NAME ? `${name.slice(0, MAX_THREAD_NAME - 1)}…` : name;
}

/** What players can do in the DM channel: see it and talk in their threads, but not post in it or make threads. */
const PLAYER_PERMISSIONS = {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessagesInThreads: true,
    AttachFiles: true,
    EmbedLinks: true,
    UseApplicationCommands: true,
    SendMessages: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
} as const;

/** What the bot needs there (see SettingsService.inviteUrl). */
const BOT_PERMISSIONS = {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
    SendMessagesInThreads: true,
    CreatePrivateThreads: true,
    ManageThreads: true,
    ManageWebhooks: true,
    ManageMessages: true,
    EmbedLinks: true,
    AttachFiles: true,
} as const;

/** Catching up after a restart: messages typed in a thread per pass, and how far back web messages are retried in a thread nothing reached yet. */
const CATCH_UP_PAGE = 100;
const RETRY_WINDOW_MS = 86_400_000;

/**
 * Mirrors chats into private threads in the DM channel (Settings). Messages from the web go
 * in through a webhook, named and pictured as the character. Players typing in a thread have
 * their message swapped for the same: the bot deletes theirs and the webhook posts it as their
 * character, so the thread reads as the characters talking, like the web. A player with more
 * than one character in the chat is asked which, once per thread (/dm as switches).
 *
 * Threads are made when a chat's first message goes out (or by /dm new), so crews and gigs
 * don't fill the channel with empty ones. Each chat's Discord work runs one at a time, in order.
 */
@Injectable()
export class ChatRelayService implements ChatRelay {
    private readonly logger = new Logger(ChatRelayService.name);
    private hook: { channelId: string; webhook: Webhook } | null = null;
    private readonly queues = new Map<string, Promise<unknown>>();
    /** Set once the bot first comes up, so later reconnects know to catch up too. */
    private started = false;

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly chats: ChatsService,
        private readonly settings: SettingsService,
        private readonly members: MembersService,
        private readonly library: LibraryService,
        private readonly storage: StorageService,
        private readonly cache: CacheService,
        private readonly live: LiveService,
    ) {
        chats.attachRelay(this);
        settings.onSave((next, before) => {
            if (next.dmChannelId !== before.dmChannelId) this.hook = null;
            const roles = (s: typeof next) => [s.dmChannelId, s.adminRoleId, s.fixerRoleId, s.edgerunnerRoleId].join();
            if (next.dmChannelId && roles(next) !== roles(before)) void this.setupChannel();
        });
    }

    @Once('clientReady')
    async onReady() {
        this.started = true;
        if (!this.settings.get().dmChannelId) return;
        await this.setupChannel();
        await this.catchUp();
    }

    /** A new gateway session after a dropped one: events in between weren't replayed, so catch up. (Resumed sessions replay them.) */
    @On('shardReady')
    async onReconnect() {
        if (this.started && this.settings.get().dmChannelId) await this.catchUp();
    }

    /**
     * Gets the DM channel ready: its permissions (when the bot may change them), the webhook,
     * and the pinned post explaining it. Run at startup and when the channel or roles change.
     */
    async setupChannel() {
        const channel = await this.channel().catch(() => null);
        if (!channel) return;
        await this.setPermissions(channel).catch((err) => this.logger.warn(`Couldn't set the DM channel's permissions: ${err}`));
        await this.webhook().catch((err) => this.logger.warn(`DM channel webhook: ${err}`));
        await this.postIntro(channel).catch((err) => this.logger.warn(`Couldn't post the DM channel's explainer: ${err}`));
    }

    /**
     * Only signed-in players see the channel: the edgerunner, fixer and admin roles. They talk
     * in their threads, but the channel itself stays the bot's. Overwrites for other roles are
     * left alone. Needs Manage Channels and Manage Roles (Manage Permissions) there.
     */
    private async setPermissions(channel: TextChannel) {
        const me = channel.guild.members.me;
        const allowed = me && channel.permissionsFor(me);
        if (!me || !allowed?.has([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles])) {
            this.logger.warn(`No Manage Channels and Manage Roles in #${channel.name}: set its permissions by hand (see the README).`);
            return;
        }
        const { adminRoleId, fixerRoleId, edgerunnerRoleId } = this.settings.get();
        const reason = 'Deadline chats';
        await channel.permissionOverwrites.edit(me, BOT_PERMISSIONS, { reason });
        const roles = [...new Set([edgerunnerRoleId, fixerRoleId, adminRoleId].filter((r): r is string => !!r && channel.guild.roles.cache.has(r)))];
        for (const roleId of roles) await channel.permissionOverwrites.edit(roleId, PLAYER_PERMISSIONS, { reason });
        // Nobody else, once there's a role to let players in
        if (roles.length) await channel.permissionOverwrites.edit(channel.guild.roles.everyone, { ViewChannel: false }, { reason });
        this.logger.log(`Set #${channel.name}'s permissions for ${roles.length} role${roles.length === 1 ? '' : 's'}`);
    }

    /** The explainer at the top of the channel: the bot's earlier copy is updated, or a new one posted and pinned. */
    private async postIntro(channel: TextChannel) {
        const message = chatIntroMessage(config.PUBLIC_URL);
        const isIntro = (m: Message) => m.author.id === this.client.user?.id && m.embeds[0]?.footer?.text === INTRO_FOOTER;
        const pinned = await channel.messages.fetchPinned().catch(() => null);
        const existing = pinned?.find(isIntro) ?? (await channel.messages.fetch({ limit: 50 })).find(isIntro);
        if (existing) {
            await existing.edit({ embeds: message.embeds, components: message.components });
            return;
        }
        const sent = await channel.send(message);
        await sent.pin().catch((err) => this.logger.warn(`Couldn't pin the DM channel's explainer: ${err}`));
    }

    /**
     * After time offline, both ways: what players typed in open threads meanwhile comes across
     * (oldest first, at the time it was typed), and web messages that never reached their thread
     * are posted. The last message that did reach it marks where each chat is up to.
     */
    async catchUp() {
        let taken = 0;
        let posted = 0;
        for (const chat of await this.chats.threaded()) {
            try {
                const thread = await this.thread(chat);
                if (!thread) continue;
                const last = await this.chats.lastMirrored(chat.id);
                if (last?.discordMessageId) {
                    let after = last.discordMessageId;
                    for (;;) {
                        const page = [...(await thread.messages.fetch({ after, limit: CATCH_UP_PAGE })).values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
                        for (const message of page) {
                            if (message.author.bot || message.webhookId || message.system) continue;
                            await this.received(chat, message, message.createdAt);
                            taken++;
                        }
                        if (page.length < CATCH_UP_PAGE) break;
                        after = page[page.length - 1].id;
                    }
                }
                const since = last?.createdAt ?? new Date(Date.now() - RETRY_WINDOW_MS);
                for (const message of await this.chats.unmirrored(chat.id, since)) {
                    await this.posted(chat, message);
                    posted++;
                }
            } catch (err) {
                this.logger.warn(`Couldn't catch up chat ${chat.id}: ${err}`);
            }
        }
        if (taken || posted) this.logger.log(`Caught up: ${taken} message${taken === 1 ? '' : 's'} from Discord, ${posted} to it`);
    }

    // From the web (ChatRelay)

    changed(chat: ChatRow) {
        return this.queue(chat.id, async () => {
            if (!chat.threadId) return;
            const thread = await this.thread(chat);
            if (!thread) return;
            if (chat.archivedAt) {
                if (!thread.locked) await thread.setLocked(true);
                if (!thread.archived) await thread.setArchived(true);
                return;
            }
            await this.reopen(thread);
            const name = threadName(chat);
            if (thread.name !== name) await thread.setName(name);
            await this.syncMembers(chat, thread);
        });
    }

    posted(chat: ChatRow, message: MessageRow) {
        return this.queue(chat.id, async () => {
            if (message.discordMessageId) return;
            const thread = await this.ensureThread(chat);
            if (!thread) return;
            const webhook = await this.webhook();
            if (!webhook) return;
            await this.reopen(thread);
            const files = [];
            for (const image of message.images) {
                const file = await this.library.attachment(plainFile(image.imageId));
                if (file) files.push(file);
            }
            const sent = await webhook.send({
                threadId: thread.id,
                username: hookName(message.runner.handle),
                avatarURL: message.runner.imageId ? this.storage.url(thumbFile(message.runner.imageId)) : undefined,
                content: message.body || undefined,
                files,
                allowedMentions: { parse: [] },
            });
            await this.chats.setDiscordMessage(message.id, sent.id);
        });
    }

    edited(chat: ChatRow, message: MessageRow) {
        return this.queue(chat.id, async () => {
            const webhook = await this.webhook();
            if (!webhook || !chat.threadId || !message.discordMessageId) return;
            await webhook.editMessage(message.discordMessageId, { threadId: chat.threadId, content: message.body }).catch((err) => {
                if (!isGone(err)) throw err;
            });
        });
    }

    removed(chat: ChatRow, message: MessageRow) {
        return this.queue(chat.id, async () => {
            if (!chat.threadId || !message.discordMessageId) return;
            // The webhook's own copy, or a player's message kept as it was (it had files), which is the bot's to delete
            const webhook = await this.webhook();
            const byHook = await webhook?.deleteMessage(message.discordMessageId, chat.threadId).then(
                () => true,
                () => false,
            );
            if (byHook) return;
            const thread = await this.thread(chat);
            await thread?.messages.delete(message.discordMessageId).catch((err) => {
                if (!isGone(err)) throw err;
            });
        });
    }

    /** The chat's thread, made (with its people in it) if it hasn't got one. Null without a DM channel. */
    async ensureThread(chat: ChatRow): Promise<AnyThreadChannel | null> {
        const existing = chat.threadId ? await this.thread(chat) : null;
        if (existing) return existing;
        const channel = await this.channel();
        if (!channel) return null;
        const thread = await channel.threads.create({
            name: threadName(chat),
            type: ChannelType.PrivateThread,
            invitable: false,
            autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
        });
        await this.chats.setThread(chat.id, thread.id);
        chat.threadId = thread.id;
        await this.syncMembers(chat, thread);
        return thread;
    }

    // From Discord

    /**
     * A player typed in a chat's thread. It's swapped for the webhook's copy as their character.
     * Messages with files other than pictures stay as they are (deleting them would lose the
     * files) and are recorded under the character.
     */
    @On('messageCreate')
    async onMessage(@Context() [message]: ContextOf<'messageCreate'>) {
        if (message.author.bot || message.webhookId || message.system || !message.channel.isThread()) return;
        const chat = await this.chats.byThread(message.channelId);
        if (!chat) return;
        try {
            await this.received(chat, message);
        } catch (err) {
            this.logger.error(`Couldn't take a message from Discord in chat ${chat.id}: ${err}`);
            await this.notice(message.channel, `<@${message.author.id}> that didn't go through. try again, or use the web.`, message.author.id);
        }
    }

    /** `sentAt`: when it was typed, for messages caught up after time offline. */
    private async received(chat: ChatRow, message: Message<boolean>, sentAt?: Date) {
        const user = await this.actor(message.author.id);
        const options = speakable(user, chat);
        if (!options.length) {
            await message.delete().catch(() => undefined);
            await this.notice(message.channel, `<@${user.id}> you can't speak in this chat.`, user.id);
            return;
        }
        const pictures = message.attachments.filter((a) => isPicture(a));
        const others = message.attachments.filter((a) => !isPicture(a));
        const keep = others.size > 0;

        const imageIds: string[] = [];
        for (const a of pictures.values()) {
            const id = await this.store(user, a).catch((err) => {
                this.logger.warn(`Couldn't keep a picture from Discord: ${err}`);
                return null;
            });
            if (id) imageIds.push(id);
        }
        const notes = others.map((a) => `📎 ${a.name}`);
        const body = [message.content, ...notes].filter(Boolean).join('\n').slice(0, MAX_MESSAGE);
        if (!body && !imageIds.length) return;

        const voice = await this.chats.voice(chat.id, user.id);
        const runnerId = options.length === 1 ? options[0].id : options.find((r) => r.id === voice)?.id;
        if (!keep) await message.delete().catch(() => undefined);

        if (!runnerId) {
            // Held until they pick who's speaking. Messages kept for their files go in as their first character.
            if (keep || sentAt) return this.sendFrom(user, chat.id, options[0].id, body, imageIds, keep ? message.id : undefined, sentAt);
            const token = randomUUID();
            await this.cache.set(pendingKey(token), { chatId: chat.id, userId: user.id, body, imageIds } satisfies Pending, PENDING_SECONDS);
            await this.prompt(message.channel as AnyThreadChannel, user.id, token, options);
            return;
        }
        await this.sendFrom(user, chat.id, runnerId, body, imageIds, keep ? message.id : undefined, sentAt);
    }

    /** Sends as a character. With `kept`, the player's own message stays as the Discord copy. */
    async sendFrom(user: Actor, chatId: string, runnerId: string, body: string, imageIds: string[], kept?: string, sentAt?: Date) {
        return this.chats.send(user, chatId, { asRunnerId: runnerId, body, imageIds }, { discordMessageId: kept, sentAt });
    }

    /** A chat message deleted on Discord (by a mod, say) is deleted on the web too. */
    @On('messageDelete')
    async onDelete(@Context() [message]: ContextOf<'messageDelete'>) {
        if (!message.channel.isThread()) return;
        await this.chats.deletedOnDiscord(message.id).catch((err) => this.logger.warn(`Couldn't follow a deleted message: ${err}`));
    }

    /** Typing in a thread shows on the web, as the character they speak as. */
    @On('typingStart')
    async onTyping(@Context() [typing]: ContextOf<'typingStart'>) {
        if (typing.user.bot || !typing.channel.isThread()) return;
        const chat = await this.chats.byThread(typing.channel.id);
        if (!chat) return;
        const user = await this.actor(typing.user.id);
        const options = speakable(user, chat);
        const voice = await this.chats.voice(chat.id, user.id);
        const runner = options.length === 1 ? options[0] : options.find((r) => r.id === voice);
        if (!runner) return;
        const people = this.chats.audience(chat).filter((id) => id !== user.id);
        this.live.toUsers(people, 'typing', { chatId: chat.id, runnerId: runner.id, handle: runner.handle } satisfies TypingEvent);
    }

    /** Asks a player which character is speaking. Only they can answer; it goes away after a minute. */
    private async prompt(thread: AnyThreadChannel, userId: string, token: string, options: { id: string; handle: string }[]) {
        const rows = [];
        for (let i = 0; i < Math.min(options.length, 25); i += 5) {
            rows.push({
                type: ComponentType.ActionRow as const,
                components: options.slice(i, i + 5).map((r) => ({
                    type: ComponentType.Button as const,
                    style: ButtonStyle.Secondary,
                    label: r.handle.slice(0, 80),
                    custom_id: `chat/as/${token}/${r.id}`,
                })),
            });
        }
        const prompt = await thread.send({
            content: `<@${userId}> speak as which character? (once per chat: \`/dm as\` changes it)`,
            components: rows,
            allowedMentions: { users: [userId] },
        });
        setTimeout(() => void prompt.delete().catch(() => undefined), PROMPT_MS).unref();
    }

    /** A line in a thread that removes itself. */
    private async notice(channel: Message['channel'], content: string, userId: string) {
        if (!('send' in channel)) return;
        const sent = await channel.send({ content, allowedMentions: { users: [userId] } }).catch(() => null);
        if (sent) setTimeout(() => void sent.delete().catch(() => undefined), NOTICE_MS).unref();
    }

    /** A picture from Discord, stored like one uploaded on the web (and counted the same). */
    private async store(user: Actor, attachment: Attachment): Promise<string | null> {
        if (attachment.size > MAX_UPLOAD) return null;
        const res = await fetch(attachment.url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const me = await this.members.me(user.id);
        if (!me) return null;
        return this.library.upload(me, Buffer.from(await res.arrayBuffer()), { regionId: null, inLibrary: false, kind: 'art' });
    }

    /** Someone on Discord, as the chats see them. */
    async actor(userId: string): Promise<Me | Actor> {
        return (await this.members.me(userId)) ?? { id: userId, isAdmin: false };
    }

    // Threads and the webhook

    /** Adds the chat's people to its thread and takes out those who aren't any more. The bot stays. */
    private async syncMembers(chat: ChatRow, thread: AnyThreadChannel) {
        const want = new Set(this.chats.threadPeople(chat));
        const have = await thread.members.fetch();
        for (const id of want) if (!have.has(id)) await thread.members.add(id).catch((err) => this.logger.warn(`Couldn't add ${id} to thread ${thread.id}: ${err}`));
        for (const id of have.keys()) {
            if (id === this.client.user?.id || want.has(id)) continue;
            await thread.members.remove(id).catch((err) => this.logger.warn(`Couldn't take ${id} out of thread ${thread.id}: ${err}`));
        }
    }

    /** The chat's thread, if it still exists. A deleted one is forgotten, so the next message makes a new one. */
    private async thread(chat: ChatRow): Promise<AnyThreadChannel | null> {
        if (!chat.threadId) return null;
        try {
            const channel = await this.client.channels.fetch(chat.threadId);
            if (channel?.isThread()) return channel;
        } catch (err) {
            if (!isGone(err)) throw err;
        }
        await this.chats.setThread(chat.id, null);
        chat.threadId = null;
        return null;
    }

    /** Quiet threads archive after a week. Posting brings them back, unless the chat is over. */
    private async reopen(thread: AnyThreadChannel) {
        if (thread.locked) await thread.setLocked(false);
        if (thread.archived) await thread.setArchived(false);
    }

    private async channel(): Promise<TextChannel | null> {
        const id = this.settings.get().dmChannelId;
        if (!id) return null;
        const channel = await this.client.channels.fetch(id).catch(() => null);
        return channel?.type === ChannelType.GuildText ? channel : null;
    }

    /** The bot's webhook in the DM channel, made the first time. */
    private async webhook(): Promise<Webhook | null> {
        const channel = await this.channel();
        if (!channel) return null;
        if (this.hook?.channelId === channel.id) return this.hook.webhook;
        const hooks = await channel.fetchWebhooks();
        const webhook = hooks.find((h) => h.name === WEBHOOK_NAME && h.owner?.id === this.client.user?.id) ?? (await channel.createWebhook({ name: WEBHOOK_NAME, reason: 'Deadline chats' }));
        this.hook = { channelId: channel.id, webhook };
        return webhook;
    }

    /** Runs a chat's Discord work after what came before it. Failures are logged; a gone webhook is fetched again next time. */
    private queue(chatId: string, work: () => Promise<void>): Promise<void> {
        const previous = this.queues.get(chatId) ?? Promise.resolve();
        const next = previous
            .then(work)
            .catch((err) => {
                if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownWebhook) this.hook = null;
                this.logger.error(`Discord work for chat ${chatId} failed: ${err}`);
            });
        this.queues.set(chatId, next);
        void next.finally(() => {
            if (this.queues.get(chatId) === next) this.queues.delete(chatId);
        });
        return next;
    }
}

const isPicture = (a: Attachment) => !!a.contentType?.startsWith('image/') && !a.contentType.includes('svg');
