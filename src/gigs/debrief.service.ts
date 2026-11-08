import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { debriefMessages } from '../discord/gig-embed';
import { config } from '../config';
import { GigPostService } from '../discord/gig-post.service';
import { linked, NotifyService } from '../discord/notify.service';
import { gigRef } from '../shared/slug';
import { type Said, voice } from '../discord/voice';
import { PrismaService } from '../prisma/prisma.service';
import { splitPot } from '../shared/pay';
import type { CompleteInput, GigView, Me } from '../shared/schemas';
import { ACTIVE, GigsService } from './gigs.service';

/** What one runner earned from a gig: the crew's rewards plus any of their own. */
export interface Payout {
    userId: string;
    handle: string;
    eb: number;
    ip: number;
    hqIp: number;
    extras: string[];
}

/** Wrapping up a gig: the GM's summary and rewards, payout DMs, and runners rating the fixer. */
@Injectable()
export class DebriefService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly gigs: GigsService,
        private readonly posts: GigPostService,
        private readonly notify: NotifyService,
    ) {}

    /** Completes the gig. Everyone in a slot gets the crew rewards, plus their own if given. */
    async complete(user: Me, id: string, input: CompleteInput): Promise<GigView> {
        if (!user.isAdmin) throw new ForbiddenException();
        const gig = await this.gigs.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException('Only live gigs can be completed.');

        const slots = (await this.prisma.gigSlot.findMany({ where: { gigId: id }, include: { runner: { select: { createdAt: true } } } })).filter((s) => s.userId && s.runnerId);
        const onGig = new Set(slots.map((s) => s.runnerId!));
        if (input.runners.some((r) => !onGig.has(r.runnerId))) throw new BadRequestException('Runner rewards can only go to runners on the gig.');

        // Overall pay: everyone's cut of the pot, with the odd eddies going to the oldest characters
        const shares = new Map<string, number>();
        if (gig.splitPay) {
            const oldestFirst = [...slots].sort((a, b) => a.runner!.createdAt.getTime() - b.runner!.createdAt.getTime() || a.runnerId!.localeCompare(b.runnerId!));
            const cuts = splitPot(input.eb ?? 0, oldestFirst.length);
            oldestFirst.forEach((s, i) => shares.set(s.runnerId!, cuts[i]));
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.gig.update({
                where: { id },
                data: { status: 'completed', summary: input.summary, rewardEb: input.eb, rewardIp: input.ip, rewardHqIp: input.hqIp, rewardText: input.text },
            });
            await tx.gigReward.deleteMany({ where: { gigId: id } });
            // Nobody is waiting for a slot on a finished gig
            await this.gigs.clearReserves(id, tx);
            const extras = input.runners.filter((r) => r.eb || r.ip || r.hqIp || r.text);
            const rows = new Map(extras.map((r) => [r.runnerId, { gigId: id, ...r, share: shares.get(r.runnerId) ?? null }]));
            for (const [runnerId, share] of shares) {
                if (!rows.has(runnerId)) rows.set(runnerId, { gigId: id, runnerId, eb: null, ip: null, hqIp: null, text: null, share });
            }
            if (rows.size) await tx.gigReward.createMany({ data: [...rows.values()] });
        });

        const view = await this.gigs.view(id);
        const payouts = slots.map((s) => payoutFor(view, s.userId!, s.runnerId!));
        this.gigs.post(id, {
            note: debriefMessages,
            after: (latest) => this.posts.sendPayouts(latest, payouts),
        });
        return this.gigs.view(id, user);
    }

    /**
     * A player who had a runner on the gig rates its fixer, 1 to 5 stars, with an optional
     * comment. That includes the fixer's own player when they went as a runner. Can be
     * changed later. Leaving `comment` out keeps the one already there.
     */
    async rate(userId: string, id: string, stars: number, comment?: string | null): Promise<Said> {
        const gig = await this.gigs.row(id);
        if (gig.status !== 'completed' || !gig.fixerRunnerId) throw new BadRequestException("there's no fixer to rate on that gig.");
        const wasOn = await this.prisma.gigSlot.findFirst({ where: { gigId: id, userId } });
        if (!wasOn) throw new BadRequestException('only runners on the gig can rate its fixer.');

        const set = { stars, ratedAt: new Date(), ...(comment !== undefined && { comment }) };
        await this.prisma.fixerRating.upsert({ where: { gigId_userId: { gigId: id, userId } }, create: { gigId: id, userId, ...set }, update: set });
        const fixerId = gig.fixerId;
        if (fixerId && fixerId !== userId) {
            // Discord saves the stars, then asks for a note: wait a minute so the fixer gets one message
            this.notify.later(`rating:${id}:${userId}`, 60_000, async () => {
                const rating = await this.prisma.fixerRating.findUnique({ where: { gigId_userId: { gigId: id, userId } } });
                if (!rating) return;
                const by = (await this.prisma.gigSlot.findFirst({ where: { gigId: id, userId }, include: { runner: true } }))?.runner?.handle ?? 'A runner';
                await this.notify.send('fixerRatings', [fixerId], linked(voice.ratingIn(gig.name, by, rating.stars, rating.comment), 'Open on board', `${config.PUBLIC_URL}/gigs/${gigRef(gig)}`));
            });
        }
        return voice.rated(stars);
    }

    /** The player's rating for a gig, for prefilling the comment box. */
    myRating(userId: string, id: string) {
        return this.prisma.fixerRating.findUnique({ where: { gigId_userId: { gigId: id, userId } } });
    }
}

/** Adds a runner's own rewards to the crew's. */
export function payoutFor(gig: GigView, userId: string, runnerId: string): Payout {
    const crew = gig.crewRewards;
    const own = gig.runnerRewards.find((r) => r.runner.id === runnerId);
    const handle = gig.slots.find((s) => s.runner?.id === runnerId)?.runner?.handle ?? 'Runner';
    return {
        userId,
        handle,
        eb: (gig.splitPay ? (own?.share ?? 0) : (crew?.eb ?? 0)) + (own?.eb ?? 0),
        ip: (crew?.ip ?? 0) + (own?.ip ?? 0),
        hqIp: (crew?.hqIp ?? 0) + (own?.hqIp ?? 0),
        extras: [crew?.text, own?.text].filter((t): t is string => !!t),
    };
}
