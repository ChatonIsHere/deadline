import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { fixerRatings, gigReserves, gigRewards, gigs, gigSlots } from '../db/schema';
import { debriefMessages } from '../discord/gig-embed';
import { GigPostService } from '../discord/gig-post.service';
import { voice } from '../discord/voice';
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
        @Inject(DB) private readonly db: Db,
        private readonly gigs: GigsService,
        private readonly posts: GigPostService,
    ) {}

    /** Completes the gig. Everyone in a slot gets the crew rewards, plus their own if given. */
    complete(user: Me, id: number, input: CompleteInput): GigView {
        if (!user.isAdmin) throw new ForbiddenException();
        const gig = this.gigs.row(id);
        if (!ACTIVE.includes(gig.status)) throw new BadRequestException('Only live gigs can be completed.');

        const slots = this.db.query.gigSlots.findMany({ where: eq(gigSlots.gigId, id) }).sync().filter((s) => s.userId && s.runnerId);
        const onGig = new Set(slots.map((s) => s.runnerId!));
        if (input.runners.some((r) => !onGig.has(r.runnerId))) throw new BadRequestException('Runner rewards can only go to runners on the gig.');

        this.db.transaction((tx) => {
            tx.update(gigs)
                .set({ status: 'completed', summary: input.summary, rewardEb: input.eb, rewardIp: input.ip, rewardHqIp: input.hqIp, rewardText: input.text })
                .where(eq(gigs.id, id))
                .run();
            tx.delete(gigRewards).where(eq(gigRewards.gigId, id)).run();
            // Nobody is waiting for a slot on a finished gig
            tx.delete(gigReserves).where(eq(gigReserves.gigId, id)).run();
            const extras = input.runners.filter((r) => r.eb || r.ip || r.text);
            if (extras.length) tx.insert(gigRewards).values(extras.map((r) => ({ gigId: id, ...r }))).run();
        });

        const view = this.gigs.view(id);
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
    rate(userId: string, id: number, stars: number, comment?: string | null): string {
        const gig = this.gigs.row(id);
        if (gig.status !== 'completed' || !gig.fixerRunnerId) throw new BadRequestException("there's no fixer to rate on that gig.");
        const wasOn = this.db.query.gigSlots.findFirst({ where: and(eq(gigSlots.gigId, id), eq(gigSlots.userId, userId)) }).sync();
        if (!wasOn) throw new BadRequestException('only runners on the gig can rate its fixer.');

        const set = { stars, ratedAt: new Date(), ...(comment !== undefined && { comment }) };
        this.db
            .insert(fixerRatings)
            .values({ gigId: id, userId, ...set })
            .onConflictDoUpdate({ target: [fixerRatings.gigId, fixerRatings.userId], set })
            .run();
        return voice.rated(stars);
    }

    /** The player's rating for a gig, for prefilling the comment box. */
    myRating(userId: string, id: number) {
        return this.db.query.fixerRatings.findFirst({ where: and(eq(fixerRatings.gigId, id), eq(fixerRatings.userId, userId)) }).sync();
    }
}

/** Adds a runner's own rewards to the crew's. */
export function payoutFor(gig: GigView, userId: string, runnerId: number): Payout {
    const crew = gig.crewRewards;
    const own = gig.runnerRewards.find((r) => r.runner.id === runnerId);
    const handle = gig.slots.find((s) => s.runner?.id === runnerId)?.runner?.handle ?? 'Runner';
    return {
        userId,
        handle,
        eb: (crew?.eb ?? 0) + (own?.eb ?? 0),
        ip: (crew?.ip ?? 0) + (own?.ip ?? 0),
        hqIp: crew?.hqIp ?? 0,
        extras: [crew?.text, own?.text].filter((t): t is string => !!t),
    };
}
