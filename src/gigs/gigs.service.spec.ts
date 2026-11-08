import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { PrefsService } from '../auth/prefs.service';
import { CrewsService } from '../crews/crews.service';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import { NotifyService } from '../discord/notify.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import type { GigInput, Me } from '../shared/schemas';
import { toSlug } from '../shared/slug';
import { DebriefService, type Payout } from './debrief.service';
import { GigsService } from './gigs.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({
    id,
    name: id,
    avatar: null,
    isOwner: false,
    isAdmin: false,
    isFixer: false,
    isEdgerunner: true,
    timezone: null,
    needsSetup: false,
    ...roles,
});

const admin = person('admin', { isAdmin: true, isEdgerunner: false });
const fixer = person('fixer', { isFixer: true, isEdgerunner: false });
const people = [admin, fixer, person('a'), person('b'), person('c')];

const members = {
    me: async (id: string) => people.find((p) => p.id === id) ?? null,
    member: (id: string) => ({ id, name: id, avatar: null }),
    isEdgerunner: (id: string) => !!people.find((p) => p.id === id)?.isEdgerunner,
    // The "fixer" player has the Discord fixer role; NPCs (no player) always count
    isFixerRunner: (r: { role: string; extraRoles: string[]; ownerId: string | null }) =>
        (r.role === 'Fixer' || r.extraRoles.includes('Fixer')) && (!r.ownerId || r.ownerId === 'fixer'),
    admins: () => ['admin'],
    dm: async () => [],
} as unknown as MembersService;

/** DMs the service sent, by kind. */
let asked: string[] = [];
let nudged: string[] = [];
let dropped: string[] = [];
let reminders: string[][] = [];
let payouts: Payout[] = [];
const posts = {
    sync: async () => ({ threadId: 'thread', overflowIds: [] }),
    askToConfirm: async (_gig: unknown, _thread: string, ids: string[], _by: number, nudge = false) => (nudge ? nudged : asked).push(...ids),
    remind: async (_gig: unknown, _thread: string, ids: string[], kind: string) => reminders.push([kind, ...ids]),
    notifyDropped: async (_gig: unknown, ids: string[]) => dropped.push(...ids),
    sendPayouts: async (_gig: unknown, list: Payout[]) => payouts.push(...list),
} as unknown as GigPostService;
/** Post updates (and DMs) run in the background. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const settings = { get: () => ({ guildId: '1', reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
const H = 3_600_000;
const library = { exists: async () => true, pick: async () => null, refreshUsage: async () => {} } as unknown as LibraryService;
const noRewards = { summary: null, eb: null, ip: null, hqIp: null, text: null, runners: [] };

const input = (slots: GigInput['slots'], patch: Partial<GigInput> = {}): GigInput => ({
    name: 'Grab the data',
    fixerName: 'Rogue',
    fixerRunnerId: null,
    location: 'Watson',
    type: null,
    pay: 2000,
    brief: 'Get in, get out.',
    primaryObjective: ['Grab the case.'],
    imageId: null,
    objectives: [{ text: 'No alarms', bonus: 500, each: false, hidden: false }],
    slots,
    ...patch,
});
const one = [{ crewId: null, count: 1 }];
const two = [{ crewId: null, count: 2 }];

describe('GigsService', () => {
    let gigs: GigsService;
    let crews: CrewsService;
    let debrief: DebriefService;
    let prefs: PrefsService;
    /** Runner IDs by handle. Players a, b and c each have one runner with their own name. */
    let ids: Record<string, string>;

    const addRunner = async (ownerId: string | null, handle: string, role = 'Solo') => {
        const r = await prisma.runner.create({ data: { ownerId, handle, role, slug: toSlug(handle) } });
        ids[handle] = r.id;
        return r.id;
    };
    const states = async (id: string) => (await gigs.view(id, admin)).slots.map((s) => [s.runner?.handle ?? null, s.state]);

    beforeEach(async () => {
        await settle();
        await emptyDb();
        prefs = new PrefsService(prisma);
        const notify = new NotifyService(prefs, members, prisma);
        gigs = new GigsService(prisma, members, posts, settings, library, prefs, notify);
        crews = new CrewsService(prisma, members, gigs, notify);
        debrief = new DebriefService(prisma, gigs, posts, notify);
        ids = {};
        for (const p of ['a', 'b', 'c']) await addRunner(p, p);
        await addRunner('fixer', 'Rogue Amendiares', 'Fixer');
        asked = [];
        nudged = [];
        dropped = [];
        reminders = [];
        payouts = [];
    });

    after(async () => {
        await settle();
        await prisma.$disconnect();
    });

    describe('fixers', () => {
        it("uses a fixer's own fixer character", async () => {
            const gig = await gigs.create(fixer, input(one));
            assert.equal(gig.fixerName, 'Rogue Amendiares');
            assert.equal(gig.fixerRunnerId, ids['Rogue Amendiares']);
            assert.equal(gig.fixerId, 'fixer');
        });

        it('lets admins pick a fixer character or type a name', async () => {
            assert.equal((await gigs.create(admin, input(one, { fixerRunnerId: ids['Rogue Amendiares'] }))).fixerName, 'Rogue Amendiares');
            const typed = await gigs.create(admin, input(one, { fixerName: 'Mr Blue' }));
            assert.equal(typed.fixerName, 'Mr Blue');
            assert.equal(typed.fixerRunnerId, null);
        });

        it("won't use a Fixer-role character whose player lacks the fixer role", async () => {
            const fake = await addRunner('a', 'Wannabe', 'Fixer');
            await assert.rejects(gigs.create(admin, input(one, { fixerRunnerId: fake })), /isn't a fixer/);
        });

        it('leaves approved gigs to admins, even for their own fixer', async () => {
            const gig = await gigs.create(fixer, input(one));
            await gigs.approve(admin, gig.id, true);
            await assert.rejects(gigs.setStatus(fixer, gig.id, 'cancelled'), /Forbidden/);
            await assert.rejects(gigs.setSession(fixer, gig.id, Date.now() + H), /Forbidden/);
            await assert.rejects(gigs.update(fixer, gig.id, input(two)), /Forbidden/);
            await assert.rejects(gigs.assign(fixer, gig.id, ids.a), /Forbidden/);
            await assert.rejects(debrief.complete(fixer, gig.id, noRewards), /Forbidden/);
        });

        it('posts admin gigs straight away and holds fixer gigs for approval', async () => {
            assert.equal((await gigs.create(admin, input(one))).status, 'open');
            const pending = await gigs.create(fixer, input(one));
            assert.equal(pending.status, 'pending');
            assert.equal((await gigs.list(people[2])).length, 1);
            assert.equal((await gigs.list(fixer)).length, 2);
            assert.equal((await gigs.approve(admin, pending.id, true)).status, 'open');
        });

        it('lets fixers edit only their own pending gigs', async () => {
            const gig = await gigs.create(fixer, input(one));
            await gigs.update(fixer, gig.id, input(two, { name: 'Changed' }));
            await gigs.approve(admin, gig.id, true);
            await assert.rejects(gigs.update(fixer, gig.id, input(two)), /Forbidden/);
        });
    });

    describe('undisclosed objectives', () => {
        const secretGig = () => gigs.create(admin, input(one, { objectives: [{ text: 'Plant the bug', bonus: 1000, each: false, hidden: true }] }));
        const player = people.find((p) => p.id === 'a')!;

        it('keeps the details from players until the gig begins', async () => {
            const gig = await secretGig();
            const seen = (await gigs.view(gig.id, player)).objectives[0];
            assert.deepEqual(seen, { text: '', bonus: null, each: false, hidden: true, secret: true });
            // Discord gets the public view too
            assert.equal((await gigs.view(gig.id)).objectives[0].text, '');
        });

        it('shows admins the details, still marked secret', async () => {
            const seen = (await gigs.view((await secretGig()).id, admin)).objectives[0];
            assert.equal(seen.text, 'Plant the bug');
            assert.equal(seen.secret, true);
        });

        it('reveals them once sign-ups lock', async () => {
            const gig = await secretGig();
            await gigs.setStatus(admin, gig.id, 'closed');
            const seen = (await gigs.view(gig.id, player)).objectives[0];
            assert.equal(seen.text, 'Plant the bug');
            assert.equal(seen.secret, false);
        });
    });

    describe('links', () => {
        it('gives a gig a link from its UUID start and name', async () => {
            const gig = await gigs.create(admin, input(one, { name: 'Overzealous Squanch!' }));
            assert.equal(gig.ref, `${gig.id.slice(0, 8)}-overzealous-squanch`);
        });

        it('finds a gig by link or UUID, and old links survive a rename', async () => {
            const gig = await gigs.create(admin, input(one));
            assert.equal(await gigs.resolve(gig.ref), gig.id);
            assert.equal(await gigs.resolve(gig.ref.toUpperCase()), gig.id);
            assert.equal(await gigs.resolve(gig.id), gig.id);
            assert.equal(await gigs.resolve(`${gig.id.slice(0, 8)}-some-old-name`), gig.id);
            await assert.rejects(gigs.resolve('nothing-here'), /No such gig/);
        });
    });

    describe('signing up', () => {
        it('uses a player’s only runner, and asks which when they have several', async () => {
            const gig = await gigs.create(admin, input(two));
            await gigs.join('a', gig.id);
            await addRunner('b', 'Second');
            assert.equal((await gigs.runnerChoices('b', gig.id)).length, 2);
            await assert.rejects(gigs.join('b', gig.id), /more than one runner/);
            await gigs.join('b', gig.id, ids.Second);
            assert.deepEqual(await states(gig.id), [['a', 'interested'], ['Second', 'interested']]);
            assert.equal((await gigs.runnerChoices('b', gig.id)).length, 0);
        });

        it('gives the last slot to one of two people joining at once, and the other a reserve place', async () => {
            const gig = await gigs.create(admin, input(one));
            const replies = await Promise.all([gigs.join('a', gig.id), gigs.join('b', gig.id)]);
            const view = await gigs.view(gig.id, admin);
            assert.equal(view.slots.filter((s) => s.runner).length, 1);
            assert.equal(view.reserves.length, 1);
            assert.equal(replies.filter((r) => /reserve #1/.test(r.text)).length, 1);
        });

        it('allows one runner per player', async () => {
            const gig = await gigs.create(admin, input(two));
            await addRunner('a', 'Other');
            await gigs.join('a', gig.id, ids.a);
            await assert.rejects(gigs.join('a', gig.id, ids.Other), /already/);
        });

        it("won't sign up someone else's runner", async () => {
            const gig = await gigs.create(admin, input(one));
            await assert.rejects(gigs.join('a', gig.id, ids.b), /isn't yours/);
        });

        it('fills crew slots with the crew’s runners first, then open ones', async () => {
            const crew = await crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
            const gig = await gigs.create(admin, input([{ crewId: crew.id, count: 1 }, { crewId: null, count: 1 }]));
            await gigs.join('b', gig.id);
            await gigs.join('a', gig.id);
            assert.deepEqual(
                (await gigs.view(gig.id, admin)).slots.map((s) => [s.crew?.name ?? null, s.runner?.handle]),
                [['Moxes', 'b'], [null, 'a']],
            );
            assert.match((await gigs.join('c', gig.id)).text, /reserve #1/);
            await assert.rejects(gigs.join('c', gig.id), /already on the reserves/);
        });

        describe('unlimited slots', () => {
            const unlimited = [{ crewId: null, count: 0 }];
            const roster = async (id: string) => (await gigs.view(id, admin)).slots.map((s) => s.runner?.handle ?? null);

            it('never fills, and always has one empty slot', async () => {
                const gig = await gigs.create(admin, input(unlimited));
                assert.deepEqual(await roster(gig.id), [null]);
                for (const p of ['a', 'b', 'c']) await gigs.join(p, gig.id);
                assert.deepEqual(await roster(gig.id), ['a', 'b', 'c', null]);
                assert.ok((await gigs.view(gig.id, admin)).slots.every((s) => s.unlimited));
                assert.equal((await gigs.view(gig.id, admin)).reserves.length, 0);
            });

            it('goes back to one empty slot when someone leaves', async () => {
                const gig = await gigs.create(admin, input(unlimited));
                for (const p of ['a', 'b']) await gigs.join(p, gig.id);
                await gigs.leave('a', gig.id);
                assert.deepEqual(await roster(gig.id), ['b', null]);
            });

            it('moves every reserve up when a full gig goes unlimited', async () => {
                const gig = await gigs.create(admin, input(one));
                for (const p of ['a', 'b', 'c']) await gigs.join(p, gig.id);
                await gigs.update(admin, gig.id, input(unlimited));
                await settle();
                const view = await gigs.view(gig.id, admin);
                assert.deepEqual(view.slots.map((s) => s.runner?.handle ?? null), ['a', 'b', 'c', null]);
                assert.equal(view.reserves.length, 0);
            });

            it('can get a limit again, but not below who is on it', async () => {
                const gig = await gigs.create(admin, input(unlimited));
                for (const p of ['a', 'b']) await gigs.join(p, gig.id);
                await assert.rejects(gigs.update(admin, gig.id, input(one)), /already taken/);
                const limited = await gigs.update(admin, gig.id, input([{ crewId: null, count: 3 }]));
                assert.deepEqual(limited.slots.map((s) => [s.runner?.handle ?? null, s.unlimited]), [['a', false], ['b', false], [null, false]]);
            });

            it('keeps an unlimited crew group for that crew', async () => {
                const crew = await crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
                const gig = await gigs.create(admin, input([{ crewId: crew.id, count: 0 }]));
                await gigs.join('b', gig.id);
                assert.match((await gigs.join('a', gig.id)).text, /reserve #1/);
                assert.deepEqual(await roster(gig.id), ['b', null]);
            });
        });

        it('refuses non-runners and closed gigs', async () => {
            const gig = await gigs.create(admin, input(two));
            await assert.rejects(gigs.join('fixer', gig.id), /edgerunner role/);
            await gigs.setStatus(admin, gig.id, 'closed');
            await assert.rejects(gigs.join('a', gig.id), /not taking runners/);
        });

        it("won't shrink below the slots already taken", async () => {
            const gig = await gigs.create(admin, input(two));
            await gigs.join('a', gig.id);
            assert.equal((await gigs.update(admin, gig.id, input(one))).slots.length, 1);
            await gigs.update(admin, gig.id, input(two));
            await gigs.join('b', gig.id);
            await assert.rejects(gigs.update(admin, gig.id, input(one)), /already taken/);
        });

        it('opens up crew slots when the crew is deleted', async () => {
            const crew = await crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
            const gig = await gigs.create(admin, input([{ crewId: crew.id, count: 1 }]));
            await crews.delete(admin, crew.id);
            assert.equal((await gigs.view(gig.id, admin)).slots[0].crew, null);
        });

        it('opens crew slots to anyone and fills them from the reserves', async () => {
            const crew = await crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
            const gig = await gigs.create(admin, input([{ crewId: crew.id, count: 1 }]));
            await gigs.join('c', gig.id);
            const opened = await gigs.openCrewSlots(admin, gig.id, crew.id);
            assert.deepEqual(opened.slots.map((s) => [s.crew, s.runner?.handle]), [[null, 'c']]);
        });

        it('takes a deleted runner off live gigs and moves a reserve up', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            await gigs.dropRunner(ids.a);
            assert.deepEqual(await states(gig.id), [['b', 'interested']]);
        });
    });

    describe('lookups for slash commands', () => {
        it('lists live gigs for /gig', async () => {
            const live = await gigs.create(admin, input(one, { name: 'Live one' }));
            const cancelled = await gigs.create(admin, input(one, { name: 'Pulled' }));
            await gigs.setStatus(admin, cancelled.id, 'cancelled');
            await gigs.create(fixer, input(one, { name: 'Waiting for approval' }));
            assert.deepEqual((await gigs.live()).map((g) => g.id), [live.id]);
        });

        it("lists a player's live gigs for /mygigs, slots and reserves", async () => {
            const first = await gigs.create(admin, input(one));
            const second = await gigs.create(admin, input(one));
            await gigs.join('b', second.id);
            await gigs.join('a', first.id);
            await gigs.join('a', second.id);
            assert.deepEqual((await gigs.forPlayer('a')).map((g) => g.id).sort(), [first.id, second.id].sort());
            assert.deepEqual(await gigs.forPlayer('c'), []);
        });
    });

    describe('sessions', () => {
        it('marks runners interested until a time is set, then asks them to confirm', async () => {
            const gig = await gigs.create(admin, input(two));
            assert.match((await gigs.join('a', gig.id)).text, /on the list/);
            await gigs.join('b', gig.id);
            await gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await settle();
            assert.deepEqual(asked, ['a', 'b']);
            assert.deepEqual(await states(gig.id), [['a', 'awaiting'], ['b', 'awaiting']]);
            assert.match((await gigs.confirm('a', gig.id)).text, /confirmed/);
            assert.match((await gigs.join('b', gig.id)).text, /confirmed/);
            assert.deepEqual(await states(gig.id), [['a', 'confirmed'], ['b', 'confirmed']]);
        });

        it('confirms new runners straight away once a time is set, but asks runners an admin adds', async () => {
            const gig = await gigs.create(admin, input(two));
            await gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await gigs.join('a', gig.id);
            await gigs.assign(admin, gig.id, ids.b);
            await settle();
            assert.deepEqual(await states(gig.id), [['a', 'confirmed'], ['b', 'awaiting']]);
            assert.deepEqual(asked, ['b']);
        });

        it('asks everyone again when the time changes', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await gigs.confirm('a', gig.id);
            await gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 2, 20));
            await settle();
            assert.deepEqual(await states(gig.id), [['a', 'awaiting']]);
            assert.deepEqual(asked, ['a', 'a']);
        });

        it('moves the oldest reserve up when someone drops out, and asks them', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            assert.match((await gigs.join('b', gig.id)).text, /reserve #1/);
            assert.match((await gigs.join('c', gig.id)).text, /reserve #2/);
            await gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await settle();
            asked = [];
            await gigs.leave('a', gig.id);
            await settle();
            assert.deepEqual(await states(gig.id), [['b', 'awaiting']]);
            assert.deepEqual((await gigs.view(gig.id, admin)).reserves.map((r) => r.handle), ['c']);
            assert.deepEqual(asked, ['b']);
        });

        it('fills new slots from the reserves', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            await gigs.update(admin, gig.id, input(two));
            assert.deepEqual(await states(gig.id), [['a', 'interested'], ['b', 'interested']]);
        });

        it('reminds confirmed runners on the day and 30 minutes before, unless they opted out', async () => {
            const gig = await gigs.create(admin, input(two));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            const sessionAt = Date.now() + 20 * H;
            await gigs.setSession(admin, gig.id, sessionAt);
            await gigs.confirm('a', gig.id);
            await gigs.confirm('b', gig.id);
            await prefs.set('b', { reminders: false, playerView: false });
            await gigs.tick(sessionAt - 9 * H);
            await gigs.tick(sessionAt - 8 * H);
            await gigs.tick(sessionAt - 7 * H);
            await gigs.tick(sessionAt - 20 * 60_000);
            await settle();
            assert.deepEqual(reminders, [['day', 'a'], ['soon', 'a']]);
        });

        it('nudges runners who have not confirmed, then drops them and asks the next reserve', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            const askedAt = Date.now();
            await gigs.setSession(admin, gig.id, askedAt + 100 * H);
            await settle();
            asked = [];
            await gigs.tick(askedAt + 37 * H);
            await gigs.tick(askedAt + 38 * H);
            await settle();
            assert.deepEqual(nudged, ['a']);
            await gigs.tick(askedAt + 49 * H);
            await settle();
            assert.deepEqual(dropped, ['a']);
            assert.deepEqual(await states(gig.id), [['b', 'awaiting']]);
            assert.deepEqual(asked, ['b']);
        });
    });

    describe('after the session', () => {
        it("doesn't pull a reserve in when an admin removes a no-show", async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            await gigs.setSession(admin, gig.id, Date.now() + H);
            await prisma.gig.update({ where: { id: gig.id }, data: { sessionAt: new Date(Date.now() - H) } }); // the session has happened
            const slotId = (await gigs.view(gig.id, admin)).slots[0].id;
            await gigs.kick(admin, gig.id, slotId);
            assert.deepEqual(await states(gig.id), [[null, 'interested']]);
        });

        it('clears the reserves when the gig is completed', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            await debrief.complete(admin, gig.id, noRewards);
            assert.equal((await gigs.view(gig.id, admin)).reserves.length, 0);
        });

        it("lets a fixer's player rate their fixer when they went as a runner", async () => {
            people.push(person('both', { isFixer: true }));
            await addRunner('both', 'Fixer Two', 'Fixer');
            await addRunner('both', 'Solo Two');
            // The test members stub only counts "fixer"'s characters, so link the gig by hand
            const gig = await gigs.create(admin, input(one, { fixerName: 'Fixer Two' }));
            await prisma.gig.update({ where: { id: gig.id }, data: { fixerRunnerId: ids['Fixer Two'], fixerId: 'both' } });
            await gigs.join('both', gig.id, ids['Solo Two']);
            await debrief.complete(admin, gig.id, noRewards);
            assert.equal((await gigs.view(gig.id, person('both'))).canRate, true);
            await debrief.rate('both', gig.id, 4, 'Paid on time.');
            // Rating again from the DM menu (no comment given) keeps the comment
            await debrief.rate('both', gig.id, 5);
            assert.deepEqual((await gigs.view(gig.id, person('both'))).myRating, { stars: 5, comment: 'Paid on time.' });
            people.pop();
        });

        it('lets admins add runners once sign-ups are locked', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.setStatus(admin, gig.id, 'closed');
            await gigs.assign(admin, gig.id, ids.a);
            assert.deepEqual(await states(gig.id), [['a', 'interested']]);
            await assert.rejects(gigs.assign(admin, gig.id, ids.a), /that player already has/);
        });
    });

    describe('debrief', () => {
        const crewRewards = { summary: 'Clean job.', eb: 1000, ip: 5, hqIp: 2, text: 'Shard of Arasaka intel' };

        it('pays everyone the crew rewards plus their own extras', async () => {
            const gig = await gigs.create(admin, input(two, { fixerRunnerId: ids['Rogue Amendiares'] }));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            const done = await debrief.complete(admin, gig.id, { ...crewRewards, runners: [{ runnerId: ids.a, eb: 500, ip: null, hqIp: 1, text: 'Kept the cyberdeck' }] });
            await settle();
            assert.equal(done.status, 'completed');
            assert.equal(done.summary, 'Clean job.');
            assert.deepEqual(
                payouts.map((p) => [p.handle, p.eb, p.ip, p.hqIp, p.extras]).sort(),
                [
                    ['a', 1500, 5, 3, ['Shard of Arasaka intel', 'Kept the cyberdeck']],
                    ['b', 1000, 5, 2, ['Shard of Arasaka intel']],
                ],
            );
        });

        it('only gives runner rewards to runners on the gig', async () => {
            const gig = await gigs.create(admin, input(one));
            await gigs.join('a', gig.id);
            await assert.rejects(debrief.complete(admin, gig.id, { ...crewRewards, runners: [{ runnerId: ids.b, eb: 1, ip: null, hqIp: null, text: null }] }), /on the gig/);
        });

        it('lets runners on the gig rate its fixer, and change their rating', async () => {
            const gig = await gigs.create(admin, input(one, { fixerRunnerId: ids['Rogue Amendiares'] }));
            await gigs.join('a', gig.id);
            await assert.rejects(debrief.rate('a', gig.id, 5), /no fixer to rate/);
            await debrief.complete(admin, gig.id, { ...crewRewards, runners: [] });
            await debrief.rate('a', gig.id, 3);
            await debrief.rate('a', gig.id, 5);
            assert.deepEqual((await gigs.view(gig.id, people[2])).myRating, { stars: 5, comment: null });
            await assert.rejects(debrief.rate('b', gig.id, 1), /only runners on the gig/);
        });
    });
});
