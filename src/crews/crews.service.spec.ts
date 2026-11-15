import { emptyDb, prisma, withLimits } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { PrefsService } from '../auth/prefs.service';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import { NotifyService } from '../discord/notify.service';
import { GigsService } from '../gigs/gigs.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import type { Me } from '../shared/schemas';
import { toSlug } from '../shared/slug';
import { CrewsService } from './crews.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({ id, name: id, avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: true, timezone: null, needsSetup: false, ...roles });
const admin = person('admin', { isAdmin: true, isEdgerunner: false });
const [a, b, c] = [person('a'), person('b'), person('c')];

let dms: string[] = [];
const members = {
    member: (id: string) => ({ id, name: id, avatar: null }),
    isEdgerunner: () => true,
    isFixerRunner: () => false,
    admins: () => [],
    dm: async (ids: string[]) => {
        dms.push(...ids);
        return [];
    },
} as unknown as MembersService;
const posts = { sync: async () => ({ threadId: 'thread', overflowIds: [] }) } as unknown as GigPostService;
const settings = { get: () => ({ guildId: '1', reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
/** Pictures the service said had changed use. */
let refreshed: (string | null | undefined)[] = [];
let pictureExists = true;
const library = {
    exists: async () => pictureExists,
    pick: async () => null,
    refreshUsage: async (ids: (string | null | undefined)[]) => {
        refreshed.push(...ids);
    },
} as unknown as LibraryService;

describe('CrewsService', () => {
    let crews: CrewsService;
    /** Runner IDs by handle. Each player has one, named after them. */
    let ids: Record<string, string>;

    const addRunner = async (ownerId: string | null, handle: string, role = 'Solo') =>
        (ids[handle] = (await prisma.runner.create({ data: { ownerId, handle, role, slug: toSlug(handle) } })).id);

    beforeEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await emptyDb();
        const prefs = new PrefsService(prisma);
        const notify = new NotifyService(prefs, members, prisma);
        const gigs = new GigsService(prisma, members, posts, settings, library, prefs, notify);
        crews = new CrewsService(prisma, members, gigs, notify, library);
        refreshed = [];
        dms = [];
        ids = {};
        for (const owner of ['a', 'b', 'c']) await addRunner(owner, owner);
        await addRunner(null, 'npc', 'Fixer');
    });

    after(() => prisma.$disconnect());

    const make = () => crews.create(a, { name: 'Moxes', tagline: '', runnerId: ids.a });

    describe('logo', () => {
        const picture = async () => (await prisma.image.create({ data: { inLibrary: false, kind: 'avatar' } })).id;
        const save = (user: Me, crew: { id: string; name: string; ranks: string[] }, imageId: string | null) =>
            crews.update(user, crew.id, { name: crew.name, tagline: '', imageId, ranks: crew.ranks.map((name) => ({ name, was: name })) });

        it('starts with none', async () => {
            assert.equal((await make()).imageId, null);
        });

        it('can be set, replaced and removed by a founder', async () => {
            const crew = await make();
            const [one, two] = [await picture(), await picture()];
            assert.equal((await save(a, crew, one)).imageId, one);
            assert.equal((await save(a, crew, two)).imageId, two);
            assert.ok(refreshed.includes(one) && refreshed.includes(two));
            assert.equal((await save(a, crew, null)).imageId, null);
        });

        it('can be set by an admin, but not by anyone else', async () => {
            const crew = await make();
            const one = await picture();
            await assert.rejects(save(b, crew, one), /Forbidden/);
            assert.equal((await save(admin, crew, one)).imageId, one);
        });

        it('has to exist', async () => {
            const crew = await make();
            pictureExists = false;
            await assert.rejects(save(a, crew, 'aaaaaaaa-0000-4000-8000-000000000000'), /gone/);
            pictureExists = true;
        });

        it('is let go when the crew disbands', async () => {
            const crew = await make();
            const one = await picture();
            await save(a, crew, one);
            refreshed = [];
            await crews.delete(a, crew.id);
            assert.deepEqual(refreshed, [one]);
        });
    });
    const ranks = async (crewId: string) => (await crews.get(crewId)).members.map((m) => [m.handle, m.rank]);

    it('makes the founding runner a Founder', async () => {
        const crew = await make();
        assert.deepEqual(await ranks(crew.id), [['a', 'Founder']]);
        await assert.rejects(crews.create(b, { name: 'Other', tagline: '', runnerId: ids.a }), /your own runners/);
    });

    it('invites by DM, and the player joins at the lowest rank', async () => {
        const crew = await make();
        assert.deepEqual(await crews.invite(a, crew.id, ids.b), { dm: true });
        assert.deepEqual(dms, ['b']);
        await assert.rejects(crews.invite(a, crew.id, ids.b), /already have an invite/);
        await assert.rejects(crews.accept('c', crew.id, ids.b), /Forbidden/);

        await crews.accept('b', crew.id, ids.b);
        assert.deepEqual(await ranks(crew.id), [['a', 'Founder'], ['b', 'Member']]);
        assert.equal((await crews.get(crew.id)).invites.length, 0);
        await assert.rejects(crews.accept('b', crew.id, ids.b), /invite is gone/);
    });

    it('waits a while before a crew can ask a runner who said no again', async () => {
        const crew = await make();
        await crews.invite(a, crew.id, ids.b);
        await crews.decline('b', crew.id, ids.b);
        await assert.rejects(crews.invite(a, crew.id, ids.b), /turned down an invite recently. you can ask again in 7 days/);
        await crews.invite(admin, crew.id, ids.b);
        await crews.cancelInvite(admin, crew.id, ids.b);
        await withLimits({ INVITE_COOLDOWN_DAYS: 0 }, async () => {
            await crews.invite(a, crew.id, ids.b);
        });
    });

    it('limits crews founded, crews per runner, members, waiting invites and allies', async () => {
        await withLimits({ MAX_CREWS_FOUNDED: 1, MAX_CREWS_PER_RUNNER: 1, MAX_CREW_MEMBERS: 2, MAX_PENDING_INVITES: 1, MAX_CREW_ALLIES: 1 }, async () => {
            const crew = await make();
            await assert.rejects(crews.create(a, { name: 'Second', tagline: '', runnerId: ids.a }), /founded 1 crews/);
            const other = await crews.create(b, { name: 'Other', tagline: '', runnerId: ids.b });
            // b's runner is in a crew already
            await assert.rejects(crews.invite(a, crew.id, ids.b), /in 1 crews already/);
            await crews.invite(a, crew.id, ids.c);
            await addRunner('c', 'c2');
            await assert.rejects(crews.invite(a, crew.id, ids.c2), /invites waiting/);
            await crews.accept('c', crew.id, ids.c);
            await assert.rejects(crews.invite(a, crew.id, ids.c2), /crew is full/);
            await crews.addAlly(a, crew.id, ids.c2);
            await assert.rejects(crews.addAlly(a, crew.id, ids.npc), /1 allies at most/);
            assert.ok(other);
        });
    });

    it('only lets founders and admins invite', async () => {
        const crew = await make();
        await assert.rejects(crews.invite(b, crew.id, ids.c), /Forbidden/);
        await assert.rejects(crews.invite(a, crew.id, ids.npc), /NPCs can't join/);
        await assert.rejects(crews.addMember(a, crew.id, ids.b), /Forbidden/);
        await crews.addMember(admin, crew.id, ids.b);
        assert.equal((await crews.get(crew.id)).members.length, 2);
    });

    it('keeps at least one founder, and founders can only be stepped down by someone else', async () => {
        const crew = await make();
        await crews.addMember(admin, crew.id, ids.b);
        await assert.rejects(crews.setRank(a, crew.id, ids.a, 'Member'), /yourself/);
        await assert.rejects(crews.setRank(admin, crew.id, ids.a, 'Member'), /at least one Founder/);
        await assert.rejects(crews.removeMember(a, crew.id, ids.a), /yourself/);

        await crews.setRank(a, crew.id, ids.b, 'Founder');
        // Now b runs the crew too, and can step a down
        await crews.setRank(b, crew.id, ids.a, 'Member');
        assert.deepEqual(await ranks(crew.id), [['b', 'Founder'], ['a', 'Member']]);
        await assert.rejects(crews.setRank(a, crew.id, ids.b, 'Member'), /Forbidden/);
    });

    it('renames ranks with their runners, and drops runners in removed ranks to the lowest', async () => {
        const crew = await make();
        await crews.addMember(admin, crew.id, ids.b);
        await crews.addMember(admin, crew.id, ids.c);
        // Add a rank between the two defaults and put c in it
        await crews.update(a, crew.id, {
            name: 'Moxes',
            tagline: '',
            imageId: null,
            ranks: [
                { name: 'Founder', was: 'Founder' },
                { name: 'Lieutenant', was: null },
                { name: 'Member', was: 'Member' },
            ],
        });
        await crews.setRank(a, crew.id, ids.c, 'Lieutenant');
        // Rename two, remove Lieutenant
        await crews.update(a, crew.id, {
            name: 'Moxes',
            tagline: '',
            imageId: null,
            ranks: [
                { name: 'Boss', was: 'Founder' },
                { name: 'Kid', was: 'Member' },
            ],
        });
        assert.deepEqual((await crews.get(crew.id)).ranks, ['Boss', 'Kid']);
        assert.deepEqual(await ranks(crew.id), [['a', 'Boss'], ['b', 'Kid'], ['c', 'Kid']]);
        await assert.rejects(
            crews.update(a, crew.id, { name: 'Moxes', tagline: '', imageId: null, ranks: [{ name: 'Kid', was: 'Kid' }, { name: 'Boss', was: 'Boss' }] }),
            /stays the top rank/,
        );
    });

    it('keeps allies apart from members, and joining clears the ally entry', async () => {
        const crew = await make();
        await crews.addAlly(a, crew.id, ids.npc);
        await crews.addAlly(a, crew.id, ids.b);
        await assert.rejects(crews.addAlly(a, crew.id, ids.a), /already in the crew/);
        assert.deepEqual((await crews.get(crew.id)).allies.map((r) => r.handle), ['b', 'npc']);

        await crews.invite(a, crew.id, ids.b);
        await crews.accept('b', crew.id, ids.b);
        assert.deepEqual((await crews.get(crew.id)).allies.map((r) => r.handle), ['npc']);
    });

    it('promotes someone when the last founder is deleted', async () => {
        const crew = await make();
        await crews.addMember(admin, crew.id, ids.b);
        await crews.addMember(admin, crew.id, ids.c);
        // What RunnersService.delete does. Same rank, so the first by handle takes over.
        const affected = await crews.crewsOf(ids.a);
        await prisma.runner.delete({ where: { id: ids.a } });
        await crews.keepFounders(affected);
        assert.deepEqual(await ranks(crew.id), [['b', 'Founder'], ['c', 'Member']]);
    });

    it('links crews by name or UUID', async () => {
        const crew = await make();
        assert.equal(crew.slug, 'moxes');
        assert.equal(await crews.resolve('moxes'), crew.id);
        assert.equal(await crews.resolve('MOXES'), crew.id);
        assert.equal(await crews.resolve(crew.id), crew.id);
        assert.equal(await crews.resolve(crew.id.toUpperCase()), crew.id);
        await assert.rejects(crews.resolve('nobody'), /No such crew/);
    });

    it('keeps crew names one of a kind, as links compare them', async () => {
        await make();
        await assert.rejects(crews.create(b, { name: 'Moxes!', tagline: '', runnerId: ids.b }), /taken/);
        await assert.rejects(crews.create(c, { name: 'New', tagline: '', runnerId: ids.c }), /can't be used/);
    });

    it('moves the link when a crew is renamed', async () => {
        const crew = await make();
        const renamed = await crews.update(a, crew.id, { name: 'The Moxes', tagline: '', imageId: null, ranks: crew.ranks.map((name) => ({ name, was: name })) });
        assert.equal(renamed.slug, 'the-moxes');
        assert.equal(await crews.resolve('the-moxes'), crew.id);
    });
});
