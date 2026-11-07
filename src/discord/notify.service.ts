import { Injectable, Logger } from '@nestjs/common';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageCreateOptions } from 'discord.js';
import { PrefsService } from '../auth/prefs.service';
import { PrismaService } from '../prisma/prisma.service';
import type { GigView, NotifyKind } from '../shared/schemas';
import { lineEmbed } from './colours';
import { MembersService } from './members.service';
import type { Said } from './voice';

/**
 * DMs people the notifications they asked for (Me page). Gig news always goes in the gig's
 * thread too; these are copies for the people it's about. Confirm requests don't come
 * through here: they always go.
 */
@Injectable()
export class NotifyService {
    private readonly logger = new Logger(NotifyService.name);
    private readonly timers = new Map<string, NodeJS.Timeout>();

    constructor(
        private readonly prefs: PrefsService,
        private readonly members: MembersService,
        private readonly prisma: PrismaService,
    ) {}

    /** DMs whoever of `userIds` wants this kind. Returns who it reached. */
    async send(kind: NotifyKind, userIds: (string | null | undefined)[], message: MessageCreateOptions): Promise<string[]> {
        const ids = [...new Set(userIds.filter((id): id is string => !!id))];
        if (!ids.length) return [];
        const settings = await this.prefs.notifyFor(ids);
        const wanted = ids.filter((id) => settings.get(id)?.[kind]);
        const failed = await this.members.dm(wanted, message);
        return wanted.filter((id) => !failed.includes(id));
    }

    /** send(), in the background, so the action that caused it doesn't wait on Discord. */
    fire(kind: NotifyKind, userIds: (string | null | undefined)[], message: MessageCreateOptions | (() => Promise<MessageCreateOptions>)) {
        void (async () => {
            const ids = userIds.filter(Boolean);
            if (!ids.length) return;
            await this.send(kind, ids, typeof message === 'function' ? await message() : message);
        })().catch((err) => this.logger.error(`Couldn't send ${kind}: ${err}`));
    }

    /** Runs `fn` once things settle: calling again with the same key within `ms` starts the wait over. */
    later(key: string, ms: number, fn: () => Promise<void>) {
        clearTimeout(this.timers.get(key));
        const timer = setTimeout(() => {
            this.timers.delete(key);
            void fn().catch((err) => this.logger.error(`Couldn't send ${key}: ${err}`));
        }, ms);
        timer.unref();
        this.timers.set(key, timer);
    }

    /**
     * People who asked to hear about new gigs like this one: every gig, gigs with slots for
     * one of their crews, or gigs from fixers they picked. Not whoever put it up.
     */
    async newGigAudience(gig: GigView): Promise<string[]> {
        const watchers = await this.prefs.newGigWatchers();
        const crewIds = [...new Set(gig.slots.flatMap((s) => (s.crew ? [s.crew.id] : [])))];
        const inCrews = crewIds.length
            ? new Set(
                  (await this.prisma.crewMember.findMany({ where: { crewId: { in: crewIds }, runner: { status: 'active' } }, select: { runner: { select: { ownerId: true } } } }))
                      .map((m) => m.runner.ownerId)
                      .filter(Boolean),
              )
            : new Set();
        return watchers
            .filter(({ userId, notify }) => {
                if (userId === gig.createdBy.id || userId === gig.fixerId) return false;
                if (notify.newGigs === 'all') return true;
                if (notify.newGigs === 'crews') return inCrews.has(userId);
                return !!gig.fixerRunnerId && notify.newGigFixers.includes(gig.fixerRunnerId);
            })
            .map((w) => w.userId);
    }
}

/** A notification line with a link button under it. */
export function linked(said: Said, label: string, url: string): MessageCreateOptions {
    return { embeds: [lineEmbed(said)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url))] };
}
