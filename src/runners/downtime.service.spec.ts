import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import type { Client } from 'discord.js';
import type { EmojiService } from '../discord/emoji.service';
import type { NotifyService } from '../discord/notify.service';
import { previousPeriod } from '../shared/downtime';
import type { Me } from '../shared/schemas';
import { DowntimeService } from './downtime.service';

const person = (id: string, isAdmin = false) => ({ id, name: id, avatar: null, isOwner: false, isAdmin, isFixer: false, isEdgerunner: true, timezone: null, needsSetup: false }) as Me;
const a = person('a');
const admin = person('admin', true);

/** Mid-November in the default zone, and noon on 1 December there (PST is UTC-8). */
const NOV = new Date('2026-11-15T20:00:00Z').getTime();
const DEC = new Date('2026-12-01T20:00:00Z').getTime();

let sent: { user: string; message: { embeds: { fields: { name: string; value: string }[] }[]; components: unknown[] } }[] = [];
const notify = {
    send: async (_kind: string, users: string[], message: never) => {
        for (const user of users) sent.push({ user, message });
        return users;
    },
} as unknown as NotifyService;
const emoji = { get: () => '' } as unknown as EmojiService;

describe('DowntimeService', () => {
    let downtime: DowntimeService;
    let n = 0;

    const runner = (ownerId: string | null, data: object = {}) => {
        n++;
        return prisma.runner.create({ data: { ownerId, handle: `R${n}`, slug: `r${n}`, role: 'Solo', living: 'low-1', lifestyle: 'low', downtimeGrantedFor: '2026-11', ...data } });
    };
    const balance = async (id: string, now: number) => (await downtime.view(await prisma.runner.findUniqueOrThrow({ where: { id } }), now)).balance;

    beforeEach(async () => {
        await emptyDb();
        sent = [];
        downtime = new DowntimeService(prisma, notify, emoji, { isReady: () => true } as unknown as Client);
    });

    after(() => prisma.$disconnect());

    describe('month start', () => {
        it('pays once and pings what is due', async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            await downtime.run(DEC);
            assert.equal(await balance(r.id, DEC), 17);
            assert.equal(sent.length, 1);
            assert.match(sent[0].message.embeds[0].fields[0].value, /\+17 DT.*1,300eb.*humanity 0/);
        });

        it('does nothing before noon on the 1st', async () => {
            const r = await runner('a');
            await downtime.run(new Date('2026-12-01T19:00:00Z').getTime());
            assert.equal(await balance(r.id, DEC), 0);
            assert.equal(sent.length, 0);
        });

        it('sends one message per player, with a part per character', async () => {
            await runner('a');
            await runner('a');
            await runner('b');
            await downtime.run(DEC);
            assert.deepEqual(sent.map((s) => [s.user, s.message.embeds[0].fields.length]).sort(), [['a', 2], ['b', 1]]);
        });

        it('goes by each player\'s own clock', async () => {
            await prisma.userPrefs.create({ data: { userId: 'b', timezone: 'Asia/Tokyo' } });
            const [la, tokyo] = [await runner('a'), await runner('b')];
            const earlier = new Date('2026-12-01T10:00:00Z').getTime();
            await downtime.run(earlier);
            assert.equal(await balance(tokyo.id, earlier), 17);
            assert.equal(await balance(la.id, earlier), 0);
        });

        it('leaves out NPCs, retired characters and anyone with nothing set', async () => {
            await runner(null);
            const gone = await runner('a', { status: 'retired' });
            const none = await runner('b', { living: null, lifestyle: null });
            await downtime.run(DEC);
            assert.equal(sent.length, 0);
            assert.equal(await balance(gone.id, DEC), 0);
            assert.equal(await balance(none.id, DEC), 0);
            // Coming back later doesn't pay for the months away
            assert.equal((await prisma.runner.findUniqueOrThrow({ where: { id: gone.id } })).downtimeGrantedFor, '2026-12');
        });

        it('starts over each month', async () => {
            const r = await runner('a');
            await prisma.downtimeEntry.create({ data: { runnerId: r.id, month: '2026-11', amount: 9, kind: 'admin' } });
            assert.equal(await balance(r.id, NOV), 9);
            await downtime.run(DEC);
            assert.equal(await balance(r.id, DEC), 17);
        });

        it("doesn't pay a month twice if the clock goes back", async () => {
            const r = await runner('a', { downtimeGrantedFor: '2026-12' });
            await downtime.run(DEC);
            assert.equal(await balance(r.id, DEC), 0);
        });
    });

    describe('gigs', () => {
        it('adds DT per gig and counts as having played', async () => {
            const r = await runner('a');
            const earned = await prisma.$transaction((tx) => downtime.forGig(tx, [r], 'Courier Run', NOV));
            assert.equal(earned.get(r.id), 7);
            assert.equal(await balance(r.id, NOV), 7);
            assert.equal((await prisma.runner.findUniqueOrThrow({ where: { id: r.id } })).lastGigMonth, '2026-11');
        });

        it('counts as played even with no DT to give', async () => {
            const r = await runner('a', { living: null, lifestyle: null });
            const earned = await prisma.$transaction((tx) => downtime.forGig(tx, [r], 'Courier Run', NOV));
            assert.equal(earned.size, 0);
            assert.equal((await prisma.runner.findUniqueOrThrow({ where: { id: r.id } })).lastGigMonth, '2026-11');
        });
    });

    describe('spending', () => {
        const paid = async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            return r;
        };

        it('takes it off the balance', async () => {
            const r = await paid();
            await downtime.spend(a, r.id, { amount: 5, note: 'Cyberware repair' }, DEC);
            assert.equal(await balance(r.id, DEC), 12);
        });

        it("can't go below nothing", async () => {
            const r = await paid();
            await assert.rejects(downtime.spend(a, r.id, { amount: 18, note: 'Too much' }, DEC), /17 DT/);
        });

        it('stays safe with two at once', async () => {
            const r = await paid();
            const results = await Promise.allSettled([1, 2].map(() => downtime.spend(a, r.id, { amount: 10, note: 'x' }, DEC)));
            assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
            assert.equal(await balance(r.id, DEC), 7);
        });

        it('is for their player or an admin', async () => {
            const r = await paid();
            await assert.rejects(downtime.spend(person('b'), r.id, { amount: 1, note: 'x' }, DEC), /Forbidden/);
            await downtime.spend(admin, r.id, { amount: 1, note: 'x' }, DEC);
            assert.equal(await balance(r.id, DEC), 16);
        });

        it('only lets admins add DT', async () => {
            const r = await paid();
            await assert.rejects(downtime.add(a, r.id, { amount: 3, note: 'x' }, DEC), /Forbidden/);
            await downtime.add(admin, r.id, { amount: 3, note: 'Bounty' }, DEC);
            assert.equal(await balance(r.id, DEC), 20);
        });
    });

    describe('skipping', () => {
        const view = async (id: string) => downtime.view(await prisma.runner.findUniqueOrThrow({ where: { id } }), DEC);

        it('zeroes the month when they had no game', async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            assert.equal((await view(r.id)).canSkip, true);
            await downtime.skip(a, r.id, undefined, DEC);
            const after = await view(r.id);
            assert.deepEqual([after.balance, after.canSkip, after.thisMonth], [0, false, { dt: 0, due: 0, humanity: 0, skipped: true }]);
        });

        it('is not offered after a month with a game', async () => {
            const r = await runner('a', { lastGigMonth: previousPeriod('2026-12') });
            await downtime.run(DEC);
            assert.equal((await view(r.id)).canSkip, false);
            await assert.rejects(downtime.skip(a, r.id, undefined, DEC), /nothing to skip/);
            assert.equal(sent[0].message.components.length, 1);
        });

        it('offers a button on the ping when it can be skipped', async () => {
            await runner('a');
            await downtime.run(DEC);
            assert.equal(sent[0].message.components.length, 2);
        });

        it('is refused once any has been spent', async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            await downtime.spend(a, r.id, { amount: 1, note: 'x' }, DEC);
            assert.equal((await view(r.id)).canSkip, false);
            await assert.rejects(downtime.skip(a, r.id, undefined, DEC), /already spent/);
        });

        it('keeps gig DT from this month', async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            await prisma.$transaction((tx) => downtime.forGig(tx, [r], 'Job', DEC));
            await downtime.skip(a, r.id, undefined, DEC);
            assert.equal((await view(r.id)).balance, 7);
        });

        it("won't take last month's button", async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            await assert.rejects(downtime.skip(a, r.id, '2026-11', DEC), /month/);
        });

        it("won't skip someone else's", async () => {
            const r = await runner('a');
            await downtime.run(DEC);
            await assert.rejects(downtime.skip(person('b'), r.id, undefined, DEC), /Forbidden/);
        });
    });
});
