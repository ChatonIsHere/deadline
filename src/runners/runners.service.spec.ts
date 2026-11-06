import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { PrefsService } from '../auth/prefs.service';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import { CrewsService } from '../crews/crews.service';
import { GigsService } from '../gigs/gigs.service';
import type { LibraryService } from '../library/library.service';
import type { SettingsService } from '../settings/settings.service';
import { CORE_ROLES, type Me, type RunnerInput } from '../shared/schemas';
import { RunnersService } from './runners.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({ id, name: id, avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: true, ...roles });
const admin = person('admin', { isAdmin: true, isEdgerunner: false });
const players = [admin, person('a'), person('b')];

const members = {
    me: async (id: string) => players.find((p) => p.id === id) ?? null,
    member: (id: string) => ({ id, name: id, avatar: null }),
    isEdgerunner: (id: string) => !!players.find((p) => p.id === id)?.isEdgerunner,
    isFixerRunner: (r: { role: string; ownerId: string | null }) => r.role === 'Fixer' && !r.ownerId,
} as unknown as MembersService;
const settings = { get: () => ({ guildId: '1', runnerRoles: CORE_ROLES, reminderHours: 8, confirmHours: 48 }) } as unknown as SettingsService;
const library = { exists: async () => true, pick: async () => null, refreshUsage: async () => {} } as unknown as LibraryService;
const posts = { sync: async () => ({ threadId: 'thread', overflowIds: [] }), askToConfirm: async () => {} } as unknown as GigPostService;

const input = (patch: Partial<RunnerInput> = {}): RunnerInput => ({
    handle: 'Vex',
    role: 'Netrunner',
    extraRoles: [],
    imageId: null,
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
        gigs = new GigsService(prisma, members, posts, settings, library, new PrefsService(prisma));
        runners = new RunnersService(prisma, members, settings, library, gigs, new CrewsService(prisma, members, gigs));
    });

    after(() => prisma.$disconnect());

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
