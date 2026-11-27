import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, type Runner } from '@prisma/client';
import { MembersService } from '../discord/members.service';
import { LibraryService } from '../library/library.service';
import { LiveService } from '../live/live.service';
import { type Db, PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { SettingsService } from '../settings/settings.service';
import {
    type ChatEvent,
    type ChatMessageInput,
    type ChatMessagePage,
    type ChatMessageView,
    type ChatRunner,
    type ChatSummary,
    isLive,
    MAX_CHAT_RECIPIENTS,
    type Me,
    type NewChatInput,
} from '../shared/schemas';

export const CHAT_INCLUDE = {
    members: { include: { runner: true }, orderBy: { joinedAt: 'asc' } },
    staff: true,
    crew: { select: { name: true, imageId: true } },
    gig: { select: { name: true, imageId: true, fixerRunnerId: true, status: true } },
} as const satisfies Prisma.ChatInclude;
export type ChatRow = Prisma.ChatGetPayload<{ include: typeof CHAT_INCLUDE }>;

const MESSAGE_INCLUDE = { runner: true, images: { orderBy: { position: 'asc' } } } as const satisfies Prisma.ChatMessageInclude;
export type MessageRow = Prisma.ChatMessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

/** Messages per page of history */
const PAGE = 50;
/** Most characters in a group chat */
const MAX_GROUP = 25;

/** Who's acting: enough of Me to check what they can do. Discord messages come with the player's Me too. */
export type Actor = Pick<Me, 'id' | 'isAdmin'>;

/**
 * What the Discord side does when a chat changes. ChatRelayService registers itself here, so
 * this service never touches Discord and doesn't wait on it. Each call runs in the background.
 */
export interface ChatRelay {
    /** Members, name or archived state changed (or it's new): bring the thread in line. */
    changed(chat: ChatRow): Promise<void>;
    posted(chat: ChatRow, message: MessageRow): Promise<void>;
    edited(chat: ChatRow, message: MessageRow): Promise<void>;
    removed(chat: ChatRow, message: MessageRow): Promise<void>;
}

const isNpc = (r: Pick<Runner, 'ownerId'>) => !r.ownerId;

/** A chat nobody can send to: archived (gig over, crew gone), or fewer than two characters still active. */
export function isReadOnly(chat: ChatRow): boolean {
    if (chat.archivedAt) return true;
    // The crew or gig it followed is gone
    if ((chat.kind === 'crew' && !chat.crewId) || (chat.kind === 'gig' && !chat.gigId)) return true;
    return chat.members.filter((m) => m.runner.status === 'active').length < 2;
}

/**
 * The characters someone can send as in a chat: their own active ones; for admins, also the
 * NPC fixers in it, and in a gig chat the gig's fixer even when a player plays them. Admins
 * don't speak for a player's characters anywhere else, so players' own chats stay theirs.
 */
export function speakable(user: Actor, chat: ChatRow): Runner[] {
    if (isReadOnly(chat)) return [];
    return chat.members
        .map((m) => m.runner)
        .filter((r) => r.status === 'active' && (r.ownerId === user.id || (user.isAdmin && (isNpc(r) || (chat.kind === 'gig' && r.id === chat.gig?.fixerRunnerId)))));
}

/** Whether a chat has an NPC in it, which makes it one the GMs share. */
const hasNpc = (chat: ChatRow) => chat.members.some((m) => isNpc(m.runner));

/** Players see chats their characters are in (even retired ones, read-only). Admins also see every gig chat and every chat with an NPC. */
export function canSee(user: Actor, chat: ChatRow): boolean {
    if (chat.members.some((m) => m.runner.ownerId === user.id)) return true;
    return user.isAdmin && (chat.kind === 'gig' || hasNpc(chat));
}

/** Chats with someone's characters, or for admins the GMs' ones, for list queries. */
function visibleWhere(user: Actor): Prisma.ChatWhereInput {
    const own: Prisma.ChatWhereInput = { members: { some: { runner: { ownerId: user.id } } } };
    if (!user.isAdmin) return own;
    return { OR: [own, { kind: 'gig' }, { members: { some: { runner: { ownerId: null } } } }] };
}

export const toChatRunner = (r: Runner): ChatRunner => ({
    id: r.id,
    slug: r.slug,
    handle: r.handle,
    imageId: r.imageId,
    status: r.status,
    ownerId: r.ownerId,
    isNpc: isNpc(r),
    fixerSlug: r.fixerSlug,
});

export const toMessageView = (m: MessageRow): ChatMessageView => ({
    id: m.id,
    chatId: m.chatId,
    runner: { id: m.runner.id, slug: m.runner.slug, handle: m.runner.handle, imageId: m.runner.imageId, isNpc: isNpc(m.runner) },
    sentBy: m.sentBy,
    body: m.deletedAt ? '' : m.body,
    imageIds: m.deletedAt ? [] : m.images.map((i) => i.imageId),
    createdAt: m.createdAt.getTime(),
    editedAt: m.editedAt?.getTime() ?? null,
    deleted: !!m.deletedAt,
});

/** One line of a message for previews: its words, or that it's a picture. */
export const previewOf = (m: { body: string; deletedAt: Date | null; images?: unknown[] }) =>
    m.deletedAt ? 'message deleted' : m.body.replace(/\s+/g, ' ').trim().slice(0, 140) || (m.images?.length ? '📷 picture' : '');

/**
 * Chats between characters: direct (one per pair), group (named or not), and one each per
 * crew and live gig, kept in step with the roster and the slots. Each is mirrored into a
 * private Discord thread by ChatRelayService. Everything about who can see and say what is
 * here; the web and Discord both come through it.
 */
@Injectable()
export class ChatsService {
    private readonly logger = new Logger(ChatsService.name);
    private relay: ChatRelay | null = null;

    constructor(
        private readonly prisma: PrismaService,
        private readonly live: LiveService,
        private readonly members: MembersService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        @Optional() private readonly push?: PushService,
    ) {}

    attachRelay(relay: ChatRelay) {
        this.relay = relay;
    }

    // Reading

    async list(user: Actor, { archived = false } = {}): Promise<ChatSummary[]> {
        const rows = await this.prisma.chat.findMany({
            where: { AND: [visibleWhere(user), archived ? {} : { archivedAt: null }] },
            include: CHAT_INCLUDE,
            orderBy: { lastMessageAt: 'desc' },
        });
        return this.summaries(user, rows.filter((c) => canSee(user, c)));
    }

    /** The chats someone gets push notifications for, for their settings. */
    async notifying(user: Actor): Promise<ChatSummary[]> {
        const rows = await this.prisma.chat.findMany({ where: { notify: { some: { userId: user.id } } }, include: CHAT_INCLUDE, orderBy: { lastMessageAt: 'desc' } });
        return this.summaries(user, rows.filter((c) => canSee(user, c)));
    }

    async get(user: Actor, id: string): Promise<ChatSummary> {
        const [summary] = await this.summaries(user, [await this.visible(user, id)]);
        return summary;
    }

    /** Newest last. `before` is a message ID from an earlier page. */
    async messages(user: Actor, id: string, before?: string): Promise<ChatMessagePage> {
        await this.visible(user, id);
        let cursor: { createdAt: Date; id: string } | null = null;
        if (before) {
            cursor = await this.prisma.chatMessage.findFirst({ where: { id: before, chatId: id }, select: { createdAt: true, id: true } });
            if (!cursor) throw new NotFoundException('No such message.');
        }
        const rows = await this.prisma.chatMessage.findMany({
            where: { chatId: id, ...(cursor && { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }) },
            include: MESSAGE_INCLUDE,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: PAGE + 1,
        });
        const more = rows.length > PAGE;
        const page = rows.slice(0, PAGE).reverse();
        return { messages: page.map(toMessageView), before: more ? page[0].id : null };
    }

    /** Marks everything in the chat read, for this person. Their other open pages hear. */
    async read(user: Actor, id: string) {
        await this.visible(user, id);
        const now = new Date();
        await this.prisma.chatRead.upsert({ where: { chatId_userId: { chatId: id, userId: user.id } }, create: { chatId: id, userId: user.id, lastReadAt: now }, update: { lastReadAt: now } });
        this.live.toUsers([user.id], 'chat', { chatId: id } satisfies ChatEvent);
    }

    async setNotify(user: Actor, id: string, on: boolean) {
        await this.visible(user, id);
        if (on) await this.prisma.chatNotify.createMany({ data: [{ chatId: id, userId: user.id }], skipDuplicates: true });
        else await this.prisma.chatNotify.deleteMany({ where: { chatId: id, userId: user.id } });
        this.live.toUsers([user.id], 'chat', { chatId: id } satisfies ChatEvent);
    }

    /**
     * Characters for the pickers, active ones only. "as": who someone can start a chat as (their
     * own; admins also NPC fixers). "to": who they can message (anyone else's, NPC fixers included).
     */
    async characters(user: Actor, side: 'as' | 'to', typed = ''): Promise<ChatRunner[]> {
        const mine: Prisma.RunnerWhereInput = user.isAdmin ? { OR: [{ ownerId: user.id }, { ownerId: null }] } : { ownerId: user.id };
        const rows = await this.prisma.runner.findMany({
            where: {
                status: 'active',
                ...(typed.trim() && { handle: { contains: typed.trim(), mode: 'insensitive' } }),
                ...(side === 'as' ? mine : { OR: [{ ownerId: null }, { ownerId: { not: user.id } }] }),
            },
            orderBy: { handle: 'asc' },
        });
        return rows.map(toChatRunner);
    }

    // Starting chats

    /**
     * A new chat as one of your characters (admins: or an NPC fixer). One recipient opens the
     * direct chat between the two, making it the first time. More makes a new group every time.
     */
    async create(user: Actor, input: NewChatInput): Promise<ChatSummary> {
        const as = await this.runner(input.asRunnerId);
        if (!(as.ownerId === user.id || (user.isAdmin && isNpc(as)))) throw new ForbiddenException('Start chats as one of your own characters.');
        if (as.status !== 'active') throw new BadRequestException(`${as.handle} is ${as.status}.`);
        const recipientIds = [...new Set(input.recipientIds)].filter((r) => r !== as.id);
        if (!recipientIds.length) throw new BadRequestException('Pick someone to message.');
        if (recipientIds.length > MAX_CHAT_RECIPIENTS) throw new BadRequestException(`A chat starts with ${MAX_CHAT_RECIPIENTS} others at most.`);
        const recipients = await this.prisma.runner.findMany({ where: { id: { in: recipientIds } } });
        if (recipients.length !== recipientIds.length) throw new NotFoundException('No such character.');
        for (const r of recipients) {
            if (r.ownerId === user.id) throw new BadRequestException(`${r.handle} is your own character.`);
            if (r.status !== 'active') throw new BadRequestException(`${r.handle} is ${r.status}.`);
        }

        let id: string;
        if (recipients.length === 1) id = await this.direct(as.id, recipients[0].id);
        else {
            const chat = await this.prisma.chat.create({
                data: { kind: 'group', name: input.name, members: { create: [as, ...recipients].map((r) => ({ runnerId: r.id })) } },
            });
            id = chat.id;
        }
        if (isNpc(as)) await this.addStaff(id, user.id);
        const chat = await this.row(id);
        this.changed(chat);
        return this.get(user, id);
    }

    /** The direct chat between two characters, made if there isn't one. */
    private async direct(a: string, b: string): Promise<string> {
        const directKey = [a, b].sort().join(':');
        const existing = await this.prisma.chat.findUnique({ where: { directKey }, select: { id: true } });
        if (existing) return existing.id;
        try {
            const chat = await this.prisma.chat.create({ data: { kind: 'direct', directKey, members: { create: [{ runnerId: a }, { runnerId: b }] } } });
            return chat.id;
        } catch (err) {
            // Both sides started it at once
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return (await this.prisma.chat.findUniqueOrThrow({ where: { directKey } })).id;
            throw err;
        }
    }

    // Messages

    /**
     * Sends as a character the actor can speak as. From Discord, the message's pictures are
     * already stored; `discordMessageId` is a player's own message kept as the Discord copy
     * (it had files), so it isn't posted again.
     */
    async send(user: Actor, chatId: string, input: ChatMessageInput, { discordMessageId }: { discordMessageId?: string } = {}): Promise<ChatMessageView> {
        const chat = await this.visible(user, chatId);
        const as = speakable(user, chat).find((r) => r.id === input.asRunnerId);
        if (!as) throw new ForbiddenException(isReadOnly(chat) ? 'This chat is read-only.' : "You can't speak as that character here.");
        const imageIds = [...new Set(input.imageIds)];
        if (imageIds.length) {
            const images = await this.prisma.image.findMany({ where: { id: { in: imageIds } }, select: { id: true, createdBy: true } });
            if (images.length !== imageIds.length) throw new BadRequestException('That picture is gone. Upload it again.');
            if (!user.isAdmin && images.some((i) => i.createdBy !== user.id)) throw new ForbiddenException();
        }

        const now = new Date();
        const message = await this.prisma.$transaction(async (tx) => {
            const m = await tx.chatMessage.create({
                data: { chatId, runnerId: as.id, sentBy: user.id, body: input.body, discordMessageId, images: { create: imageIds.map((imageId, position) => ({ imageId, position })) } },
                include: MESSAGE_INCLUDE,
            });
            await tx.chat.update({ where: { id: chatId }, data: { lastMessageAt: m.createdAt } });
            // What you said, you've read
            await tx.chatRead.upsert({ where: { chatId_userId: { chatId, userId: user.id } }, create: { chatId, userId: user.id, lastReadAt: now }, update: { lastReadAt: now } });
            if (as.ownerId !== user.id) await this.addStaff(chatId, user.id, tx);
            return m;
        });
        if (imageIds.length) await this.library.refreshUsage(imageIds);

        const view = toMessageView(message);
        const latest = as.ownerId !== user.id && !chat.staff.some((s) => s.userId === user.id) ? await this.row(chatId) : chat;
        const title = this.title(latest, user);
        this.live.toUsers(this.audience(latest), 'chat', { chatId, message: view, title } satisfies ChatEvent);
        this.background(`post message ${message.id}`, () => this.relay?.posted(latest, message));
        this.background('push', () => this.notify(latest, message, title));
        return view;
    }

    /** Your own message, while the chat is open. */
    async edit(user: Actor, chatId: string, messageId: string, body: string): Promise<ChatMessageView> {
        const chat = await this.visible(user, chatId);
        const message = await this.message(chatId, messageId);
        if (message.sentBy !== user.id) throw new ForbiddenException('Only your own messages.');
        if (message.deletedAt) throw new BadRequestException('That message was deleted.');
        if (isReadOnly(chat)) throw new ForbiddenException('This chat is read-only.');
        const updated = await this.prisma.chatMessage.update({ where: { id: messageId }, data: { body, editedAt: new Date() }, include: MESSAGE_INCLUDE });
        const view = toMessageView(updated);
        this.live.toUsers(this.audience(chat), 'chat', { chatId, message: view } satisfies ChatEvent);
        this.background(`edit message ${messageId}`, () => this.relay?.edited(chat, updated));
        return view;
    }

    /** Your own message, or anyone's for admins. It keeps its place, as "message deleted". */
    async remove(user: Actor, chatId: string, messageId: string): Promise<ChatMessageView> {
        const chat = await this.visible(user, chatId);
        const message = await this.message(chatId, messageId);
        if (message.sentBy !== user.id && !user.isAdmin) throw new ForbiddenException('Only your own messages.');
        if (message.deletedAt) return toMessageView(message);
        return this.erase(chat, message);
    }

    /** Someone deleted a message's copy on Discord (a mod, say): it goes on the web too. Our own deletes land here after the fact and change nothing. */
    async deletedOnDiscord(discordMessageId: string) {
        const message = await this.byDiscordMessage(discordMessageId);
        if (!message || message.deletedAt) return;
        await this.erase(await this.row(message.chatId), { ...message, discordMessageId: null });
    }

    private async erase(chat: ChatRow, message: MessageRow): Promise<ChatMessageView> {
        const chatId = chat.id;
        const messageId = message.id;
        const imageIds = message.images.map((i) => i.imageId);
        const updated = await this.prisma.$transaction(async (tx) => {
            await tx.chatMessageImage.deleteMany({ where: { messageId } });
            return tx.chatMessage.update({ where: { id: messageId }, data: { body: '', deletedAt: new Date() }, include: MESSAGE_INCLUDE });
        });
        if (imageIds.length) await this.library.refreshUsage(imageIds);
        const view = toMessageView(updated);
        this.live.toUsers(this.audience(chat), 'chat', { chatId, message: view } satisfies ChatEvent);
        this.background(`delete message ${messageId}`, () => this.relay?.removed(chat, message));
        return view;
    }

    /** A message by its Discord copy, for the Discord edit and delete commands. */
    async byDiscordMessage(discordMessageId: string) {
        return this.prisma.chatMessage.findUnique({ where: { discordMessageId }, include: MESSAGE_INCLUDE });
    }

    async messageById(id: string) {
        return this.prisma.chatMessage.findUnique({ where: { id }, include: MESSAGE_INCLUDE });
    }

    /** The relay posted a message to Discord. */
    async setDiscordMessage(messageId: string, discordMessageId: string | null) {
        await this.prisma.chatMessage.update({ where: { id: messageId }, data: { discordMessageId } });
    }

    // Groups

    async rename(user: Actor, id: string, name: string | null): Promise<ChatSummary> {
        const chat = await this.group(user, id);
        await this.prisma.chat.update({ where: { id }, data: { name } });
        this.changed(await this.row(id));
        return this.get(user, chat.id);
    }

    /** Anyone in a group can bring in another active character, NPC fixers included. */
    async addMember(user: Actor, id: string, runnerId: string): Promise<ChatSummary> {
        const chat = await this.group(user, id);
        const runner = await this.runner(runnerId);
        if (runner.status !== 'active') throw new BadRequestException(`${runner.handle} is ${runner.status}.`);
        if (chat.members.some((m) => m.runnerId === runnerId)) throw new ConflictException(`${runner.handle} is already here.`);
        if (chat.members.length >= MAX_GROUP) throw new BadRequestException(`A group chat can have ${MAX_GROUP} characters at most.`);
        await this.prisma.chatMember.create({ data: { chatId: id, runnerId } });
        this.changed(await this.row(id), chat);
        return this.get(user, id);
    }

    /** Takes one of your characters out of a group (admins: or an NPC). */
    async leave(user: Actor, id: string, runnerId: string) {
        const chat = await this.visible(user, id);
        if (chat.kind !== 'group') throw new BadRequestException(chat.kind === 'direct' ? "You can't leave a direct chat." : 'This chat follows the ' + chat.kind + '. Nobody can leave it.');
        const member = chat.members.find((m) => m.runnerId === runnerId);
        if (!member) return;
        if (member.runner.ownerId !== user.id && !(user.isAdmin && isNpc(member.runner))) throw new ForbiddenException();
        await this.prisma.$transaction([
            this.prisma.chatMember.delete({ where: { chatId_runnerId: { chatId: id, runnerId } } }),
            this.prisma.chatVoice.deleteMany({ where: { chatId: id, runnerId } }),
        ]);
        this.changed(await this.row(id), chat);
    }

    // Crew and gig chats

    /** Makes the crew's chat match its roster and name. Run after anything changes them. */
    async syncCrew(crewId: string, db: Db = this.prisma) {
        const crew = await db.crew.findUnique({ where: { id: crewId }, include: { members: { select: { runnerId: true } } } });
        if (!crew) return;
        let chat = await db.chat.findUnique({ where: { crewId }, include: CHAT_INCLUDE });
        if (!chat) chat = await db.chat.create({ data: { kind: 'crew', crewId, name: crew.name }, include: CHAT_INCLUDE });
        else if (chat.name !== crew.name) await db.chat.update({ where: { id: chat.id }, data: { name: crew.name } });
        await this.match(chat, crew.members.map((m) => m.runnerId), crew.name !== chat.name, db);
    }

    /** Before a crew is deleted: its chat stays as a read-only archive, under its last name. */
    async archiveCrew(crewId: string) {
        const chat = await this.prisma.chat.findUnique({ where: { crewId } });
        if (!chat || chat.archivedAt) return;
        await this.prisma.chat.update({ where: { id: chat.id }, data: { archivedAt: new Date() } });
        this.changed(await this.row(chat.id));
    }

    /**
     * Makes the gig's chat match it. While it's live: the runners in its slots and its fixer
     * (when the fixer has a profile). Once it's completed or cancelled the chat is archived and
     * its members stay as they were, so only those who were on the gig still see it. A gig
     * that goes live again opens it again.
     */
    async syncGig(gigId: string) {
        const gig = await this.prisma.gig.findUnique({ where: { id: gigId }, include: { slots: { select: { userId: true, runnerId: true } } } });
        if (!gig) return;
        let chat = await this.prisma.chat.findUnique({ where: { gigId }, include: CHAT_INCLUDE });
        if (isLive(gig.status)) {
            if (!chat) chat = await this.prisma.chat.create({ data: { kind: 'gig', gigId, name: gig.name }, include: CHAT_INCLUDE });
            const reopened = !!chat.archivedAt;
            const renamed = chat.name !== gig.name;
            if (reopened || renamed) await this.prisma.chat.update({ where: { id: chat.id }, data: { archivedAt: null, name: gig.name } });
            const runnerIds = gig.slots.flatMap((s) => (s.userId && s.runnerId ? [s.runnerId] : []));
            if (gig.fixerRunnerId) runnerIds.push(gig.fixerRunnerId);
            await this.match(chat, runnerIds, reopened || renamed);
        } else if (chat && !chat.archivedAt && (gig.status === 'completed' || gig.status === 'cancelled')) {
            await this.prisma.chat.update({ where: { id: chat.id }, data: { archivedAt: new Date(), name: gig.name } });
            this.changed(await this.row(chat.id));
        }
    }

    /** Sets a chat's members to these runners. Tells the chat's people (old and new) and Discord if anything changed. */
    private async match(chat: ChatRow, runnerIds: string[], changed: boolean, db: Db = this.prisma) {
        const want = new Set(runnerIds);
        const have = new Set(chat.members.map((m) => m.runnerId));
        const add = [...want].filter((r) => !have.has(r));
        const drop = [...have].filter((r) => !want.has(r));
        if (add.length) await db.chatMember.createMany({ data: add.map((runnerId) => ({ chatId: chat.id, runnerId })), skipDuplicates: true });
        if (drop.length) {
            await db.chatMember.deleteMany({ where: { chatId: chat.id, runnerId: { in: drop } } });
            await db.chatVoice.deleteMany({ where: { chatId: chat.id, runnerId: { in: drop } } });
        }
        if (changed || add.length || drop.length) this.changed(await this.row(chat.id, db), chat);
    }

    // Who's who

    /** Everyone who hears about a chat: its characters' players, admins who've spoken in it, and every admin for the GMs' chats. */
    audience(chat: ChatRow): string[] {
        const ids = new Set<string>();
        for (const m of chat.members) if (m.runner.ownerId) ids.add(m.runner.ownerId);
        for (const s of chat.staff) ids.add(s.userId);
        if (chat.kind === 'gig' || hasNpc(chat)) for (const a of this.members.admins()) ids.add(a);
        return [...ids];
    }

    /** The people in the chat's Discord thread: its characters' players and the admins who've spoken in it. */
    threadPeople(chat: ChatRow): string[] {
        const ids = new Set<string>();
        for (const m of chat.members) if (m.runner.ownerId) ids.add(m.runner.ownerId);
        for (const s of chat.staff) ids.add(s.userId);
        return [...ids];
    }

    /** What the chat is called, from someone's side: its name, the crew or gig, or the other characters. */
    title(chat: ChatRow, user: Actor): string {
        if (chat.kind === 'crew') return chat.crew?.name ?? chat.name ?? 'Crew';
        if (chat.kind === 'gig') return chat.gig?.name ?? chat.name ?? 'Gig';
        if (chat.name) return chat.name;
        const mine = new Set(speakable(user, chat).map((r) => r.id));
        const others = chat.members.filter((m) => !mine.has(m.runnerId) && m.runner.ownerId !== user.id);
        return (others.length ? others : chat.members).map((m) => m.runner.handle).join(', ') || 'Empty chat';
    }

    /** A chat by ID, for the Discord side. */
    async find(id: string) {
        return this.prisma.chat.findUnique({ where: { id }, include: CHAT_INCLUDE });
    }

    async byThread(threadId: string) {
        return this.prisma.chat.findUnique({ where: { threadId }, include: CHAT_INCLUDE });
    }

    /** The relay made (or lost) the chat's thread. */
    async setThread(chatId: string, threadId: string | null) {
        await this.prisma.chat.update({ where: { id: chatId }, data: { threadId } });
    }

    async voice(chatId: string, userId: string): Promise<string | null> {
        return (await this.prisma.chatVoice.findUnique({ where: { chatId_userId: { chatId, userId } } }))?.runnerId ?? null;
    }

    async setVoice(chatId: string, userId: string, runnerId: string) {
        await this.prisma.chatVoice.upsert({ where: { chatId_userId: { chatId, userId } }, create: { chatId, userId, runnerId }, update: { runnerId } });
    }

    // Inside

    /** A chat the user can see. Chats they can't are "no such chat", the same as ones that don't exist. */
    async visible(user: Actor, id: string): Promise<ChatRow> {
        const chat = await this.prisma.chat.findUnique({ where: { id }, include: CHAT_INCLUDE });
        if (!chat || !canSee(user, chat)) throw new NotFoundException('No such chat.');
        return chat;
    }

    private async group(user: Actor, id: string): Promise<ChatRow> {
        const chat = await this.visible(user, id);
        if (chat.kind !== 'group') throw new BadRequestException('Only group chats can change who is in them or their name.');
        if (!speakable(user, chat).length) throw new ForbiddenException('This chat is read-only.');
        return chat;
    }

    private async row(id: string, db: Db = this.prisma): Promise<ChatRow> {
        return db.chat.findUniqueOrThrow({ where: { id }, include: CHAT_INCLUDE });
    }

    private async runner(id: string): Promise<Runner> {
        const runner = await this.prisma.runner.findUnique({ where: { id } });
        if (!runner) throw new NotFoundException('No such character.');
        return runner;
    }

    private async message(chatId: string, id: string): Promise<MessageRow> {
        const message = await this.prisma.chatMessage.findFirst({ where: { id, chatId }, include: MESSAGE_INCLUDE });
        if (!message) throw new NotFoundException('No such message.');
        return message;
    }

    private async addStaff(chatId: string, userId: string, db: Db = this.prisma) {
        await db.chatStaff.createMany({ data: [{ chatId, userId }], skipDuplicates: true });
    }

    /** Members, name or state changed: everyone who hears about it (before and after) refreshes, and Discord follows. */
    private changed(chat: ChatRow, before?: ChatRow) {
        const people = new Set([...this.audience(chat), ...(before ? this.audience(before) : [])]);
        this.live.toUsers(people, 'chat', { chatId: chat.id } satisfies ChatEvent);
        this.background(`update chat ${chat.id}`, () => this.relay?.changed(chat));
    }

    /** Push to those who turned it on for this chat, can still see it, didn't send it and aren't looking at it. */
    private async notify(chat: ChatRow, message: MessageRow, title: string) {
        if (!this.push) return;
        const rows = await this.prisma.chatNotify.findMany({ where: { chatId: chat.id, userId: { not: message.sentBy } }, select: { userId: true } });
        const userIds: string[] = [];
        for (const { userId } of rows) {
            if (this.live.isViewing(userId, chat.id)) continue;
            const me = await this.members.me(userId);
            if (me && canSee(me, chat)) userIds.push(userId);
        }
        await this.push.notify(userIds, { title, body: `${message.runner.handle}: ${previewOf(message)}`, url: `/messages/${chat.id}`, tag: `chat-${chat.id}` });
    }

    private background(what: string, fn: () => Promise<unknown> | undefined) {
        void Promise.resolve()
            .then(fn)
            .catch((err) => this.logger.error(`Couldn't ${what}: ${err}`));
    }

    private async summaries(user: Actor, rows: ChatRow[]): Promise<ChatSummary[]> {
        if (!rows.length) return [];
        const ids = rows.map((c) => c.id);
        const [lasts, unread, notify] = await Promise.all([
            this.prisma.$queryRaw<{ chat_id: string; handle: string; body: string; deleted_at: Date | null; created_at: Date; images: number }[]>`
                SELECT DISTINCT ON (m.chat_id) m.chat_id, r.handle, m.body, m.deleted_at, m.created_at,
                    (SELECT count(*)::int FROM chat_message_images i WHERE i.message_id = m.id) AS images
                FROM chat_messages m JOIN runners r ON r.id = m.runner_id
                WHERE m.chat_id = ANY(${ids}::uuid[])
                ORDER BY m.chat_id, m.created_at DESC, m.id DESC`,
            this.prisma.$queryRaw<{ chat_id: string; count: number }[]>`
                SELECT m.chat_id, count(*)::int AS count
                FROM chat_messages m LEFT JOIN chat_reads r ON r.chat_id = m.chat_id AND r.user_id = ${user.id}
                WHERE m.chat_id = ANY(${ids}::uuid[]) AND m.sent_by <> ${user.id} AND m.deleted_at IS NULL
                    AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
                GROUP BY m.chat_id`,
            this.prisma.chatNotify.findMany({ where: { chatId: { in: ids }, userId: user.id }, select: { chatId: true } }),
        ]);
        const lastBy = new Map(lasts.map((l) => [l.chat_id, l]));
        const unreadBy = new Map(unread.map((u) => [u.chat_id, u.count]));
        const notifying = new Set(notify.map((n) => n.chatId));
        const guildId = this.settings.get().guildId;

        return rows.map((chat) => {
            const mine = speakable(user, chat);
            const mineIds = new Set(mine.map((r) => r.id));
            const last = lastBy.get(chat.id);
            const counts = this.counts(user, chat);
            const other = chat.kind === 'direct' ? (chat.members.find((m) => !mineIds.has(m.runnerId) && m.runner.ownerId !== user.id) ?? chat.members[1]) : undefined;
            return {
                id: chat.id,
                kind: chat.kind,
                title: this.title(chat, user),
                name: chat.kind === 'group' ? chat.name : null,
                imageId: chat.kind === 'crew' ? (chat.crew?.imageId ?? null) : chat.kind === 'gig' ? (chat.gig?.imageId ?? null) : (other?.runner.imageId ?? null),
                crewId: chat.crewId,
                gigId: chat.gigId,
                directWith: other?.runnerId ?? null,
                members: chat.members.map((m) => toChatRunner(m.runner)),
                last: last ? { handle: last.handle, body: previewOf({ body: last.body, deletedAt: last.deleted_at, images: new Array(last.images) }), at: last.created_at.getTime() } : null,
                lastMessageAt: chat.lastMessageAt.getTime(),
                // Gig chats an admin only watches don't count as unread for them until they've spoken there
                unread: counts ? (unreadBy.get(chat.id) ?? 0) : 0,
                watching: !counts,
                speakable: mine.map((r) => r.id),
                readOnly: isReadOnly(chat),
                archived: !!chat.archivedAt,
                notify: notifying.has(chat.id),
                discordUrl: chat.threadId && guildId ? `https://discord.com/channels/${guildId}/${chat.threadId}` : null,
            };
        });
    }

    /** Whether unread messages in a chat count for someone: it's theirs, they've spoken in it, or it's an NPC's (the GMs' inbox) outside gigs. */
    private counts(user: Actor, chat: ChatRow): boolean {
        if (chat.members.some((m) => m.runner.ownerId === user.id)) return true;
        if (chat.staff.some((s) => s.userId === user.id)) return true;
        return user.isAdmin && chat.kind !== 'gig' && hasNpc(chat);
    }
}
