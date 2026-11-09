import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Runner } from '@prisma/client';
import { Client } from 'discord.js';
import { config } from '../config';
import { EmojiService } from '../discord/emoji.service';
import { type MonthlyLine, monthlyMessage } from '../discord/gig-embed';
import { NotifyService } from '../discord/notify.service';
import { voice } from '../discord/voice';
import type { Db, Tx } from '../prisma/prisma.service';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_TZ, hasLiving, type CustomLiving, type LivingChoice, periodAt, previousPeriod, totals } from '../shared/downtime';
import type { DowntimeInput, DowntimeView, Me } from '../shared/schemas';

/** A runner row as the living tables read it. */
const choiceOf = (r: Pick<Runner, 'living' | 'lifestyle' | 'customLiving'>): LivingChoice => ({ living: r.living, lifestyle: r.lifestyle, customLiving: r.customLiving as unknown as CustomLiving | null });

/**
 * Downtime: what characters earn from where and how they live, on completing a gig and at the
 * start of each month, and what they've spent. A month's balance is just its entries added up,
 * so it resets on its own and the old log stays.
 */
@Injectable()
export class DowntimeService {
    private readonly logger = new Logger(DowntimeService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notify: NotifyService,
        private readonly emoji: EmojiService,
        @Inject(Client) private readonly client: Client,
    ) {}

    /** Months turn over at noon local, so it's checked often. Waits for Discord, or the pings would be lost. */
    @Cron('*/5 * * * *')
    async tick() {
        if (!this.client.isReady()) return;
        try {
            await this.run();
        } catch (err) {
            this.logger.error(`Month start failed: ${err}`);
        }
    }

    /** Each player's timezone, or the default for anyone who hasn't set one. */
    private async zones(db: Db, userIds: string[]): Promise<Map<string, string>> {
        const rows = await db.userPrefs.findMany({ where: { userId: { in: userIds } }, select: { userId: true, timezone: true } });
        const set = new Map(rows.map((r) => [r.userId, r.timezone]));
        return new Map(userIds.map((id) => [id, set.get(id) ?? DEFAULT_TZ]));
    }

    private async period(db: Db, userId: string, now: number): Promise<string> {
        return periodAt(now, (await this.zones(db, [userId])).get(userId)!);
    }

    /** Which DT month a new character's payments start from: their first comes the month after. */
    startMonth(userId: string, now = Date.now()): Promise<string> {
        return this.period(this.prisma, userId, now);
    }

    /**
     * Pays every character whose month has turned over, and pings their players. Safe to run
     * again: a character is moved on to the new month in the same step that pays them.
     */
    async run(now = Date.now()) {
        const runners = await this.prisma.runner.findMany({ where: { ownerId: { not: null }, downtimeGrantedFor: { not: null } }, orderBy: { handle: 'asc' } });
        const zones = await this.zones(this.prisma, [...new Set(runners.map((r) => r.ownerId!))]);
        const lines = new Map<string, { period: string; lines: MonthlyLine[] }>();

        for (const r of runners) {
            const period = periodAt(now, zones.get(r.ownerId!)!);
            // Only ever forward, so changing timezone can't pay a month twice
            if (period <= r.downtimeGrantedFor!) continue;
            const line = await this.grant(r, period);
            if (!line) continue;
            const group = lines.get(r.ownerId!) ?? { period, lines: [] };
            group.lines.push(line);
            lines.set(r.ownerId!, group);
        }

        for (const [userId, group] of lines) {
            await this.notify.send('downtime', [userId], monthlyMessage(group.period, group.lines, this.emoji.get, config.PUBLIC_URL)).catch((err) => this.logger.error(`Couldn't ping ${userId}: ${err}`));
        }
    }

    /** One character's month. Retired and flatlined characters just move on, so coming back pays nothing extra. */
    private grant(r: Runner, period: string): Promise<MonthlyLine | null> {
        return this.prisma.$transaction(async (tx) => {
            const { count } = await tx.runner.updateMany({ where: { id: r.id, downtimeGrantedFor: r.downtimeGrantedFor }, data: { downtimeGrantedFor: period } });
            const choice = choiceOf(r);
            if (!count || r.status !== 'active' || !hasLiving(choice)) return null;
            const { dtMonth, due, humanity } = totals(choice);
            const skippable = r.lastGigMonth !== previousPeriod(period);
            await tx.downtimeEntry.create({ data: { runnerId: r.id, month: period, amount: dtMonth, kind: 'monthly', rent: due, humanity, skippable } });
            return { runnerId: r.id, handle: r.handle, dt: dtMonth, due, humanity, skippable, period };
        });
    }

    /** DT for finishing a gig, in the transaction that completes it. Counts as having played that month. */
    async forGig(tx: Tx, runners: Runner[], gigName: string, now = Date.now()): Promise<Map<string, number>> {
        const zones = await this.zones(tx, [...new Set(runners.flatMap((r) => (r.ownerId ? [r.ownerId] : [])))]);
        const earned = new Map<string, number>();
        for (const r of runners) {
            if (!r.ownerId) continue;
            const month = periodAt(now, zones.get(r.ownerId)!);
            await tx.runner.update({ where: { id: r.id }, data: { lastGigMonth: month } });
            const { dtGig } = totals(choiceOf(r));
            if (!dtGig) continue;
            await tx.downtimeEntry.create({ data: { runnerId: r.id, month, amount: dtGig, kind: 'gig', note: gigName } });
            earned.set(r.id, dtGig);
        }
        return earned;
    }

    /** The private panel on a runner's profile. Only call for their player or an admin. */
    async view(r: Runner, now = Date.now()): Promise<DowntimeView> {
        const month = await this.period(this.prisma, r.ownerId!, now);
        const entries = await this.prisma.downtimeEntry.findMany({ where: { runnerId: r.id, month }, orderBy: { createdAt: 'desc' } });
        const monthly = entries.find((e) => e.kind === 'monthly');
        const choice = choiceOf(r);
        return {
            month,
            ...choice,
            totals: totals(choice),
            balance: entries.reduce((sum, e) => sum + e.amount, 0),
            thisMonth: monthly ? { dt: monthly.amount, due: monthly.rent ?? 0, humanity: monthly.humanity ?? 0, skipped: !!monthly.note } : null,
            canSkip: !!monthly?.skippable && !entries.some((e) => e.kind === 'spend'),
            entries: entries.map((e) => ({ id: e.id, amount: e.amount, kind: e.kind, note: e.note, at: e.createdAt.getTime() })),
        };
    }

    /** The runner, if `user` may touch their DT, with the row locked and the current month's balance. */
    private async open(tx: Tx, user: Pick<Me, 'id' | 'isAdmin'>, runnerId: string, now: number) {
        await tx.$queryRaw`SELECT id FROM runners WHERE id = ${runnerId}::uuid FOR UPDATE`;
        const runner = await tx.runner.findUnique({ where: { id: runnerId } });
        if (!runner) throw new NotFoundException('No such runner.');
        if (!runner.ownerId) throw new BadRequestException('NPCs have no downtime.');
        if (!user.isAdmin && runner.ownerId !== user.id) throw new ForbiddenException();
        const month = await this.period(tx, runner.ownerId, now);
        const { _sum } = await tx.downtimeEntry.aggregate({ where: { runnerId, month }, _sum: { amount: true } });
        return { runner, month, balance: _sum.amount ?? 0 };
    }

    /** A player recording what they spent DT on. Their player or an admin. Can't go below 0. */
    async spend(user: Me, runnerId: string, { amount, note }: DowntimeInput, now = Date.now()) {
        await this.prisma.$transaction(async (tx) => {
            const { month, balance } = await this.open(tx, user, runnerId, now);
            if (amount > balance) throw new BadRequestException(voice.notEnoughDt(balance));
            await tx.downtimeEntry.create({ data: { runnerId, month, amount: -amount, kind: 'spend', note, createdBy: user.id } });
        });
    }

    /** Admins adding DT by hand. */
    async add(user: Me, runnerId: string, { amount, note }: DowntimeInput, now = Date.now()) {
        if (!user.isAdmin) throw new ForbiddenException();
        await this.prisma.$transaction(async (tx) => {
            const { month } = await this.open(tx, user, runnerId, now);
            await tx.downtimeEntry.create({ data: { runnerId, month, amount, kind: 'admin', note, createdBy: user.id } });
        });
    }

    /**
     * Skipping a month after not playing the one before: no DT from it, nothing due. `forMonth`
     * is the month a DM's button was for, so an old button can't skip a new month.
     */
    async skip(user: Pick<Me, 'id' | 'isAdmin'>, runnerId: string, forMonth?: string, now = Date.now()): Promise<{ handle: string; month: string }> {
        return this.prisma.$transaction(async (tx) => {
            const { runner, month } = await this.open(tx, user, runnerId, now);
            if (forMonth && forMonth !== month) throw new BadRequestException(voice.dtMonthOver);
            const monthly = await tx.downtimeEntry.findFirst({ where: { runnerId, month, kind: 'monthly', skippable: true } });
            if (!monthly) throw new BadRequestException(voice.dtNothingToSkip);
            if (await tx.downtimeEntry.count({ where: { runnerId, month, kind: 'spend' } })) throw new BadRequestException(voice.dtAlreadySpent);
            await tx.downtimeEntry.update({ where: { id: monthly.id }, data: { amount: 0, rent: 0, humanity: 0, skippable: false, note: 'Skipped: no game last month', createdBy: user.id } });
            return { handle: runner.handle, month };
        });
    }
}
