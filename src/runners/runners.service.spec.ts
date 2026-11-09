import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { PrefsService } from '../auth/prefs.service';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import { NotifyService } from '../discord/notify.service';
import { CrewsService } from '../crews/crews.service';
import { GigsService } from '../gigs/gigs.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import { CORE_ROLES, type Me, type RunnerInput, runnerInput } from '../shared/schemas';
import { DowntimeService } from './downtime.service';
import { RunnersService } from './runners.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({ id, name: id, avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: true, timezone: null, needsSetup: false, ...roles });
const admin = person('admin', { isAdmin: true, isEdgerunner: false });
const players = [admin, person('a'), person('b')];

const members = {
    me: async (id: string) => players.find((p) => p.id === id) ?? null,
    member: (id: string) => ({ id, name: id, avatar: null }),
    isEdgerunner: (id: string) => !!players.find((p) => p.id === id)?.isEdgerunner,
    isFixerRunner: (r: { role: string; ownerId: string | null }) => r.role === 'Fixer' && !r.ownerId,
    admins: () => [],
    dm: async () => [],
} as unknown as MembersService;
const settings = { get: () => ({ guildId: '1', runnerRoles: CORE_ROLES, reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
const library = { exists: async () => true, pick: async () => null, refreshUsage: async () => {} } as unknown as LibraryService;
const posts = { sync: async () => ({ threadId: 'thread', overflowIds: [] }), askToConfirm: async () => {} } as unknown as GigPostService;

const input = (patch: Partial<RunnerInput> = {}): RunnerInput => ({
    handle: 'Vex',
    role: 'Netrunner',
    extraRoles: [],
    imageId: null,
    artIds: [],
    tagline: null,
    living: null,
    lifestyle: null,
    customLiving: null,
    fixerAlias: null,
    officeLocation: null,
    specialties: null,
    contact: null,
    bio: null,
    ...patch,
});

describe('RunnersService', () => {
    let runners: RunnersService;
    let gigs: GigsService;

    beforeEach(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        await emptyDb();
        const prefs = new PrefsService(prisma);
        const notify = new NotifyService(prefs, members, prisma);
        gigs = new GigsService(prisma, members, posts, settings, library, prefs, notify);
        runners = new RunnersService(prisma, members, settings, library, gigs, new CrewsService(prisma, members, gigs, notify), new DowntimeService(prisma, notify, { get: () => '' } as never, {} as never));
    });

    after(() => prisma.$disconnect());

    describe('gallery', () => {
        const pictures = () => Promise.all([1, 2, 3].map(async () => (await prisma.image.create({ data: { inLibrary: false, kind: 'art' } })).id));

        it('keeps pictures in the order given', async () => {
            const [one, two, three] = await pictures();
            const vex = await runners.create(players[1], input({ artIds: [three, one, two] }));
            assert.deepEqual((await runners.get(players[1], vex.id)).artIds, [three, one, two]);
        });

        it('replaces the set on saving', async () => {
            const [one, two, three] = await pictures();
            const vex = await runners.create(players[1], input({ artIds: [one, two] }));
            await runners.update(players[1], vex.id, input({ artIds: [three, one] }));
            assert.deepEqual((await runners.get(players[1], vex.id)).artIds, [three, one]);
            await runners.update(players[1], vex.id, input());
            assert.deepEqual((await runners.get(players[1], vex.id)).artIds, []);
        });

        it('shows to everyone', async () => {
            const [one] = await pictures();
            const vex = await runners.create(players[1], input({ artIds: [one] }));
            assert.deepEqual((await runners.get(players[2], vex.id)).artIds, [one]);
        });

        it('checks the pictures exist', async () => {
            const exists = library.exists;
            library.exists = async () => false;
            await assert.rejects(runners.create(players[1], input({ artIds: ['aaaaaaaa-0000-4000-8000-000000000000'] })), /Upload it again/);
            library.exists = exists;
        });

        it('takes at most twelve, once each', () => {
            const ids = Array.from({ length: 13 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
            const base = { handle: 'Vex', role: 'Solo', extraRoles: [], imageId: null, fixerAlias: null, officeLocation: null, specialties: null, contact: null, bio: null };
            assert.equal(runnerInput.safeParse({ ...base, artIds: ids }).success, false);
            assert.deepEqual(runnerInput.parse({ ...base, artIds: [ids[0], ids[0]] }).artIds, [ids[0]]);
        });
    });

    describe('downtime', () => {
        it('only shows it to their player and admins', async () => {
            const vex = await runners.create(players[1], input({ living: 'low-1', lifestyle: 'low' }));
            assert.equal((await runners.get(players[1], vex.id)).downtime?.totals.dtMonth, 17);
            assert.equal((await runners.get(admin, vex.id)).downtime?.living, 'low-1');
            assert.equal((await runners.get(players[2], vex.id)).downtime, null);
        });

        it('has none for NPCs', async () => {
            const npc = await runners.create(admin, input({ ownerId: null, role: 'Fixer', handle: 'Mr Blue' }));
            assert.equal((await runners.get(admin, npc.id)).downtime, null);
        });

        it('starts paying the month after it is set up', async () => {
            const vex = await runners.create(players[1], input());
            assert.equal((await prisma.runner.findUniqueOrThrow({ where: { id: vex.id } })).downtimeGrantedFor, null);
            await runners.update(players[1], vex.id, input({ lifestyle: 'squalid' }));
            const month = (await prisma.runner.findUniqueOrThrow({ where: { id: vex.id } })).downtimeGrantedFor;
            assert.match(month!, /^\d{4}-\d{2}$/);
            await prisma.runner.update({ where: { id: vex.id }, data: { downtimeGrantedFor: '2020-01' } });
            await runners.update(players[1], vex.id, input({ lifestyle: 'low' }));
            assert.equal((await prisma.runner.findUniqueOrThrow({ where: { id: vex.id } })).downtimeGrantedFor, '2020-01');
        });

        it('only keeps custom numbers while living is custom', async () => {
            const customLiving = { name: 'Flat', dtMonth: 14, dtGig: 5, rent: 500, humanity: 0 };
            const vex = await runners.create(players[1], input({ living: 'custom', customLiving }));
            assert.deepEqual((await runners.get(players[1], vex.id)).downtime?.customLiving, customLiving);
            await runners.update(players[1], vex.id, input({ living: 'coffin', customLiving }));
            assert.equal((await runners.get(players[1], vex.id)).downtime?.customLiving, null);
        });
    });

    it("makes a player's runner their own", async () => {
        assert.equal((await runners.create(players[1], input())).ownerId, 'a');
    });

    it('lets admins make runners for a player, or NPC fixers', async () => {
        assert.equal((await runners.create(admin, input({ ownerId: 'b' }))).ownerId, 'b');
        assert.equal((await runners.create(admin, input({ ownerId: null, role: 'Fixer', handle: 'Mr Blue' }))).ownerId, null);
        await assert.rejects(runners.create(admin, input({ ownerId: null, handle: 'Mr Green' })), /NPC needs the Fixer role/);
        await assert.rejects(runners.create(admin, input({ ownerId: 'stranger', handle: 'Mr Red' })), /isn't on the server/);
    });

    it('keeps handles one of a kind, as links compare them', async () => {
        await runners.create(players[1], input({ handle: 'Mr. B' }));
        await assert.rejects(runners.create(admin, input({ ownerId: 'b', handle: 'mr b' })), /taken/);
        await assert.rejects(runners.create(admin, input({ ownerId: 'b', handle: '2077' })), /can't be used/);
        // One letter is fine
        assert.equal((await runners.create(admin, input({ ownerId: 'b', handle: 'V' }))).slug, 'v');
    });

    it('gives a fixer alias its own link, one of a kind with the handles', async () => {
        const vex = await runners.create(players[1], input({ handle: 'Vex', fixerAlias: 'Mr. Hands' }));
        assert.equal(vex.fixerName, 'Mr. Hands');
        assert.equal(vex.fixerSlug, 'mr-hands');
        assert.equal(await runners.resolve('mr-hands'), vex.id);
        await assert.rejects(runners.create(admin, input({ ownerId: 'b', handle: 'Mr Hands' })), /taken/);
        await assert.rejects(runners.create(admin, input({ ownerId: 'b', handle: 'Kit', fixerAlias: 'vex' })), /taken/);
        // The same as their own handle is no alias
        const same = await runners.update(players[1], vex.id, input({ handle: 'Vex', fixerAlias: 'VEX' }));
        assert.equal(same.fixerAlias, null);
        assert.equal(same.fixerSlug, 'vex');
    });

    it('finds runners by handle or UUID, and moves the link on a rename', async () => {
        const vex = await runners.create(players[1], input({ handle: 'Vex' }));
        assert.equal(await runners.resolve('vex'), vex.id);
        assert.equal(await runners.resolve('VEX'), vex.id);
        assert.equal(await runners.resolve(vex.id), vex.id);
        const renamed = await runners.update(players[1], vex.id, input({ handle: 'Vex Prime' }));
        assert.equal(renamed.slug, 'vex-prime');
        assert.equal(await runners.resolve('vex-prime'), vex.id);
        // Saving without a rename keeps the handle and link it already has
        assert.equal((await runners.update(players[1], vex.id, input({ handle: 'Vex Prime' }))).slug, 'vex-prime');
    });

    it("won't let players make runners for someone else", async () => {
        await assert.rejects(runners.create(players[1], input({ ownerId: 'b' })), /Forbidden/);
        await assert.rejects(runners.create(players[1], input({ ownerId: null, role: 'Fixer' })), /Forbidden/);
    });

    it('lets admins hand a runner to another player, but not mid-gig', async () => {
        const vex = await runners.create(players[1], input());
        assert.equal((await runners.update(admin, vex.id, input({ ownerId: 'b' }))).ownerId, 'b');

        const gig = await gigs.create(admin, {
            name: 'Job',
            fixerName: 'Rogue',
            fixerRunnerId: null,
            location: 'Watson',
            type: null,
            pay: 100,
            splitPay: false,
            brief: 'Go.',
            primaryObjective: ['Go.'],
            imageId: null,
            objectives: [],
            slots: [{ crewId: null, count: 1 }],
        });
        await gigs.join('b', gig.id);
        await assert.rejects(runners.update(admin, vex.id, input({ ownerId: 'a' })), /off their live gigs/);
        // Editing other things is fine
        assert.equal((await runners.update(admin, vex.id, input({ handle: 'Vex Prime' }))).handle, 'Vex Prime');
    });
});
