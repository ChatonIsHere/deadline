import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { PrefsService } from '../auth/prefs.service';
import { CrewsService } from '../crews/crews.service';
import type { GigPostService } from '../discord/gig-post.service';
import type { MembersService } from '../discord/members.service';
import { NotifyService } from '../discord/notify.service';
import { DebriefService } from '../gigs/debrief.service';
import { GigsService } from '../gigs/gigs.service';
import type { LibraryService } from '../library/library.service';
import type { LiveService } from '../live/live.service';
import type { PushPayload, PushService } from '../push/push.service';
import { DowntimeService } from '../runners/downtime.service';
import type { SettingsService } from '../settings/settings.service';
import type { ChatEvent, GigInput, Me } from '../shared/schemas';
import { toSlug } from '../shared/slug';
import { canSee, type ChatRelay, ChatsService, speakable } from './chats.service';

const person = (id: string, roles: Partial<Me> = {}): Me => ({ id, name: id, avatar: null, isOwner: false, isAdmin: false, isFixer: false, isEdgerunner: true, timezone: null, needsSetup: false, ...roles });
const admin = person('admin', { isAdmin: true, isEdgerunner: false });
const [a, b, c] = [person('a'), person('b'), person('c')];
/** The bot's owner with player view on: an admin on the server, but not while they browse as a player */
const ownerAsPlayer = person('owner', { isOwner: true, playerView: true });
const people = [admin, a, b, c, ownerAsPlayer];

const members = {
    me: async (id: string) => people.find((p) => p.id === id) ?? null,
    member: (id: string) => ({ id, name: id, avatar: null }),
    isEdgerunner: () => true,
    isFixerRunner: (r: { role: string; ownerId: string | null }) => r.role === 'Fixer',
    admins: () => ['admin', 'owner'],
    dm: async () => [],
} as unknown as MembersService;
const settings = { get: () => ({ guildId: '1', reminderHours: 8, confirmHours: 48, maxSignups: 0 }) } as unknown as SettingsService;
const library = { exists: async () => true, pick: async () => null, refreshUsage: async () => {} } as unknown as LibraryService;
const posts = { sync: async (gig: { id: string }) => ({ threadId: `thread-${gig.id}`, overflowIds: [] }), sendPayouts: async () => {} } as unknown as GigPostService;
/** Background work (gig posts, relay, push) */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

/** Every live event: who got it and what */
let events: { to: string[]; event: string; payload: ChatEvent }[] = [];
let viewing: { userId: string; chatId: string } | null = null;
const live = {
    toUsers: (ids: Iterable<string>, event: string, payload: ChatEvent) => events.push({ to: [...ids].sort(), event, payload }),
    isViewing: (userId: string, chatId: string) => viewing?.userId === userId && viewing.chatId === chatId,
    changed: () => {},
} as unknown as LiveService;
let pushed: { to: string[]; payload: PushPayload }[] = [];
const push = { notify: async (to: string[], payload: PushPayload) => void pushed.push({ to: [...to].sort(), payload }) } as unknown as PushService;
let relayed: string[] = [];
const relay: ChatRelay = {
    changed: async (chat) => void relayed.push(`changed:${chat.id}`),
    posted: async (_chat, m) => void relayed.push(`posted:${m.id}`),
    edited: async (_chat, m) => void relayed.push(`edited:${m.id}`),
    removed: async (_chat, m) => void relayed.push(`removed:${m.id}`),
};

const gigInput = (patch: Partial<GigInput> = {}): GigInput => ({
    name: 'Grab the data',
    fixerName: 'Rogue',
    fixerRunnerId: null,
    location: 'Watson',
    type: null,
    pay: 2000,
    splitPay: false,
    brief: 'Get in, get out.',
    primaryObjective: ['Grab the case.'],
    imageId: null,
    objectives: [],
    slots: [{ crewId: null, count: 3 }],
    ...patch,
});

describe('ChatsService', () => {
    let chats: ChatsService;
    let gigs: GigsService;
    let crews: CrewsService;
    let debrief: DebriefService;
    /** Runner IDs by handle. Players a, b and c have a runner each, named after them. "npc" is an NPC fixer. */
    let ids: Record<string, string>;

    const addRunner = async (ownerId: string | null, handle: string, role = 'Solo') =>
        (ids[handle] = (await prisma.runner.create({ data: { ownerId, handle, role, slug: toSlug(handle) } })).id);
    const say = (user: Me, chatId: string, as: string, body = 'hey choom') => chats.send(user, chatId, { asRunnerId: ids[as], body, imageIds: [] });

    beforeEach(async () => {
        await settle();
        await emptyDb();
        const prefs = new PrefsService(prisma);
        const notify = new NotifyService(prefs, members, prisma);
        chats = new ChatsService(prisma, live, members, settings, library, push);
        chats.attachRelay(relay);
        gigs = new GigsService(prisma, members, posts, settings, library, prefs, notify, chats);
        crews = new CrewsService(prisma, members, gigs, notify, library, chats);
        debrief = new DebriefService(prisma, gigs, posts, notify, new DowntimeService(prisma, notify, { get: () => '' } as never, {} as never), { get: () => '' } as never);
        ids = {};
        for (const p of ['a', 'b', 'c']) await addRunner(p, p);
        await addRunner(null, 'npc', 'Fixer');
        events = [];
        pushed = [];
        relayed = [];
        viewing = null;
    });

    after(async () => {
        await settle();
        await prisma.$disconnect();
    });

    describe('direct chats', () => {
        it('opens the same chat for the same two characters, from either side', async () => {
            const first = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            const again = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            const back = await chats.create(b, { asRunnerId: ids.b, recipientIds: [ids.a], name: null });
            assert.equal(first.kind, 'direct');
            assert.equal(again.id, first.id);
            assert.equal(back.id, first.id);
            assert.equal(first.title, 'b');
            assert.equal(back.title, 'a');
            assert.equal(first.directWith, ids.b);
        });

        it('is a different chat as a different character of yours', async () => {
            await addRunner('a', 'a2');
            const one = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            const two = await chats.create(a, { asRunnerId: ids.a2, recipientIds: [ids.b], name: null });
            assert.notEqual(one.id, two.id);
        });

        it("won't start as someone else's character, or with your own", async () => {
            await assert.rejects(chats.create(a, { asRunnerId: ids.b, recipientIds: [ids.c], name: null }), /your own characters/);
            await addRunner('a', 'a2');
            await assert.rejects(chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.a2], name: null }), /your own character/);
        });

        it('needs active characters on both sides', async () => {
            await prisma.runner.update({ where: { id: ids.b }, data: { status: 'dead' } });
            await assert.rejects(chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null }), /dead/);
        });
    });

    describe('group chats', () => {
        it('makes a new group every time, even with the same people', async () => {
            const one = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b, ids.c], name: 'Heist' });
            const two = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b, ids.c], name: null });
            assert.notEqual(one.id, two.id);
            assert.equal(one.kind, 'group');
            assert.equal(one.title, 'Heist');
            assert.equal(two.title, 'b, c');
        });

        it('can be renamed, added to and left', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            const group = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b, ids.npc], name: null });
            await assert.rejects(chats.rename(a, chat.id, 'nope'), /Only group chats/);
            assert.equal((await chats.rename(b, group.id, 'Crew')).title, 'Crew');
            const added = await chats.addMember(b, group.id, ids.c);
            assert.deepEqual(added.members.map((m) => m.handle).sort(), ['a', 'b', 'c', 'npc']);
            await assert.rejects(chats.leave(c, group.id, ids.a), /Forbidden/);
            await chats.leave(c, group.id, ids.c);
            await assert.rejects(chats.get(c, group.id), /No such chat/);
        });
    });

    describe('who sees and speaks', () => {
        it('keeps chats to the people in them', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            await assert.rejects(chats.get(c, chat.id), /No such chat/);
            await assert.rejects(chats.messages(c, chat.id), /No such chat/);
            await assert.rejects(say(c, chat.id, 'c'), /No such chat/);
            await assert.rejects(say(a, chat.id, 'b'), /can't speak as that/);
            assert.deepEqual((await chats.list(c)).length, 0);
            // Admins don't read players' own chats
            await assert.rejects(chats.get(admin, chat.id), /No such chat/);
        });

        it('lets admins speak as NPC fixers, and sees those chats as the GMs', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.npc], name: null });
            const asAdmin = await chats.get(admin, chat.id);
            assert.deepEqual(asAdmin.speakable, [ids.npc]);
            assert.equal(asAdmin.title, 'a');
            await say(admin, chat.id, 'npc', 'what do you need?');
            const row = await chats.find(chat.id);
            assert.deepEqual(row!.staff.map((s) => s.userId), ['admin']);
            await assert.rejects(say(b, chat.id, 'npc'), /No such chat/);
        });

        it("leaves the owner in player view out of the GMs' chats", async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.npc], name: null });
            events = [];
            await say(a, chat.id, 'a');
            assert.deepEqual(events.map((e) => e.to), [['a', 'admin']]);
            await assert.rejects(chats.get(ownerAsPlayer, chat.id), /No such chat/);
        });

        it('makes chats with a retired character read-only', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            await prisma.runner.update({ where: { id: ids.b }, data: { status: 'retired' } });
            const seen = await chats.get(b, chat.id);
            assert.equal(seen.readOnly, true);
            assert.deepEqual(seen.speakable, []);
            await assert.rejects(say(a, chat.id, 'a'), /read-only/);
        });
    });

    describe('messages', () => {
        it('sends to everyone in the chat, counts unread and marks read', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            events = [];
            const sent = await say(a, chat.id, 'a');
            assert.deepEqual(events.map((e) => [e.to, e.payload.message?.id]), [[['a', 'b'], sent.id]]);
            await settle();
            assert.ok(relayed.includes(`posted:${sent.id}`));
            assert.equal((await chats.get(b, chat.id)).unread, 1);
            assert.equal((await chats.get(a, chat.id)).unread, 0);
            assert.equal((await chats.get(b, chat.id)).last?.body, 'hey choom');
            await chats.read(b, chat.id);
            assert.equal((await chats.get(b, chat.id)).unread, 0);
        });

        it('pages back through history', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b], name: null });
            for (let i = 0; i < 55; i++) await say(a, chat.id, 'a', `line ${i}`);
            const latest = await chats.messages(a, chat.id);
            assert.equal(latest.messages.length, 50);
            assert.equal(latest.messages.at(-1)?.body, 'line 54');
            const older = await chats.messages(a, chat.id, latest.before!);
            assert.deepEqual(older.messages.map((m) => m.body), ['line 0', 'line 1', 'line 2', 'line 3', 'line 4']);
            assert.equal(older.before, null);
        });

        it('lets only the writer edit, and the writer or an admin delete', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.npc], name: null });
            const sent = await say(a, chat.id, 'a');
            await assert.rejects(chats.edit(admin, chat.id, sent.id, 'changed'), /Only your own/);
            assert.equal((await chats.edit(a, chat.id, sent.id, 'changed')).body, 'changed');
            const deleted = await chats.remove(admin, chat.id, sent.id);
            assert.equal(deleted.deleted, true);
            assert.equal(deleted.body, '');
            await assert.rejects(chats.edit(a, chat.id, sent.id, 'again'), /deleted/);
        });

        it('pushes to those who turned it on, but not the sender or someone looking at it', async () => {
            const chat = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids.b, ids.c], name: null });
            for (const p of [a, b, c]) await chats.setNotify(p, chat.id, true);
            viewing = { userId: 'c', chatId: chat.id };
            await say(a, chat.id, 'a');
            await settle();
            assert.deepEqual(pushed.map((p) => p.to), [['b']]);
            assert.equal(pushed[0].payload.url, `/messages/${chat.id}`);
            assert.deepEqual((await chats.notifying(b)).map((n) => n.id), [chat.id]);
        });
    });

    describe('crew chats', () => {
        it('follows the roster and keeps its archive when the crew goes', async () => {
            const crew = await crews.create(a, { name: 'Moxes', tagline: '', runnerId: ids.a });
            const chat = await prisma.chat.findUniqueOrThrow({ where: { crewId: crew.id }, include: { members: true } });
            assert.equal(chat.kind, 'crew');
            assert.deepEqual(chat.members.map((m) => m.runnerId), [ids.a]);
            await crews.addMember(admin, crew.id, ids.b);
            const summary = await chats.get(b, chat.id);
            assert.equal(summary.title, 'Moxes');
            assert.deepEqual(summary.speakable, [ids.b]);
            await assert.rejects(chats.addMember(a, chat.id, ids.c), /Only group chats/);
            await assert.rejects(chats.leave(b, chat.id, ids.b), /Nobody can leave/);

            await crews.removeMember(admin, crew.id, ids.b);
            await assert.rejects(chats.get(b, chat.id), /No such chat/);

            await crews.addMember(admin, crew.id, ids.b);
            await say(a, chat.id, 'a');
            await crews.delete(admin, crew.id);
            const archived = await chats.get(a, chat.id);
            assert.equal(archived.archived, true);
            assert.equal(archived.readOnly, true);
            assert.equal(archived.title, 'Moxes');
        });
    });

    describe('gig chats', () => {
        it('has the runners on the gig and its fixer, and archives when the gig is done', async () => {
            const gig = await gigs.create(admin, gigInput({ fixerRunnerId: ids.npc }));
            await settle();
            await gigs.join('a', gig.id, ids.a);
            await gigs.join('b', gig.id, ids.b);
            await settle();
            const chat = await prisma.chat.findUniqueOrThrow({ where: { gigId: gig.id } });
            const seen = await chats.get(a, chat.id);
            assert.equal(seen.kind, 'gig');
            assert.deepEqual(seen.members.map((m) => m.handle).sort(), ['a', 'b', 'npc']);
            // The GMs speak for the fixer
            assert.deepEqual((await chats.get(admin, chat.id)).speakable, [ids.npc]);
            assert.equal(canSee(c, (await chats.find(chat.id))!), false);

            await gigs.leave('b', gig.id);
            await settle();
            await assert.rejects(chats.get(b, chat.id), /No such chat/);

            await debrief.complete(admin, gig.id, { summary: null, eb: null, ip: null, text: null, runners: [], crews: [] });
            await settle();
            const done = await chats.get(a, chat.id);
            assert.equal(done.archived, true);
            assert.equal(done.readOnly, true);
            await assert.rejects(say(a, chat.id, 'a'), /read-only/);
            // Archived chats only show when asked for
            assert.deepEqual((await chats.list(a)).map((x) => x.id), []);
            assert.deepEqual((await chats.list(a, { archived: true })).map((x) => x.id), [chat.id]);
        });

        it("lets admins speak for a player's fixer in the gig's chat only", async () => {
            await addRunner('c', 'Mr Hands', 'Fixer');
            const gig = await gigs.create(admin, gigInput({ fixerRunnerId: ids['Mr Hands'] }));
            await gigs.join('a', gig.id, ids.a);
            await settle();
            const chat = (await chats.find((await prisma.chat.findUniqueOrThrow({ where: { gigId: gig.id } })).id))!;
            assert.deepEqual(speakable(admin, chat).map((r) => r.handle), ['Mr Hands']);
            assert.deepEqual(speakable(c, chat).map((r) => r.handle), ['Mr Hands']);

            const direct = await chats.create(a, { asRunnerId: ids.a, recipientIds: [ids['Mr Hands']], name: null });
            await assert.rejects(chats.get(admin, direct.id), /No such chat/);
        });
    });
});
