import { Inject, Injectable, Logger } from '@nestjs/common';
import { type AnyThreadChannel, type APIEmbed, ChannelType, Client, DiscordAPIError, ForumChannel, ForumLayoutType, RESTJSONErrorCodes, ThreadAutoArchiveDuration } from 'discord.js';
import { Once } from 'necord';
import { CacheService } from '../cache/cache.service';
import { config } from '../config';
import { attachmentName, LibraryService } from '../library/library.service';
import { framedFile } from '../shared/images';
import { SettingsService } from '../settings/settings.service';
import type { GigView } from '../shared/schemas';
import { type EmojiLookup, EmojiService } from './emoji.service';
import { MembersService } from './members.service';
import type { Payout } from '../gigs/debrief.service';
import { confirmButtons, confirmMessage, gigMessage, openSlots, payoutMessage, reminderMessage } from './gig-embed';
import { lineEmbed, lineMessage } from './colours';
import { type Said, voice } from './voice';

/** Tags the bot sets on posts. Moderated so only the bot and mods can apply them. */
export const STATUS_TAGS = ['Open', 'Full', 'Closed', 'Completed', 'Cancelled'];

/** Discord's limits: 20 tags per forum, 20 characters per tag name. */
const MAX_FORUM_TAGS = 20;
const MAX_TAG_LENGTH = 20;

export const fixerTag = (name: string) => `Fixer: ${name}`.slice(0, MAX_TAG_LENGTH).trim();

export function statusTag(gig: GigView): string | null {
    switch (gig.status) {
        case 'open':
            return openSlots(gig) ? 'Open' : 'Full';
        case 'closed':
            return 'Closed';
        case 'completed':
            return 'Completed';
        case 'cancelled':
            return 'Cancelled';
        default:
            return null;
    }
}

const isFinal = (gig: GigView) => gig.status === 'completed' || gig.status === 'cancelled';

/**
 * Keeps each posted gig's forum post in line with the gig. Approved gigs get a post,
 * later changes edit it, and finished gigs get locked and archived. Live posts are
 * kept open (see GigsService.keepOpen). The forum is picked on the settings page.
 *
 * Permissions: see SettingsService.inviteUrl.
 */
@Injectable()
export class GigPostService {
    private readonly logger = new Logger(GigPostService.name);
    private tagQueue: Promise<unknown> = Promise.resolve();

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly emoji: EmojiService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
        private readonly members: MembersService,
        private readonly cache: CacheService,
    ) {}

    @Once('clientReady')
    onReady() {
        return this.setupForum().catch((err) => this.logger.error(`Forum setup failed: ${err}`));
    }

    /** Status tags, gallery layout and week-long archive time. Run again when the forum changes. */
    async setupForum() {
        if (!this.settings.get().forumId) return;
        const forum = await this.withTags(async (current) => {
            const missing = STATUS_TAGS.filter((name) => !current.availableTags.some((t) => t.name === name));
            if (!missing.length) return current;
            this.logger.log(`Adding forum tags: ${missing.join(', ')}`);
            return current.setAvailableTags([...current.availableTags, ...missing.map((name) => ({ name, moderated: true }))]);
        });
        if (forum.defaultForumLayout !== ForumLayoutType.GalleryView) await forum.setDefaultForumLayout(ForumLayoutType.GalleryView);
        if (forum.defaultAutoArchiveDuration !== ThreadAutoArchiveDuration.OneWeek) {
            await forum.setDefaultAutoArchiveDuration(ThreadAutoArchiveDuration.OneWeek);
        }
    }

    /**
     * Forum tags that aren't statuses or fixers. Offered as gig types, and applied when a gig's
     * type matches. Cached for 10 minutes: the gig form asks every time it opens.
     */
    async types(): Promise<string[]> {
        const forumId = this.settings.get().forumId;
        if (!forumId) return [];
        return this.cache.remember(`gig-types:${forumId}`, 600, async () => {
            const forum = await this.forum();
            return forum.availableTags.map((t) => t.name).filter((name) => !STATUS_TAGS.includes(name) && !name.startsWith('Fixer: '));
        });
    }

    isGigForum(channelId: string | null): boolean {
        return !!channelId && channelId === this.settings.get().forumId;
    }

    /**
     * Creates or updates the gig's post. `note` is posted in the thread before a finished
     * gig gets archived. Returns where the post is now.
     */
    async sync(gig: GigView, post: PostRef & { cardKey: string | null }, note?: Note): Promise<PostRef> {
        if (gig.status === 'pending' || gig.status === 'rejected') return { threadId: post.threadId, overflowIds: post.overflowIds };

        // Emoji load on startup; posts built before that would fall back to plain text
        await this.emoji.ready;
        const forum = await this.ensureFixerTag(gig.fixerName);
        // Pictures are uploaded with the post (gig card first, so it's the forum preview). Their
        // names change with the picture, so an edit only uploads the ones that changed.
        const keys = {
            gig: gig.imageId ? await this.library.gigCardKey({ id: gig.id, imageId: gig.imageId, name: gig.name, cardKey: post.cardKey }) : null,
            fixer: gig.fixerImageId ? framedFile(gig.fixerImageId) : null,
        };
        const names = { gig: keys.gig && attachmentName(keys.gig), fixer: keys.fixer && attachmentName(keys.fixer) };
        const wanted = [names.gig, names.fixer].filter((n): n is string => !!n);
        const appliedTags = this.tagIds(forum, gig);

        // A new post only if there's none yet or Discord says it was deleted. Any other
        // error (a timeout, an outage) is thrown, so a hiccup can't make a duplicate.
        const thread = post.threadId
            ? await forum.threads.fetch(post.threadId).catch((err) => {
                  if (err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownChannel) return null;
                  throw err;
              })
            : null;
        const starter = thread && (await thread.fetchStarterMessage().catch(() => null));
        const existing = starter ? [...starter.attachments.values()] : [];
        // A new gig card means uploading everything again, so the card stays first
        const kept = !names.gig || existing.some((a) => a.name === names.gig) ? existing.filter((a) => wanted.includes(a.name)) : [];
        const files = await this.upload(
            [keys.gig, keys.fixer].filter((k): k is string => !!k && !kept.some((a) => a.name === attachmentName(k))),
        );
        // A picture whose file is gone is left off rather than failing the post
        const has = (name: string | null) => !!name && (kept.some((a) => a.name === name) || files.some((f) => f.name === name));
        const images = { gig: has(names.gig) ? `attachment://${names.gig}` : null, fixer: has(names.fixer) ? `attachment://${names.fixer}` : null };
        const { first, more } = gigMessage(gig, this.emoji.get, config.PUBLIC_URL, images);

        if (!thread) {
            const created = await forum.threads.create({
                name: gig.name,
                message: { ...first, files },
                appliedTags,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            });
            const overflowIds = await this.syncOverflow(created, [], more);
            if (isFinal(gig)) {
                await created.setLocked(true);
                await created.setArchived(true);
            }
            return { threadId: created.id, overflowIds };
        }

        if (thread.archived) await thread.setArchived(false);
        // attachments lists the uploads to keep; anything else on the message is dropped
        await starter?.edit({ ...first, attachments: kept, files });
        const overflowIds = await this.syncOverflow(thread, post.overflowIds, more);
        if (thread.name !== gig.name) await thread.setName(gig.name);
        if (!sameIds(thread.appliedTags, appliedTags)) await thread.setAppliedTags(appliedTags);
        if (thread.autoArchiveDuration !== ThreadAutoArchiveDuration.OneWeek) {
            await thread.setAutoArchiveDuration(ThreadAutoArchiveDuration.OneWeek);
        }
        if (note) {
            const messages = typeof note === 'function' ? note(gig, this.emoji.get) : [lineMessage(note)];
            for (const message of messages) await thread.send({ ...message, allowedMentions: { parse: [] } });
        }
        if (isFinal(gig)) {
            await thread.setLocked(true);
            await thread.setArchived(true);
        } else if (thread.locked) {
            await thread.setLocked(false);
        }
        return { threadId: thread.id, overflowIds };
    }

    /** Stored files ready to upload, skipping any that are gone. */
    private async upload(keys: string[]) {
        const files = await Promise.all(keys.map((k) => this.library.attachment(k)));
        return files.filter((f) => f !== null);
    }

    /** Edits the follow-up messages in place, sends any new ones and deletes the spares. Returns their IDs. */
    private async syncOverflow(thread: AnyThreadChannel, ids: string[], messages: { embeds: APIEmbed[] }[]): Promise<string[]> {
        const kept: string[] = [];
        for (const [i, message] of messages.entries()) {
            const id = ids[i];
            const edited = id
                ? await thread.messages.edit(id, message).catch((err) => {
                      if (isGone(err)) return null;
                      throw err;
                  })
                : null;
            kept.push(edited ? edited.id : (await thread.send({ ...message, allowedMentions: { parse: [] } })).id);
        }
        for (const id of ids.slice(messages.length)) {
            await thread.messages.delete(id).catch((err) => {
                if (!isGone(err)) throw err;
            });
        }
        return kept;
    }

    /** DMs runners to confirm the session. Anyone whose DMs are closed gets pinged in the thread instead. */
    async askToConfirm(gig: GigView, threadId: string, userIds: string[], confirmBy: number, nudge = false) {
        if (!gig.sessionAt) return;
        const said = (nudge ? voice.nudge : voice.confirmAsk)(gig.name, gig.sessionAt, confirmBy);
        const failed = await this.members.dm(userIds, confirmMessage(gig.id, said, this.threadUrl(threadId)));
        if (!failed.length) return;

        const thread = await this.client.channels.fetch(threadId);
        if (!thread?.isThread()) return;
        // Mentions only notify from a message's text, not its embeds, so the pings stay as text
        await thread.send({
            content: failed.map((id) => `<@${id}>`).join(' '),
            embeds: [lineEmbed(voice.confirmFallback())],
            components: [confirmButtons(gig.id)],
            allowedMentions: { users: failed },
        });
    }

    /** Session reminder: DMs to confirmed runners who want them, and a note in the thread for everyone. */
    async remind(gig: GigView, threadId: string, userIds: string[], kind: 'day' | 'soon') {
        if (!gig.sessionAt) return;
        const said = (kind === 'day' ? voice.reminderDay : voice.reminderSoon)(gig.name, gig.sessionAt);
        await this.members.dm(userIds, reminderMessage(said, this.threadUrl(threadId)));

        const thread = await this.client.channels.fetch(threadId);
        if (thread?.isThread()) await thread.send(lineMessage((kind === 'day' ? voice.sessionToday : voice.sessionSoon)(gig.sessionAt)));
    }

    /** Tells runners they were dropped for not confirming. */
    async notifyDropped(gig: GigView, userIds: string[]) {
        await this.members.dm(userIds, lineMessage(voice.dropped(gig.name)));
    }

    /** DMs each runner's player what they earned, with a menu to rate the fixer. */
    async sendPayouts(gig: GigView, payouts: Payout[]) {
        const threadUrl = gig.threadUrl;
        for (const payout of payouts) {
            await this.members.dm([payout.userId], payoutMessage(gig, payout, this.emoji.get, threadUrl));
        }
    }

    private threadUrl(threadId: string) {
        return `https://discord.com/channels/${this.settings.get().guildId}/${threadId}`;
    }

    /** Adds a "Fixer: Name" tag the first time a fixer posts, while the forum has room. Returns the forum. */
    private ensureFixerTag(fixerName: string): Promise<ForumChannel> {
        const name = fixerTag(fixerName);
        return this.withTags(async (forum) => {
            if (forum.availableTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return forum;
            if (forum.availableTags.length >= MAX_FORUM_TAGS) {
                this.logger.warn(`No room for tag "${name}": the forum has ${MAX_FORUM_TAGS} tags`);
                return forum;
            }
            return forum.setAvailableTags([...forum.availableTags, { name, moderated: true }]).catch((err) => {
                this.logger.warn(`Couldn't add tag "${name}": ${err}`);
                return forum;
            });
        });
    }

    /**
     * Runs tag changes one at a time, each on a fresh copy of the forum. Discord replaces
     * the whole tag list on every change, so two at once would drop each other's tags.
     */
    private withTags(change: (forum: ForumChannel) => Promise<ForumChannel>): Promise<ForumChannel> {
        const run = this.tagQueue.then(async () => change(await this.forum()));
        this.tagQueue = run.catch(() => undefined);
        return run;
    }

    private async forum(): Promise<ForumChannel> {
        const id = this.settings.get().forumId;
        if (!id) throw new Error('No gig forum set. An admin needs to pick one in settings.');
        const channel = await this.client.channels.fetch(id);
        if (channel?.type !== ChannelType.GuildForum) throw new Error('The gig forum is gone or is not a forum.');
        return channel;
    }

    private tagIds(forum: ForumChannel, gig: GigView): string[] {
        const wanted = [statusTag(gig), fixerTag(gig.fixerName), gig.type].filter(Boolean).map((name) => name!.toLowerCase());
        return forum.availableTags.filter((t) => wanted.includes(t.name.toLowerCase())).map((t) => t.id);
    }
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

/** Posted in the thread with an update: a line of text, or messages built from the gig (like the debrief). */
export type Note = Said | ((gig: GigView, emoji: EmojiLookup) => { embeds: APIEmbed[] }[]);

/** Where a gig's post lives: its thread, and the follow-up messages holding what didn't fit the first. */
export interface PostRef {
    threadId: string | null;
    overflowIds: string[];
}

const isGone = (err: unknown) => err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMessage;
