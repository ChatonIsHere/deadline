// Demo data for trying the whole site out. Run inside the app's container, piped in:
//
//   ssh <server> "docker exec -i -e TEST_DATA=check -e TEST_DATA_OWNER=<discord id> deadline node -" < scripts/test-data.js
//
// TEST_DATA: check (the default, writes nothing), seed, or remove. TEST_DATA_OWNER is the admin
// who plays the three player fixers: they need the Discord fixer role to count as fixers.
//
// Every record's ID starts d0d0 (gigs), d0d1 (runners) or d0d2 (crews), which is how remove finds
// them. Other runners get made-up player IDs, so no real person is tied to one or gets DMed.
// Goes straight to the database, so seeding sends no notifications. Restart the app to post the
// live gigs to the forum straight away; otherwise the six-hourly refresh does it.

const { PrismaClient } = require('@prisma/client');
const { completeInput, gigInput, runnerInput } = require('./dist/shared/schemas.js');
const { toSlug } = require('./dist/shared/slug.js');

const prisma = new PrismaClient();
const MODE = process.env.TEST_DATA ?? 'check';
const ME = process.env.TEST_DATA_OWNER;
const DAY = 86_400_000;

const uid = (prefix, n) => `${prefix}${String(n).padStart(4, '0')}-0000-4000-8000-000000000000`;
const fakePlayer = (n) => `90000000000000${String(n).padStart(4, '0')}`;

// Runners: three player fixers, three NPC fixers, and thirteen on made-up players
const RUNNERS = [
    { key: 'cass', handle: 'Cass Okoye', role: 'Fixer', extra: ['Exec'], owner: ME, alias: 'The Notary', office: 'Back room of the Paper Lantern', specialties: 'Contracts, corporate leaks, quiet exits', contact: 'Leave a card with the bartender', bio: 'Used to draft contracts for a living. Now she just makes sure they get **honoured**.' },
    { key: 'dmitri', handle: 'Dmitri Vale', role: 'Fixer', extra: ['Nomad'], owner: ME, office: 'A truck, somewhere on the 101', specialties: 'Smuggling, convoys, border runs', contact: 'Channel 19 after dark', bio: 'No alias, no office, no patience for people who are late.' },
    { key: 'pixel', handle: 'Pixel Moreau', role: 'Fixer', extra: ['Media'], owner: ME, alias: 'Madame Static', office: 'Studio 4, Pirate Radio Row', specialties: 'Data heists, blackmail, broadcasts', contact: 'Request a song on 88.3', bio: 'If it was recorded, she has a copy.' },
    { key: 'ember', handle: 'Mother Ember', role: 'Fixer', owner: null, office: 'The Ash Kitchen, Pacifica', specialties: 'Protection work, missing persons', contact: 'Ask for soup', bio: 'Feeds half the block and owns the other half.' },
    { key: 'tin', handle: 'Tin Saint', role: 'Fixer', owner: null, office: 'Chapel of the Open Port', specialties: 'Netrunning, cyberware, salvage', contact: 'Light a candle at the terminal', bio: 'Nobody has seen who is inside the suit.' },
    { key: 'lucky', handle: 'Lucky Okafor', role: 'Fixer', owner: null, office: 'Table nine, the Silver Dollar', specialties: 'Muscle, debts, card games', contact: 'Bring cash', bio: 'Has never lost a bet he told you about.' },
    { key: 'brick', handle: 'Brick Tanaka', role: 'Solo', extra: [], owner: fakePlayer(1) },
    { key: 'hexa', handle: 'Hexa', role: 'Netrunner', extra: [], owner: fakePlayer(2) },
    { key: 'wrench', handle: 'Wrench Adeyemi', role: 'Tech', extra: [], owner: fakePlayer(3) },
    { key: 'sorrel', handle: 'Doc Sorrel', role: 'Medtech', extra: [], owner: fakePlayer(4) },
    { key: 'riot', handle: 'Riot Lacroix', role: 'Rockerboy', extra: ['Solo'], owner: fakePlayer(5) },
    { key: 'scoop', handle: 'Scoop Ibarra', role: 'Media', extra: [], owner: fakePlayer(6) },
    { key: 'margaux', handle: 'Margaux Thorne', role: 'Exec', extra: ['Media'], owner: fakePlayer(7) },
    { key: 'reyes', handle: 'Marshal Reyes', role: 'Lawman', extra: [], owner: fakePlayer(8) },
    { key: 'dusty', handle: 'Dusty Ortega', role: 'Nomad', extra: ['Tech'], owner: fakePlayer(9) },
    { key: 'kestrel', handle: 'Kestrel', role: 'Solo', extra: ['Tech', 'Medtech'], owner: fakePlayer(10) },
    { key: 'glitch', handle: 'Glitch Nakamura', role: 'Netrunner', extra: ['Media'], owner: fakePlayer(11) },
    { key: 'harlan', handle: 'Old Harlan', role: 'Solo', extra: [], owner: fakePlayer(12), status: 'retired', goneDays: 12 },
    { key: 'sable', handle: 'Sable Quinn', role: 'Netrunner', extra: [], owner: fakePlayer(13), status: 'dead', goneDays: 4, obituary: 'Jacked in one last time to hold the door open for her crew. **The door held.**\n\n- Owed Lucky 500eb\n- Never paid it' },
].map((r, i) => ({ ...r, id: uid('d0d1', i + 1), extra: r.extra ?? [], slug: toSlug(r.handle), fixerSlug: r.alias ? toSlug(r.alias) : null }));
const runner = (key) => RUNNERS.find((r) => r.key === key) ?? fail(`No runner ${key}`);

const CREWS = [
    { key: 'jackals', name: 'Neon Jackals', tagline: 'Loud, fast and mostly sorry.', ranks: ['Founder', 'Enforcer', 'Member'], members: { brick: 'Founder', kestrel: 'Enforcer', hexa: 'Member', riot: 'Member', sable: 'Member' }, allies: ['tin'] },
    { key: 'saints', name: 'Paper Saints', tagline: 'Everything is in the fine print.', ranks: ['Founder', 'Member'], members: { margaux: 'Founder', scoop: 'Member', sorrel: 'Member' }, allies: ['reyes'] },
    { key: 'riders', name: 'Rust Belt Riders', tagline: '', ranks: ['Boss', 'Road Captain', 'Prospect'], members: { dusty: 'Boss', wrench: 'Road Captain', glitch: 'Prospect', harlan: 'Prospect' }, allies: [] },
].map((c, i) => ({ ...c, id: uid('d0d2', i + 1), slug: toSlug(c.name) }));
const crew = (key) => CREWS.find((c) => c.key === key) ?? fail(`No crew ${key}`);

const open = (n) => Array.from({ length: n }, () => ({}));
const take = (...keys) => keys.map((r) => ({ runner: r }));
const forCrew = (key, ...slots) => slots.map((s) => ({ ...s, crew: key }));

const GIGS = [
    // Live: one of each objective combination
    { name: 'Courier Run', fixer: 'ember', location: 'Kabuki', pay: 800, brief: 'Take a sealed case across town. Do **not** open it.', primary: ['Deliver the case to the drop'], slots: [...take('brick', 'scoop'), ...open(2)] },
    { name: 'Two Birds', fixer: 'tin', location: 'Little China', pay: 2500, brief: 'Three things need doing on the same night.', primary: ['Cut the building power', 'Copy the server core', 'Get out before the shift change'], objectives: [{ text: 'Leave no alarms on record', bonus: 500 }], slots: [...take('hexa'), ...open(3)] },
    { name: 'Bounty Board', fixer: 'cass', location: 'Watson', pay: 1200, brief: 'A gang has been taxing the wrong street. Thin them out.', primary: ['Drive the gang off Kennedy Street'], objectives: [{ text: 'For each lieutenant brought in alive', bonus: 300, each: true }], slots: open(4) },
    { name: 'Dead Drop', fixer: 'dmitri', location: 'Badlands', pay: 3000, brief: 'Every kind of bonus on one job. Read the small print.', primary: ['Recover the shipment'], objectives: [{ text: 'Bring back the driver', bonus: 750 }, { text: 'For each crate undamaged', bonus: 100, each: true }, { text: 'The real reason this shipment matters', bonus: 2000, hidden: true }, { text: 'Tell nobody who hired you' }], slots: [...take('dusty', 'wrench'), ...open(2)] },
    { name: 'Turf Talks', fixer: 'pixel', location: 'Japantown', pay: 4000, brief: 'Slots held for two crews, and one for anyone.', primary: ['Keep the meeting from turning into a war'], objectives: [{ text: 'Record the whole thing', bonus: 1000 }], slots: [...forCrew('jackals', ...take('brick', 'kestrel')), ...forCrew('saints', ...take('margaux'), ...open(1)), ...open(1)] },
    { name: 'Standing Room Only', typedFixer: 'A voice on the phone', location: 'City Center', pay: 1500, brief: 'A full crew with people waiting. Pull someone out to watch a reserve move up.', primary: ['Crash the gala'], slots: take('riot', 'sorrel', 'glitch'), reserves: ['reyes', 'kestrel'] },
    { name: 'Lockdown', fixer: 'lucky', location: 'Pacifica', pay: 5000, status: 'closed', sessionDays: 9, brief: 'Sign-ups locked and a session booked, so the hidden objective shows.', primary: ['Clear the arcade', 'Hold it until morning'], objectives: [{ text: 'Find out who sold the keys', bonus: 1500, hidden: true }], slots: take('brick', 'hexa', 'sorrel') },

    // Waiting on an admin
    { name: 'Favour For A Friend', fixer: 'pixel', location: 'Westbrook', pay: 900, status: 'pending', brief: 'Waiting on sign-off. Approve it to see it go live.', primary: ['Lose the paperwork'], slots: open(2) },
    { name: 'Absolutely Not', fixer: 'cass', location: 'Heywood', pay: 200, status: 'rejected', brief: 'An admin already said no.', primary: ['Rob the clinic'], slots: open(2) },

    // Finished
    {
        name: 'Silver Dollar Shakedown', fixer: 'lucky', location: 'Santo Domingo', pay: 2000, status: 'completed', daysAgo: 21, brief: 'Collect what the casino owes.', primary: ['Collect the debt'], objectives: [{ text: 'Keep it quiet', bonus: 500 }, { text: 'For each ledger recovered', bonus: 200, each: true }],
        slots: take('brick', 'sable', 'scoop', 'kestrel'),
        done: { summary: 'Went **loud** in the end, but the money came back.\n\n- Two ledgers recovered\n- One casino slightly on fire', eb: 2400, ip: 6, hqIp: 2, text: 'A favour from the pit boss', extras: [{ runner: 'sable', eb: 300, ip: 2, hqIp: 1, text: 'Kept the casino master key' }, { runner: 'scoop', ip: 1, text: 'Exclusive footage' }], ratings: [{ runner: 'brick', stars: 5, comment: 'Paid on the night.' }, { runner: 'sable', stars: 4, comment: null }, { runner: 'scoop', stars: 3, comment: 'Left out the part about the fire.' }] },
    },
    {
        name: 'Quiet Word', fixer: 'cass', location: 'Corpo Plaza', pay: 1500, status: 'completed', daysAgo: 14, brief: 'Persuade a witness to reconsider.', primary: ['Change the testimony'],
        slots: forCrew('saints', ...take('margaux', 'sorrel')),
        done: { summary: 'Nobody raised their voice.', eb: 1500, ip: 3, extras: [], ratings: [{ runner: 'margaux', stars: 5, comment: 'Professional.' }, { runner: 'sorrel', stars: 5, comment: null }] },
    },
    {
        name: 'Soup Run', fixer: 'ember', location: 'Pacifica', pay: 600, status: 'completed', daysAgo: 7, brief: 'Get the supplies through.', primary: ['Deliver the supplies'],
        slots: take('dusty', 'wrench'),
        done: { summary: null, eb: 600, text: 'Free soup for life', extras: [{ runner: 'wrench', eb: 100 }], ratings: [{ runner: 'dusty', stars: 4, comment: null }] },
    },
    { name: 'Called Off', fixer: 'tin', location: 'Northside', pay: 1000, status: 'cancelled', daysAgo: 3, brief: 'The client went quiet.', primary: ['Crack the vault'], slots: take('hexa') },
].map((g, i) => ({ ...g, id: uid('d0d0', i + 1), status: g.status ?? 'open', objectives: g.objectives ?? [], reserves: g.reserves ?? [], daysAgo: g.daysAgo ?? 0 }));

function fail(message) {
    throw new Error(message);
}

/** Runs everything past the rules the web forms use. */
function validate() {
    for (const r of RUNNERS) {
        runnerInput.parse({ handle: r.handle, role: r.role, extraRoles: r.extra, imageId: null, fixerAlias: r.alias ?? null, officeLocation: r.office ?? null, specialties: r.specialties ?? null, contact: r.contact ?? null, bio: r.bio ?? null });
    }
    for (const g of GIGS) {
        const counts = new Map();
        for (const s of g.slots) counts.set(s.crew ?? null, (counts.get(s.crew ?? null) ?? 0) + 1);
        gigInput.parse({
            name: g.name,
            fixerName: g.typedFixer ?? '',
            fixerRunnerId: g.fixer ? runner(g.fixer).id : null,
            location: g.location,
            type: null,
            brief: g.brief,
            primaryObjective: g.primary,
            pay: g.pay,
            imageId: null,
            objectives: g.objectives.map((o) => ({ text: o.text, bonus: o.bonus ?? null, each: !!o.each, hidden: !!o.hidden })),
            slots: [...counts].map(([key, count]) => ({ crewId: key ? crew(key).id : null, count })),
        });
        if (g.done) {
            for (const x of g.done.extras) if (!g.slots.some((s) => s.runner === x.runner)) fail(`${g.name}: ${x.runner} isn't on it`);
            for (const x of g.done.ratings) if (!g.slots.some((s) => s.runner === x.runner)) fail(`${g.name}: ${x.runner} isn't on it`);
            completeInput.parse({ summary: g.done.summary, eb: g.done.eb ?? null, ip: g.done.ip ?? null, hqIp: g.done.hqIp ?? null, text: g.done.text ?? null, runners: g.done.extras.map((x) => ({ runnerId: runner(x.runner).id, eb: x.eb ?? null, ip: x.ip ?? null, hqIp: x.hqIp ?? null, text: x.text ?? null })) });
        }
        for (const s of [...g.slots.filter((x) => x.crew && x.runner)]) {
            if (!(s.runner in crew(s.crew).members)) fail(`${g.name}: ${s.runner} isn't in ${s.crew}`);
        }
        const everyone = [...g.slots.flatMap((s) => (s.runner ? [s.runner] : [])), ...g.reserves];
        if (new Set(everyone).size !== everyone.length) fail(`${g.name}: someone is on it twice`);
    }
}

/** Handles, aliases or crew names the real data already uses. */
async function clashes() {
    const links = RUNNERS.flatMap((r) => [r.slug, ...(r.fixerSlug ? [r.fixerSlug] : [])]);
    const runners = await prisma.runner.findMany({ where: { NOT: { id: { in: RUNNERS.map((r) => r.id) } }, OR: [{ slug: { in: links } }, { fixerSlug: { in: links } }] }, select: { handle: true } });
    const crews = await prisma.crew.findMany({ where: { NOT: { id: { in: CREWS.map((c) => c.id) } }, OR: [{ slug: { in: CREWS.map((c) => c.slug) } }, { name: { in: CREWS.map((c) => c.name) } }] }, select: { name: true } });
    return [...runners.map((r) => r.handle), ...crews.map((c) => c.name)];
}

/** The picture the app would pick for a location, varied by `n`: its region, its district, then the general pool. */
async function picture(location, n) {
    const region = await prisma.region.findFirst({ where: { name: location } });
    const district = region?.district ? await prisma.region.findFirst({ where: { name: region.district } }) : null;
    for (const regionId of [region?.id, district?.id, null]) {
        if (regionId === undefined) continue;
        const ids = await prisma.image.findMany({ where: { inLibrary: true, regionId }, select: { id: true }, orderBy: { id: 'asc' } });
        if (ids.length) return ids[n % ids.length].id;
    }
    return null;
}

async function seed() {
    const pictures = new Map();
    for (const [i, g] of GIGS.entries()) pictures.set(g.id, await picture(g.location, i));
    const now = Date.now();

    await prisma.$transaction(
        async (tx) => {
            await tx.runner.createMany({
                data: RUNNERS.map((r) => ({
                    id: r.id, ownerId: r.owner, handle: r.handle, slug: r.slug, role: r.role, extraRoles: r.extra, fixerAlias: r.alias ?? null, fixerSlug: r.fixerSlug,
                    officeLocation: r.office ?? null, specialties: r.specialties ?? null, contact: r.contact ?? null, bio: r.bio ?? null,
                    status: r.status ?? 'active', retiredAt: r.goneDays ? new Date(now - r.goneDays * DAY) : null, obituary: r.obituary ?? null,
                })),
            });
            await tx.crew.createMany({ data: CREWS.map((c) => ({ id: c.id, name: c.name, slug: c.slug, tagline: c.tagline, ownerId: runner(Object.keys(c.members)[0]).owner, ranks: c.ranks })) });
            await tx.crewMember.createMany({ data: CREWS.flatMap((c) => Object.entries(c.members).map(([r, rank]) => ({ crewId: c.id, runnerId: runner(r).id, rank }))) });
            await tx.crewAlly.createMany({ data: CREWS.flatMap((c) => c.allies.map((r) => ({ crewId: c.id, runnerId: runner(r).id }))) });

            for (const [i, g] of GIGS.entries()) {
                const fixer = g.fixer ? runner(g.fixer) : null;
                const sessionAt = g.sessionDays ? new Date(now + g.sessionDays * DAY) : g.done ? new Date(now - g.daysAgo * DAY) : null;
                await tx.gig.create({
                    data: {
                        id: g.id, name: g.name, fixerName: g.typedFixer ?? fixer.alias ?? fixer.handle, fixerRunnerId: fixer?.id ?? null, fixerId: fixer?.owner ?? null,
                        location: g.location, brief: g.brief, primaryObjective: g.primary, pay: g.pay, imageId: pictures.get(g.id), status: g.status, createdBy: ME, sessionAt,
                        summary: g.done?.summary ?? null, rewardEb: g.done?.eb ?? null, rewardIp: g.done?.ip ?? null, rewardHqIp: g.done?.hqIp ?? null, rewardText: g.done?.text ?? null,
                        // Newest first on the board, in the order they're listed here
                        createdAt: new Date(now - g.daysAgo * DAY - i * 60_000),
                    },
                });
                await tx.gigObjective.createMany({ data: g.objectives.map((o, position) => ({ gigId: g.id, text: o.text, bonus: o.bonus ?? null, each: !!o.each, hidden: !!o.hidden, position })) });
                await tx.gigSlot.createMany({
                    data: g.slots.map((s, position) => ({
                        gigId: g.id, position, crewId: s.crew ? crew(s.crew).id : null, userId: s.runner ? runner(s.runner).owner : null, runnerId: s.runner ? runner(s.runner).id : null,
                        state: s.runner && sessionAt ? 'confirmed' : 'interested',
                    })),
                });
                await tx.gigReserve.createMany({ data: g.reserves.map((r, n) => ({ gigId: g.id, userId: runner(r).owner, runnerId: runner(r).id, joinedAt: new Date(now - (g.reserves.length - n) * 60_000) })) });
                if (g.done) {
                    await tx.gigReward.createMany({ data: g.done.extras.map((x) => ({ gigId: g.id, runnerId: runner(x.runner).id, eb: x.eb ?? null, ip: x.ip ?? null, hqIp: x.hqIp ?? null, text: x.text ?? null })) });
                    await tx.fixerRating.createMany({ data: g.done.ratings.map((x) => ({ gigId: g.id, userId: runner(x.runner).owner, stars: x.stars, comment: x.comment, ratedAt: new Date(now - g.daysAgo * DAY + 3_600_000) })) });
                }
            }
        },
        { timeout: 60_000 },
    );
}

/** Calls Discord as the bot. A thread that's already gone is fine. */
async function discord(method, path, body) {
    const res = await fetch(`https://discord.com/api/v10${path}`, { method, headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok && res.status !== 404) console.log(`Discord said ${res.status} to ${method} ${path}`);
    return res.ok && res.status !== 204 ? res.json() : null;
}

/** Everything the seed made, the forum posts of its gigs, and the fixer tags they added. */
async function remove() {
    const gigs = await prisma.$queryRaw`SELECT id::text AS id, thread_id AS "threadId" FROM gigs WHERE id::text LIKE 'd0d0%'`;
    const runners = (await prisma.$queryRaw`SELECT id::text AS id FROM runners WHERE id::text LIKE 'd0d1%'`).map((r) => r.id);
    const crews = (await prisma.$queryRaw`SELECT id::text AS id FROM crews WHERE id::text LIKE 'd0d2%'`).map((c) => c.id);

    for (const { threadId } of gigs) {
        if (!threadId) continue;
        await discord('DELETE', `/channels/${threadId}`);
        await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const forumId = (await prisma.settings.findUnique({ where: { id: 1 } }))?.forumId;
    if (forumId) {
        // Same as fixerTag in gig-post.service.ts
        const testTags = new Set([...RUNNERS.map((r) => r.alias ?? r.handle), ...GIGS.flatMap((g) => g.typedFixer ?? [])].map((name) => `Fixer: ${name}`.slice(0, 20).trim()));
        const forum = await discord('GET', `/channels/${forumId}`);
        const kept = forum?.available_tags?.filter((t) => !testTags.has(t.name));
        if (kept && kept.length !== forum.available_tags.length) await discord('PATCH', `/channels/${forumId}`, { available_tags: kept });
    }

    await prisma.$transaction(async (tx) => {
        // Test runners someone put on a real gig leave its slots empty rather than half filled
        await tx.gigSlot.updateMany({ where: { runnerId: { in: runners }, gigId: { notIn: gigs.map((g) => g.id) } }, data: { userId: null, runnerId: null, state: 'interested', askedAt: null, nudged: false } });
        await tx.gig.deleteMany({ where: { id: { in: gigs.map((g) => g.id) } } });
        await tx.crew.deleteMany({ where: { id: { in: crews } } });
        await tx.runner.deleteMany({ where: { id: { in: runners } } });
    });
    console.log(`Removed ${gigs.length} gigs, ${runners.length} runners, ${crews.length} crews.`);
}

async function summary() {
    const [runners, crews, gigs] = await Promise.all([prisma.runner.count(), prisma.crew.count(), prisma.gig.count()]);
    console.log(`Now on the site: ${runners} runners, ${crews} crews, ${gigs} gigs.`);
}

(async () => {
    validate();
    console.log(`Valid: ${RUNNERS.length} runners, ${CREWS.length} crews, ${GIGS.length} gigs.`);
    if (MODE === 'remove') {
        await remove();
    } else {
        if (!/^\d+$/.test(ME ?? '')) fail('Set TEST_DATA_OWNER to the Discord ID of an admin with the fixer role.');
        const taken = await clashes();
        if (taken.length) fail(`Already in use: ${taken.join(', ')}`);
        if (MODE === 'seed') {
            await seed();
            console.log('Seeded.');
        }
    }
    await summary();
    await prisma.$disconnect();
})().catch(async (err) => {
    console.error(`FAILED: ${err.message}`);
    await prisma.$disconnect();
    process.exit(1);
});
