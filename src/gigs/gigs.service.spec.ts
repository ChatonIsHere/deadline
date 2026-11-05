import '../test-env';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { CrewsService } from '../crews/crews.service';
import { PrefsService } from '../auth/prefs.service';
import { openDb } from '../db/db';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import type { GigInput, Me } from '../shared/schemas';
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
    fixers: () => [{ id: 'fixer', name: 'fixer', avatar: null }],
} as unknown as MembersService;

/** DMs the service sent, by kind. */
let asked: string[] = [];
let nudged: string[] = [];
let dropped: string[] = [];
let reminders: string[][] = [];
const posts = {
    sync: async () => 'thread',
    askToConfirm: async (_gig: unknown, _thread: string, ids: string[], _by: number, nudge = false) => (nudge ? nudged : asked).push(...ids),
    remind: async (_gig: unknown, _thread: string, ids: string[], kind: string) => reminders.push([kind, ...ids]),
    notifyDropped: async (_gig: unknown, ids: string[]) => dropped.push(...ids),
} as unknown as GigPostService;
/** Post updates (and DMs) run in the background. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const settings = { get: () => ({ guildId: '1', reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
const H = 3_600_000;
const library = { exists: () => true, pick: () => null } as unknown as LibraryService;

const input = (slots: GigInput['slots']): GigInput => ({
    name: 'Grab the data',
    fixerName: 'Rogue',
    location: 'Watson',
    type: null,
    pay: 2000,
    objective: 'Get in, get out.',
    imageId: null,
    objectives: [{ text: 'No alarms', bonus: 500 }],
    slots,
});

describe('GigsService', () => {
    let gigs: GigsService;
    let crews: CrewsService;

    let prefs: PrefsService;

    beforeEach(() => {
        const db = openDb(':memory:');
        prefs = new PrefsService(db);
        gigs = new GigsService(db, members, posts, settings, library, prefs);
        crews = new CrewsService(db, members, gigs);
        asked = [];
        nudged = [];
        dropped = [];
        reminders = [];
    });

    it('reminds confirmed runners on the day and 30 minutes before, unless they opted out', async () => {
        const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
        await gigs.join('a', gig.id);
        await gigs.join('b', gig.id);
        const sessionAt = Date.now() + 20 * H;
        gigs.setSession(admin, gig.id, sessionAt);
        gigs.confirm('a', gig.id);
        gigs.confirm('b', gig.id);
        prefs.set('b', { reminders: false });

        gigs.tick(sessionAt - 9 * H);
        gigs.tick(sessionAt - 8 * H);
        gigs.tick(sessionAt - 7 * H);
        gigs.tick(sessionAt - 20 * 60_000);
        await settle();
        assert.deepEqual(reminders, [
            ['day', 'a'],
            ['soon', 'a'],
        ]);
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

    it('opens crew slots to anyone and fills them from the reserves', async () => {
        const crew = crews.create(people[2], { name: 'Moxes', tagline: '' });
        const gig = gigs.create(admin, input([{ crewId: crew.id, count: 1 }]));
        await gigs.join('c', gig.id);
        const after = gigs.openCrewSlots(admin, gig.id, crew.id);
        assert.deepEqual(
            after.slots.map((s) => [s.crew, s.runner?.id]),
            [[null, 'c']],
        );
        assert.throws(() => gigs.openCrewSlots(people[3], gig.id, crew.id), /Forbidden/);
    });

    const states = (id: number) => gigs.get(admin, id).slots.map((s) => [s.runner?.id ?? null, s.state]);

    it('marks runners interested until a time is set, then asks them to confirm', async () => {
        const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
        assert.match(await gigs.join('a', gig.id), /on the list/);
        await gigs.join('b', gig.id);
        assert.deepEqual(states(gig.id), [['a', 'interested'], ['b', 'interested']]);

        gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
        await settle();
        assert.deepEqual(asked, ['a', 'b']);
        assert.deepEqual(states(gig.id), [['a', 'awaiting'], ['b', 'awaiting']]);

        assert.match(gigs.confirm('a', gig.id), /confirmed/);
        assert.match(await gigs.join('b', gig.id), /confirmed/);
        assert.deepEqual(states(gig.id), [['a', 'confirmed'], ['b', 'confirmed']]);
    });

    it('confirms new runners straight away once a time is set, but asks people an admin adds', async () => {
        const gig = gigs.create(admin, input([{ crewId: null, count: 2 }]));
        gigs.setSession(admin, gig.id, Date.UTC(2077, 0, 1, 20));
        await gigs.join('a', gig.id);
        await gigs.assign(admin, gig.id, 'b');
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
        assert.deepEqual(gigs.get(admin, gig.id).reserves.map((r) => r.id), ['c']);
        assert.deepEqual(asked, ['b']);
    });

    it('fills new slots from the reserves', async () => {
        const gig = gigs.create(admin, input([{ crewId: null, count: 1 }]));
        await gigs.join('a', gig.id);
        await gigs.join('b', gig.id);
        gigs.update(admin, gig.id, input([{ crewId: null, count: 2 }]));
        assert.deepEqual(states(gig.id), [['a', 'interested'], ['b', 'interested']]);
        assert.equal(gigs.get(admin, gig.id).reserves.length, 0);
    });

    it('makes fixers the fixer of their own gigs', () => {
        const gig = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
        assert.equal(gig.fixerName, 'fixer');
        assert.equal(gig.fixerId, 'fixer');
    });

    it('links an admin-typed fixer name to the person with the fixer role', () => {
        assert.equal(gigs.create(admin, { ...input([{ crewId: null, count: 1 }]), fixerName: 'FIXER' }).fixerId, 'fixer');
        assert.equal(gigs.create(admin, input([{ crewId: null, count: 1 }])).fixerId, null);
    });

    it("lets a gig's fixer complete it, but not someone else's", () => {
        const theirs = gigs.create(admin, { ...input([{ crewId: null, count: 1 }]), fixerName: 'fixer' });
        const npc = gigs.create(admin, input([{ crewId: null, count: 1 }]));
        assert.equal(gigs.setStatus(fixer, theirs.id, 'completed').status, 'completed');
        assert.throws(() => gigs.setStatus(fixer, npc.id, 'completed'), /Forbidden/);
    });

    it('posts admin gigs straight away and holds fixer gigs for approval', () => {
        assert.equal(gigs.create(admin, input([{ crewId: null, count: 1 }])).status, 'open');
        const pending = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
        assert.equal(pending.status, 'pending');

        assert.equal(gigs.list(people[2]).length, 1);
        assert.equal(gigs.list(fixer).length, 2);
        assert.equal(gigs.approve(admin, pending.id, true).status, 'open');
    });

    it('fills crew slots first, then open ones', async () => {
        const crew = crews.create(people[2], { name: 'Moxes', tagline: '' });
        await crews.addMember(people[2], crew.id, 'b');
        const gig = gigs.create(admin, input([{ crewId: crew.id, count: 1 }, { crewId: null, count: 1 }]));

        await gigs.join('b', gig.id);
        await gigs.join('a', gig.id);
        const slots = gigs.get(admin, gig.id).slots;
        assert.deepEqual(
            slots.map((s) => [s.crew?.name ?? null, s.runner?.id]),
            [['Moxes', 'b'], [null, 'a']],
        );

        assert.match(await gigs.join('c', gig.id), /reserve #1/);
        await assert.rejects(gigs.join('a', gig.id), /already/);
        await assert.rejects(gigs.join('c', gig.id), /already on the reserves/);
    });

    it('keeps outsiders out of crew slots', async () => {
        const crew = crews.create(people[2], { name: 'Moxes', tagline: '' });
        const gig = gigs.create(admin, input([{ crewId: crew.id, count: 2 }]));
        assert.match(await gigs.join('c', gig.id), /reserve/);
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
        assert.equal(gigs.update(admin, gig.id, input([{ crewId: null, count: 2 }])).slots.length, 2);
        await gigs.join('b', gig.id);
        assert.throws(() => gigs.update(admin, gig.id, input([{ crewId: null, count: 1 }])), /already taken/);
    });

    it('opens up crew slots when the crew is deleted', () => {
        const crew = crews.create(people[2], { name: 'Moxes', tagline: '' });
        const gig = gigs.create(admin, input([{ crewId: crew.id, count: 1 }]));
        crews.delete(people[2], crew.id);
        assert.equal(gigs.get(admin, gig.id).slots[0].crew, null);
    });

    it('lets fixers edit only their own pending gigs', () => {
        const gig = gigs.create(fixer, input([{ crewId: null, count: 1 }]));
        gigs.update(fixer, gig.id, { ...input([{ crewId: null, count: 2 }]), name: 'Changed' });
        gigs.approve(admin, gig.id, true);
        assert.throws(() => gigs.update(fixer, gig.id, input([{ crewId: null, count: 2 }])), /Forbidden/);
    });
});
