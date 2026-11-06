import '../test-env';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { PrefsService } from '../auth/prefs.service';
import { CrewsService } from '../crews/crews.service';
import { type Db, openDb } from '../db/db';
import { gigs as gigsTable, runners } from '../db/schema';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import type { GigInput, Me } from '../shared/schemas';
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const settings = { get: () => ({ guildId: '1', reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
const H = 3_600_000;
const library = { exists: () => true, pick: () => null } as unknown as LibraryService;

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

describe('GigsService', () => {
    let db: Db;
    let gigs: GigsService;
    let crews: CrewsService;
    let debrief: DebriefService;
    let prefs: PrefsService;
    /** Runner IDs by handle. Players a, b and c each have one runner with their own name. */
    let ids: Record<string, number>;

    const addRunner = (ownerId: string | null, handle: string, role = 'Solo') => {
        const [r] = db.insert(runners).values({ ownerId, handle, role }).returning().all();
        ids[handle] = r.id;
        return r.id;
    };
    const states = (id: number) => gigs.get(admin, id).slots.map((s) => [s.runner?.handle ?? null, s.state]);

    beforeEach(() => {
        db = openDb(':memory:');
        prefs = new PrefsService(db);
        gigs = new GigsService(db, members, posts, settings, library, prefs);
        crews = new CrewsService(db, members, gigs);
        debrief = new DebriefService(db, gigs, posts);
        ids = {};
        for (const p of ['a', 'b', 'c']) addRunner(p, p);
        addRunner('fixer', 'Rogue Amendiares', 'Fixer');
        asked = [];
        nudged = [];
        dropped = [];
        reminders = [];
        payouts = [];
    });

    describe('fixers', () => {
        it("uses a fixer's own fixer character", () => {
            const gig = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
            assert.equal(gig.fixerName, 'Rogue Amendiares');
            assert.equal(gig.fixerRunnerId, ids['Rogue Amendiares']);
            assert.equal(gig.fixerId, 'fixer');
        });

        it('lets admins pick a fixer character or type a name', () => {
            assert.equal(gigs.create(admin, input([{ crewId: null, count: 1 }], { fixerRunnerId: ids['Rogue Amendiares'] })).fixerName, 'Rogue Amendiares');
            const typed = gigs.create(admin, input([{ crewId: null, count: 1 }], { fixerName: 'Mr Blue' }));
            assert.equal(typed.fixerName, 'Mr Blue');
            assert.equal(typed.fixerRunnerId, null);
        });

        it("won't use a Fixer-role character whose player lacks the fixer role", () => {
            const fake = addRunner('a', 'Wannabe', 'Fixer');
            assert.throws(() => gigs.create(admin, input([{ crewId: null, count: 1 }], { fixerRunnerId: fake })), /isn't a fixer/);
        });

        it('leaves approved gigs to admins, even for their own fixer', async () => {
            const gig = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
            gigs.approve(admin, gig.id, true);
            assert.throws(() => gigs.setStatus(fixer, gig.id, 'cancelled'), /Forbidden/);
            assert.throws(() => gigs.setSession(fixer, gig.id, Date.now() + H), /Forbidden/);
            assert.throws(() => gigs.update(fixer, gig.id, input([{ crewId: null, count: 2 }])), /Forbidden/);
            await assert.rejects(gigs.assign(fixer, gig.id, ids.a), /Forbidden/);
            assert.throws(() => debrief.complete(fixer, gig.id, { summary: null, eb: null, ip: null, hqIp: null, text: null, runners: [] }), /Forbidden/);
        });

        it('posts admin gigs straight away and holds fixer gigs for approval', () => {
            assert.equal(gigs.create(admin, input([{ crewId: null, count: 1 }])).status, 'open');
            const pending = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
            assert.equal(pending.status, 'pending');
            assert.equal(gigs.list(people[2]).length, 1);
            assert.equal(gigs.list(fixer).length, 2);
            assert.equal(gigs.approve(admin, pending.id, true).status, 'open');
        });

        it('lets fixers edit only their own pending gigs', () => {
            const gig = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
            gigs.update(fixer, gig.id, input([{ crewId: null, count: 2 }], { name: 'Changed' }));
            gigs.approve(admin, gig.id, true);
            assert.throws(() => gigs.update(fixer, gig.id, input([{ crewId: null, count: 2 }])), /Forbidden/);
        });
    });

    describe('undisclosed objectives', () => {
        const secretGig = () =>
            gigs.create(admin, input([{ crewId: null, count: 1 }], { objectives: [{ text: 'Plant the bug', bonus: 1000, each: false, hidden: true }] }));
        const player = people.find((p) => p.id === 'a')!;

        it('keeps the details from players until the gig begins', () => {
            const gig = secretGig();
            const seen = gigs.view(gig.id, player).objectives[0];
            assert.deepEqual(seen, { text: '', bonus: null, each: false, hidden: true, secret: true });
            // Discord gets the public view too
            assert.equal(gigs.view(gig.id).objectives[0].text, '');
        });

        it('shows admins the details, still marked secret', () => {
            const seen = gigs.view(secretGig().id, admin).objectives[0];
            assert.equal(seen.text, 'Plant the bug');
            assert.equal(seen.secret, true);
        });

        it('reveals them once sign-ups lock', () => {
            const gig = secretGig();
            gigs.setStatus(admin, gig.id, 'closed');
            const seen = gigs.view(gig.id, player).objectives[0];
            assert.equal(seen.text, 'Plant the bug');
            assert.equal(seen.secret, false);
        });
    });

    describe('signing up', () => {
        it('uses a player’s only runner, and asks which when they have several', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            await gigs.join('a', gig.id);
            addRunner('b', 'Second');
            assert.equal(gigs.runnerChoices('b', gig.id).length, 2);
            await assert.rejects(gigs.join('b', gig.id), /more than one runner/);
            await gigs.join('b', gig.id, ids.Second);
            assert.deepEqual(states(gig.id), [['a', 'interested'], ['Second', 'interested']]);
            assert.equal(gigs.runnerChoices('b', gig.id).length, 0);
        });

        it('allows one runner per player', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            addRunner('a', 'Other');
            await gigs.join('a', gig.id, ids.a);
            await assert.rejects(gigs.join('a', gig.id, ids.Other), /already/);
        });

        it("won't sign up someone else's runner", async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await assert.rejects(gigs.join('a', gig.id, ids.b), /isn't yours/);
        });

        it('fills crew slots with the crew’s runners first, then open ones', async () => {
            const crew = crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
            const gig = gigs.create(admin, input([{ crewId: crew.id, count: 1 }, { crewId: null, count: 1 }]));
            await gigs.join('b', gig.id);
            await gigs.join('a', gig.id);
            assert.deepEqual(
                gigs.get(admin, gig.id).slots.map((s) => [s.crew?.name ?? null, s.runner?.handle]),
                [['Moxes', 'b'], [null, 'a']],
            );
            assert.match(await gigs.join('c', gig.id), /reserve #1/);
            await assert.rejects(gigs.join('c', gig.id), /already on the reserves/);
        });

        it('refuses non-runners and closed gigs', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            await assert.rejects(gigs.join('fixer', gig.id), /edgerunner role/);
            gigs.setStatus(admin, gig.id, 'closed');
            await assert.rejects(gigs.join('a', gig.id), /not taking runners/);
        });

        it("won't shrink below the slots already taken", async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            await gigs.join('a', gig.id);
            assert.equal(gigs.update(admin, gig.id, input([{ crewId: null, count: 1 }])).slots.length, 1);
            gigs.update(admin, gig.id, input([{ crewId: null, count: 2 }]));
            await gigs.join('b', gig.id);
            assert.throws(() => gigs.update(admin, gig.id, input([{ crewId: null, count: 1 }])), /already taken/);
        });

        it('opens up crew slots when the crew is deleted', () => {
            const crew = crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
            const gig = gigs.create(admin, input([{ crewId: crew.id, count: 1 }]));
            crews.delete(admin, crew.id);
            assert.equal(gigs.get(admin, gig.id).slots[0].crew, null);
        });

        it('opens crew slots to anyone and fills them from the reserves', async () => {
            const crew = crews.create(admin, { name: 'Moxes', tagline: '', runnerId: ids.b });
            const gig = gigs.create(admin, input([{ crewId: crew.id, count: 1 }]));
            await gigs.join('c', gig.id);
            const after = gigs.openCrewSlots(admin, gig.id, crew.id);
            assert.deepEqual(after.slots.map((s) => [s.crew, s.runner?.handle]), [[null, 'c']]);
        });

        it('takes a deleted runner off live gigs and moves a reserve up', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            gigs.dropRunner(ids.a);
            assert.deepEqual(states(gig.id), [['b', 'interested']]);
        });
    });

    describe('lookups for slash commands', () => {
        it('lists live gigs for /gig', () => {
            const live = gigs.create(admin, input([{ crewId: null, count: 1 }], { name: 'Live one' }));
            const cancelled = gigs.create(admin, input([{ crewId: null, count: 1 }], { name: 'Pulled' }));
            gigs.setStatus(admin, cancelled.id, 'cancelled');
            gigs.create(fixer, input([{ crewId: null, count: 1 }], { name: 'Waiting for approval' }));
            assert.deepEqual(gigs.live().map((g) => g.id), [live.id]);
        });

        it("lists a player's live gigs for /mygigs, slots and reserves", async () => {
            const one = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            const two = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('b', two.id);
            await gigs.join('a', one.id);
            await gigs.join('a', two.id);
            assert.deepEqual(gigs.forPlayer('a').map((g) => g.id).sort(), [one.id, two.id].sort());
            assert.deepEqual(gigs.forPlayer('c'), []);
        });
    });

    describe('sessions', () => {
        it('marks runners interested until a time is set, then asks them to confirm', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            assert.match(await gigs.join('a', gig.id), /on the list/);
            await gigs.join('b', gig.id);
            gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await settle();
            assert.deepEqual(asked, ['a', 'b']);
            assert.deepEqual(states(gig.id), [['a', 'awaiting'], ['b', 'awaiting']]);
            assert.match(gigs.confirm('a', gig.id), /confirmed/);
            assert.match(await gigs.join('b', gig.id), /confirmed/);
            assert.deepEqual(states(gig.id), [['a', 'confirmed'], ['b', 'confirmed']]);
        });

        it('confirms new runners straight away once a time is set, but asks runners an admin adds', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await gigs.join('a', gig.id);
            await gigs.assign(admin, gig.id, ids.b);
            await settle();
            assert.deepEqual(states(gig.id), [['a', 'confirmed'], ['b', 'awaiting']]);
            assert.deepEqual(asked, ['b']);
        });

        it('asks everyone again when the time changes', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            gigs.confirm('a', gig.id);
            gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 2, 20));
            await settle();
            assert.deepEqual(states(gig.id), [['a', 'awaiting']]);
            assert.deepEqual(asked, ['a', 'a']);
        });

        it('moves the oldest reserve up when someone drops out, and asks them', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            assert.match(await gigs.join('b', gig.id), /reserve #1/);
            assert.match(await gigs.join('c', gig.id), /reserve #2/);
            gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
            await settle();
            asked = [];
            gigs.leave('a', gig.id);
            await settle();
            assert.deepEqual(states(gig.id), [['b', 'awaiting']]);
            assert.deepEqual(gigs.get(admin, gig.id).reserves.map((r) => r.handle), ['c']);
            assert.deepEqual(asked, ['b']);
        });

        it('fills new slots from the reserves', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            gigs.update(admin, gig.id, input([{ crewId: null, count: 2 }]));
            assert.deepEqual(states(gig.id), [['a', 'interested'], ['b', 'interested']]);
        });

        it('reminds confirmed runners on the day and 30 minutes before, unless they opted out', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            const sessionAt = Date.now() + 20 * H;
            gigs.setSession(admin, gig.id, sessionAt);
            gigs.confirm('a', gig.id);
            gigs.confirm('b', gig.id);
            prefs.set('b', { reminders: false, playerView: false });
            gigs.tick(sessionAt - 9 * H);
            gigs.tick(sessionAt - 8 * H);
            gigs.tick(sessionAt - 7 * H);
            gigs.tick(sessionAt - 20 * 60_000);
            await settle();
            assert.deepEqual(reminders, [['day', 'a'], ['soon', 'a']]);
        });

        it('nudges runners who have not confirmed, then drops them and asks the next reserve', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            const askedAt = Date.now();
            gigs.setSession(admin, gig.id, askedAt + 100 * H);
            await settle();
            asked = [];
            gigs.tick(askedAt + 37 * H);
            gigs.tick(askedAt + 38 * H);
            await settle();
            assert.deepEqual(nudged, ['a']);
            gigs.tick(askedAt + 49 * H);
            await settle();
            assert.deepEqual(dropped, ['a']);
            assert.deepEqual(states(gig.id), [['b', 'awaiting']]);
            assert.deepEqual(asked, ['b']);
        });
    });

    describe('after the session', () => {
        it("doesn't pull a reserve in when an admin removes a no-show", async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            gigs.setSession(admin, gig.id, Date.now() + H);
            db.update(gigsTable).set({ sessionAt: new Date(Date.now() - H) }).run(); // the session has happened
            const slotId = gigs.get(admin, gig.id).slots[0].id;
            gigs.kick(admin, gig.id, slotId);
            assert.deepEqual(states(gig.id), [[null, 'interested']]);
        });

        it('clears the reserves when the gig is completed', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            debrief.complete(admin, gig.id, { summary: null, eb: null, ip: null, hqIp: null, text: null, runners: [] });
            assert.equal(gigs.get(admin, gig.id).reserves.length, 0);
        });

        it("lets a fixer's player rate their fixer when they went as a runner", async () => {
            people.push(person('both', { isFixer: true }));
            addRunner('both', 'Fixer Two', 'Fixer');
            addRunner('both', 'Solo Two');
            // The test members stub only counts "fixer"'s characters, so link the gig by hand
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }], { fixerName: 'Fixer Two' }));
            db.update(gigsTable).set({ fixerRunnerId: ids['Fixer Two'], fixerId: 'both' }).run();
            await gigs.join('both', gig.id, ids['Solo Two']);
            debrief.complete(admin, gig.id, { summary: null, eb: null, ip: null, hqIp: null, text: null, runners: [] });
            assert.equal(gigs.get(person('both'), gig.id).canRate, true);
            debrief.rate('both', gig.id, 4, 'Paid on time.');
            // Rating again from the DM menu (no comment given) keeps the comment
            debrief.rate('both', gig.id, 5);
            assert.deepEqual(gigs.get(person('both'), gig.id).myRating, { stars: 5, comment: 'Paid on time.' });
            people.pop();
        });

        it('lets admins add runners once sign-ups are locked', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            gigs.setStatus(admin, gig.id, 'closed');
            await gigs.assign(admin, gig.id, ids.a);
            assert.deepEqual(states(gig.id), [['a', 'interested']]);
            await assert.rejects(gigs.assign(admin, gig.id, ids.a), /that player already has/);
        });
    });

    describe('debrief', () => {
        const crewRewards = { summary: 'Clean job.', eb: 1000, ip: 5, hqIp: 2, text: 'Shard of Arasaka intel' };

        it('pays everyone the crew rewards plus their own extras', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 2 }], { fixerRunnerId: ids['Rogue Amendiares'] }));
            await gigs.join('a', gig.id);
            await gigs.join('b', gig.id);
            const done = debrief.complete(admin, gig.id, { ...crewRewards, runners: [{ runnerId: ids.a, eb: 500, ip: null, text: 'Kept the cyberdeck' }] });
            await settle();
            assert.equal(done.status, 'completed');
            assert.equal(done.summary, 'Clean job.');
            assert.deepEqual(
                payouts.map((p) => [p.handle, p.eb, p.ip, p.hqIp, p.extras]),
                [
                    ['a', 1500, 5, 2, ['Shard of Arasaka intel', 'Kept the cyberdeck']],
                    ['b', 1000, 5, 2, ['Shard of Arasaka intel']],
                ],
            );
        });

        it("only gives runner rewards to runners on the gig", async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
            await gigs.join('a', gig.id);
            assert.throws(() => debrief.complete(admin, gig.id, { ...crewRewards, runners: [{ runnerId: ids.b, eb: 1, ip: null, text: null }] }), /on the gig/);
        });

        it('lets runners on the gig rate its fixer, and change their rating', async () => {
            const gig = gigs.create(admin, input([{ crewId: null, count: 1 }], { fixerRunnerId: ids['Rogue Amendiares'] }));
            await gigs.join('a', gig.id);
            assert.throws(() => debrief.rate('a', gig.id, 5), /no fixer to rate/);
            debrief.complete(admin, gig.id, { ...crewRewards, runners: [] });
            debrief.rate('a', gig.id, 3);
            debrief.rate('a', gig.id, 5);
            assert.deepEqual(gigs.get(people[2], gig.id).myRating, { stars: 5, comment: null });
            assert.throws(() => debrief.rate('b', gig.id, 1), /only runners on the gig/);
        });
    });
});
