import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelType, Client, ForumChannel } from 'discord.js';
import { Once } from 'necord';
import { config } from '../config';
import { SettingsService } from '../settings/settings.service';
import type { GigView } from '../shared/schemas';
import { EmojiService } from './emoji.service';
import { gigMessage, openSlots } from './gig-embed';

/** Tags the bot sets on posts. Moderated so only the bot and mods can apply them. */
export const STATUS_TAGS = ['Open', 'Full', 'Closed', 'Completed', 'Cancelled'];

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
 * later changes edit it, and finished gigs get locked and archived. Needs Send Messages,
 * Manage Threads and Embed Links in the forum, and Manage Channels once to add the tags.
 * The forum is picked on the settings page.
 */
@Injectable()
export class GigPostService {
    private readonly logger = new Logger(GigPostService.name);

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly emoji: EmojiService,
        private readonly settings: SettingsService,
    ) {}

    @Once('clientReady')
    onReady() {
        return this.setupForum().catch((err) => this.logger.error(`Forum setup failed: ${err}`));
    }

    /** Adds the status tags to the forum if they're missing. Run again when the forum changes. */
    async setupForum() {
        if (!this.settings.get().forumId) return;
        const forum = await this.forum();
        const missing = STATUS_TAGS.filter((name) => !forum.availableTags.some((t) => t.name === name));
        if (missing.length) {
            await forum.setAvailableTags([...forum.availableTags, ...missing.map((name) => ({ name, moderated: true }))]);
            this.logger.log(`Added forum tags: ${missing.join(', ')}`);
        }
    }

    /** Forum tags that aren't statuses. Offered as gig types, and applied when a gig's type matches. */
    async types(): Promise<string[]> {
        if (!this.settings.get().forumId) return [];
        const forum = await this.forum();
        return forum.availableTags.map((t) => t.name).filter((name) => !STATUS_TAGS.includes(name));
    }

    /**
     * Creates or updates the gig's post and returns its thread ID. `note` is posted in
     * the thread before a finished gig gets archived.
     */
    async sync(gig: GigView, threadId: string | null, note?: string): Promise<string | null> {
        if (gig.status === 'pending' || gig.status === 'rejected') return threadId;

        const forum = await this.forum();
        const message = gigMessage(gig, this.emoji.get, config.PUBLIC_URL);
        const appliedTags = this.tagIds(forum, gig);

        const thread = threadId ? await forum.threads.fetch(threadId).catch(() => null) : null;
        if (!thread) {
            const created = await forum.threads.create({ name: gig.name, message, appliedTags });
            return created.id;
        }

        if (thread.archived) await thread.setArchived(false);
        const starter = await thread.fetchStarterMessage();
        await starter?.edit(message);
        if (thread.name !== gig.name) await thread.setName(gig.name);
        if (!sameIds(thread.appliedTags, appliedTags)) await thread.setAppliedTags(appliedTags);
        if (note) await thread.send({ content: note, allowedMentions: { parse: [] } });
        if (isFinal(gig)) {
            await thread.setLocked(true);
            await thread.setArchived(true);
        } else if (thread.locked) {
            await thread.setLocked(false);
        }
        return thread.id;
    }

    private async forum(): Promise<ForumChannel> {
        const id = this.settings.get().forumId;
        if (!id) throw new Error('No gig forum set. An admin needs to pick one in settings.');
        const channel = await this.client.channels.fetch(id);
        if (channel?.type !== ChannelType.GuildForum) throw new Error('The gig forum is gone or is not a forum.');
        return channel;
    }

    private tagIds(forum: ForumChannel, gig: GigView): string[] {
        const wanted = [statusTag(gig), gig.type].filter(Boolean).map((name) => name!.toLowerCase());
        return forum.availableTags.filter((t) => wanted.includes(t.name.toLowerCase())).map((t) => t.id);
    }
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));
