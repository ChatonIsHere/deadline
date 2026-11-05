import '../test-env';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { CrewsService } from '../crews/crews.service';
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

const posts = { sync: async () => 'thread' } as unknown as GigPostService;
const settings = { get: () => ({ guildId: '1' }) } as unknown as SettingsService;
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

    beforeEach(() => {
        const db = openDb(':memory:');
        gigs = new GigsService(db, members, posts, settings, library);
        crews = new CrewsService(db, members, gigs);
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

        await assert.rejects(gigs.join('c', gig.id), /no slot open/);
        await assert.rejects(gigs.join('a', gig.id), /already/);
    });

    it('keeps outsiders out of crew slots', async () => {
        const crew = crews.create(people[2], { name: 'Moxes', tagline: '' });
        const gig = gigs.create(admin, input([{ crewId: crew.id, count: 2 }]));
        await assert.rejects(gigs.join('c', gig.id), /no slot open/);
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
