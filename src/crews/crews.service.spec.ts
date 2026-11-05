import '../test-env';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { PrefsService } from '../auth/prefs.service';
import { type Db, openDb } from '../db/db';
import { runners } from '../db/schema';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import { GigsService } from '../gigs/gigs.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import type { Me } from '../shared/schemas';
import { CrewsService } from './crews.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({ id, name: id, avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: true, ...roles });
const admin = person('admin', { isAdmin: true, isEdgerunner: false });
const [a, b, c] = [person('a'), person('b'), person('c')];

let dms: string[] = [];
const members = {
    member: (id: string) => ({ id, name: id, avatar: null }),
    isEdgerunner: () => true,
    isFixerRunner: () => false,
    dm: async (ids: string[]) => {
        dms.push(...ids);
        return [];
    },
} as unknown as MembersService;
const posts = { sync: async () => ({ threadId: 'thread', overflowIds: [] }) } as unknown as GigPostService;
const settings = { get: () => ({ guildId: '1', reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
const library = { exists: () => true, pick: () => null } as unknown as LibraryService;

describe('CrewsService', () => {
    let db: Db;
    let crews: CrewsService;
    /** Runner IDs by handle. Each player has one, named after them. */
    let ids: Record<string, number>;

    beforeEach(() => {
        db = openDb(':memory:');
        const gigs = new GigsService(db, members, posts, settings, library, new PrefsService(db));
        crews = new CrewsService(db, members, gigs);
        dms = [];
        ids = {};
        for (const owner of ['a', 'b', 'c']) {
            ids[owner] = db.insert(runners).values({ ownerId: owner, handle: owner, role: 'Solo' }).returning().get().id;
        }
        ids.npc = db.insert(runners).values({ ownerId: null, handle: 'npc', role: 'Fixer' }).returning().get().id;
    });

    const make = () => crews.create(a, { name: 'Moxes', tagline: '', runnerId: ids.a });
    const ranks = (crewId: number) => crews.get(crewId).members.map((m) => [m.handle, m.rank]);

    it('makes the founding runner a Founder', () => {
        const crew = make();
        assert.deepEqual(ranks(crew.id), [['a', 'Founder']]);
        assert.throws(() => crews.create(b, { name: 'Other', tagline: '', runnerId: ids.a }), /your own runners/);
    });

    it('invites by DM, and the player joins at the lowest rank', async () => {
        const crew = make();
        assert.deepEqual(await crews.invite(a, crew.id, ids.b), { dm: true });
        assert.deepEqual(dms, ['b']);
        await assert.rejects(crews.invite(a, crew.id, ids.b), /already have an invite/);
        assert.throws(() => crews.accept('c', crew.id, ids.b), /Forbidden/);

        crews.accept('b', crew.id, ids.b);
        assert.deepEqual(ranks(crew.id), [['a', 'Founder'], ['b', 'Member']]);
        assert.equal(crews.get(crew.id).invites.length, 0);
        assert.throws(() => crews.accept('b', crew.id, ids.b), /invite is gone/);
    });

    it('only lets founders and admins invite', async () => {
        const crew = make();
        await assert.rejects(crews.invite(b, crew.id, ids.c), /Forbidden/);
        await assert.rejects(crews.invite(a, crew.id, ids.npc), /NPCs can't join/);
        assert.throws(() => crews.addMember(a, crew.id, ids.b), /Forbidden/);
        crews.addMember(admin, crew.id, ids.b);
        assert.equal(crews.get(crew.id).members.length, 2);
    });

    it('keeps at least one founder, and founders can only be stepped down by someone else', () => {
        const crew = make();
        crews.addMember(admin, crew.id, ids.b);
        assert.throws(() => crews.setRank(a, crew.id, ids.a, 'Member'), /yourself/);
        assert.throws(() => crews.setRank(admin, crew.id, ids.a, 'Member'), /at least one Founder/);
        assert.throws(() => crews.removeMember(a, crew.id, ids.a), /yourself/);

        crews.setRank(a, crew.id, ids.b, 'Founder');
        // Now b runs the crew too, and can step a down
        crews.setRank(b, crew.id, ids.a, 'Member');
        assert.deepEqual(ranks(crew.id), [['b', 'Founder'], ['a', 'Member']]);
        assert.throws(() => crews.setRank(a, crew.id, ids.b, 'Member'), /Forbidden/);
    });

    it('renames ranks with their runners, and drops runners in removed ranks to the lowest', () => {
        const crew = make();
        crews.addMember(admin, crew.id, ids.b);
        crews.addMember(admin, crew.id, ids.c);
        // Add a rank between the two defaults and put c in it
        crews.update(a, crew.id, {
            name: 'Moxes',
            tagline: '',
            ranks: [
                { name: 'Founder', was: 'Founder' },
                { name: 'Lieutenant', was: null },
                { name: 'Member', was: 'Member' },
            ],
        });
        crews.setRank(a, crew.id, ids.c, 'Lieutenant');
        // Rename two, remove Lieutenant
        crews.update(a, crew.id, {
            name: 'Moxes',
            tagline: '',
            ranks: [
                { name: 'Boss', was: 'Founder' },
                { name: 'Kid', was: 'Member' },
            ],
        });
        assert.deepEqual(crews.get(crew.id).ranks, ['Boss', 'Kid']);
        assert.deepEqual(ranks(crew.id), [['a', 'Boss'], ['b', 'Kid'], ['c', 'Kid']]);
        assert.throws(
            () => crews.update(a, crew.id, { name: 'Moxes', tagline: '', ranks: [{ name: 'Kid', was: 'Kid' }, { name: 'Boss', was: 'Boss' }] }),
            /stays the top rank/,
        );
    });

    it('keeps allies apart from members, and joining clears the ally entry', async () => {
        const crew = make();
        crews.addAlly(a, crew.id, ids.npc);
        crews.addAlly(a, crew.id, ids.b);
        assert.throws(() => crews.addAlly(a, crew.id, ids.a), /already in the crew/);
        assert.deepEqual(crews.get(crew.id).allies.map((r) => r.handle), ['b', 'npc']);

        await crews.invite(a, crew.id, ids.b);
        crews.accept('b', crew.id, ids.b);
        assert.deepEqual(crews.get(crew.id).allies.map((r) => r.handle), ['npc']);
    });

    it('promotes someone when the last founder is deleted', () => {
        const crew = make();
        crews.addMember(admin, crew.id, ids.b);
        crews.addMember(admin, crew.id, ids.c);
        // What RunnersService.delete does. Same rank, so the first by handle takes over.
        const affected = crews.crewsOf(ids.a);
        db.delete(runners).where(eq(runners.id, ids.a)).run();
        crews.keepFounders(affected);
        assert.deepEqual(ranks(crew.id), [['b', 'Founder'], ['c', 'Member']]);
    });

    it('gives crews a typed ID, made from the name unless one is picked', () => {
        const crew = make();
        assert.equal(crew.slug, 'moxes');
        assert.equal(crews.resolve('moxes'), crew.id);
        assert.equal(crews.resolve('MOXES'), crew.id);
        assert.equal(crews.resolve(String(crew.id)), crew.id);
        assert.throws(() => crews.resolve('nobody'), /No such crew/);

        // Taken names get a number, reserved words a prefix, picked ones are checked
        assert.equal(crews.create(b, { name: 'Moxes!', tagline: '', runnerId: ids.b }).slug, 'moxes-2');
        assert.equal(crews.create(c, { name: 'New', tagline: '', runnerId: ids.c }).slug, 'crew-new');
        assert.throws(() => crews.create(admin, { name: 'Other', slug: 'moxes', tagline: '', runnerId: ids.a }), /ID is taken/);
    });
});
