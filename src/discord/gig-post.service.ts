import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelType, Client, ForumChannel, ForumLayoutType, ThreadAutoArchiveDuration } from 'discord.js';
import { Once } from 'necord';
import { config } from '../config';
import { LibraryService } from '../library/library.service';
import { SettingsService } from '../settings/settings.service';
import type { GigView } from '../shared/schemas';
import { EmojiService } from './emoji.service';
import { gigMessage, openSlots } from './gig-embed';

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
 * Needs Send Messages, Manage Threads and Embed Links in the forum, and Manage Channels
 * for the tags and gallery layout.
 */
@Injectable()
export class GigPostService {
    private readonly logger = new Logger(GigPostService.name);

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly emoji: EmojiService,
        private readonly settings: SettingsService,
        private readonly library: LibraryService,
    ) {}

    @Once('clientReady')
    onReady() {
        return this.setupForum().catch((err) => this.logger.error(`Forum setup failed: ${err}`));
    }

    /** Status tags, gallery layout and week-long archive time. Run again when the forum changes. */
    async setupForum() {
        if (!this.settings.get().forumId) return;
        let forum = await this.forum();
        const missing = STATUS_TAGS.filter((name) => !forum.availableTags.some((t) => t.name === name));
        if (missing.length) {
            forum = await forum.setAvailableTags([...forum.availableTags, ...missing.map((name) => ({ name, moderated: true }))]);
            this.logger.log(`Added forum tags: ${missing.join(', ')}`);
        }
        if (forum.defaultForumLayout !== ForumLayoutType.GalleryView) await forum.setDefaultForumLayout(ForumLayoutType.GalleryView);
        if (forum.defaultAutoArchiveDuration !== ThreadAutoArchiveDuration.OneWeek) {
            await forum.setDefaultAutoArchiveDuration(ThreadAutoArchiveDuration.OneWeek);
        }
    }

    /** Forum tags that aren't statuses or fixers. Offered as gig types, and applied when a gig's type matches. */
    async types(): Promise<string[]> {
        if (!this.settings.get().forumId) return [];
        const forum = await this.forum();
        return forum.availableTags.map((t) => t.name).filter((name) => !STATUS_TAGS.includes(name) && !name.startsWith('Fixer: '));
    }

    isGigForum(channelId: string | null): boolean {
        return !!channelId && channelId === this.settings.get().forumId;
    }

    /**
     * Creates or updates the gig's post and returns its thread ID. `note` is posted in
     * the thread before a finished gig gets archived.
     */
    async sync(gig: GigView, threadId: string | null, note?: string): Promise<string | null> {
        if (gig.status === 'pending' || gig.status === 'rejected') return threadId;

        const forum = await this.ensureFixerTag(await this.forum(), gig.fixerName);
        const image = gig.imageId ? this.library.url(gig.imageId) : null;
        const message = gigMessage(gig, this.emoji.get, config.PUBLIC_URL, image);
        const appliedTags = this.tagIds(forum, gig);

        const thread = threadId ? await forum.threads.fetch(threadId).catch(() => null) : null;
        if (!thread) {
            const created = await forum.threads.create({
                name: gig.name,
                message,
                appliedTags,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
            });
            return created.id;
        }

        if (thread.archived) await thread.setArchived(false);
        const starter = await thread.fetchStarterMessage();
        await starter?.edit(message);
        if (thread.name !== gig.name) await thread.setName(gig.name);
        if (!sameIds(thread.appliedTags, appliedTags)) await thread.setAppliedTags(appliedTags);
        if (thread.autoArchiveDuration !== ThreadAutoArchiveDuration.OneWeek) {
            await thread.setAutoArchiveDuration(ThreadAutoArchiveDuration.OneWeek);
        }
        if (note) await thread.send({ content: note, allowedMentions: { parse: [] } });
        if (isFinal(gig)) {
            await thread.setLocked(true);
            await thread.setArchived(true);
        } else if (thread.locked) {
            await thread.setLocked(false);
        }
        return thread.id;
    }

    /** Adds a "Fixer: Name" tag the first time a fixer posts, while the forum has room. */
    private async ensureFixerTag(forum: ForumChannel, fixerName: string): Promise<ForumChannel> {
        const name = fixerTag(fixerName);
        if (forum.availableTags.some((t) => t.name.toLowerCase() === name.toLowerCase())) return forum;
        if (forum.availableTags.length >= MAX_FORUM_TAGS) {
            this.logger.warn(`No room for tag "${name}": the forum has ${MAX_FORUM_TAGS} tags`);
            return forum;
        }
        return forum.setAvailableTags([...forum.availableTags, { name, moderated: true }]).catch((err) => {
            this.logger.warn(`Couldn't add tag "${name}": ${err}`);
            return forum;
        });
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
