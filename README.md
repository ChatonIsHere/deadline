# Deadline

Gig board for a Cyberpunk RED campaign. Fixers and admins post gigs on the web, each approved gig gets its own Discord forum post, and players sign their runners up from there or the web.

## Stack

- NestJS 11 + Necord 6 (discord.js 14) on Node 24
- SQLite through Drizzle (`better-sqlite3`), file at `DATABASE_PATH`
- Web UI: React 19, Vite, Tailwind 4, shadcn-style components, served by the same Nest app

## Roles

| Role | Can |
| --- | --- |
| Admin | Everything. Approves gigs and runs them (status, session time, runners, debrief), edits any unfinished gig, crew or runner. |
| Fixer | Submits gigs from one of their fixer characters, and edits them until an admin approves. After that the gig is a session and admins (the GMs) run it. |
| Edgerunner | Signs their runners up for gigs, founds crews. |

People with none of these roles can't log in. Admins are people with the admin role, anyone with Manage Server, and the app's owner. Only the owner can change the server. The owner can turn on **player view** on the Me page to use the board and bot as a normal player with their real Discord roles. It only shows, and only turns off, on the Me page.

## Runners and fixers

- Players make **runners** (characters): a handle, a main role, extra roles and a square picture. The roles come from a list in Settings, starting with RED's core ten. Admins can make runners for any player (or hand one over) from the runner form on the web.
- Gigs, crews and Discord posts show runners, not Discord names. A player puts one runner on a gig. If they have several, the post's button asks which (a private menu), and so does the web.
- A runner with the Fixer role is a **fixer** once their player has the Discord fixer role. Fixers show on the Fixers tab with an office, specialties, how to reach them, a bio, their gigs and their rating. Admins can add NPC fixers that have no player.
- A fixer's gigs come from one of their fixer characters. Admins can pick any fixer or type a name for a one-off.

## Crews

A crew is a group of runners with ranks. A gig can hold slots for a crew, and only its runners can take them until an admin opens them to anyone. Deleting a crew opens its slots.

- **Ranks** are just names, highest first. New crews get Founder and Member; founders can add more. The top rank (Founder unless renamed) runs the crew: edits it, sets ranks, invites, removes runners and keeps the allies list. Admins can do all of that too.
- A crew always has at least one Founder. A Founder can't step down or leave on their own: another Founder or an admin has to do it. If the last Founder's runner is deleted, the highest ranked runner left takes over.
- **Invites**: Founders invite a player's runner. The player gets a DM with Join and Decline, and the invite also shows on their **Me** page. New members start at the bottom rank. Admins can also add a runner straight in.
- **Allies** are runners (or NPC fixers) the crew knows and trusts without them being members. Founders can invite an ally to join from the list.
- Renaming a rank keeps its runners. Runners in a removed rank drop to the bottom one.

## Typed IDs

Runners (and so fixers) and crews get a typed ID when they're made, used in links: `/runners/vex`, `/fixers/rogue`, `/crews/static-wolves`. It's made from the name unless one is typed in, and can't be changed later. Letters, numbers, `_` and `-` only, with at least one letter. The numeric URLs (`/crews/3`) keep working.

## Sessions

Each gig is one session.

- Before an admin sets a session time, signing up marks a runner **interested** and takes a slot. When the slots are full, runners go on the **reserves**, first come first served.
- Setting the time (on the gig's web page) DMs everyone in a slot to **confirm** or pull out. If someone's DMs are closed they get pinged in the gig's thread instead. Changing the time asks everyone again.
- Once a time is set, new sign-ups are confirmed straight away.
- When a slot frees up, the oldest reserve who can take it moves up, and gets a DM to confirm if there's a time. Not once the session has happened: removing a no-show doesn't pull a reserve in.
- Admins can add runners from the gig page, even after sign-ups lock. It works like signing up, except they're asked to confirm a set time.
- Runners can pull out after sign-ups lock. Only completing or cancelling the gig stops that.
- Runners asked to confirm have 48 hours (Settings), ending an hour before the session if that's sooner, and at least an hour. They get one nudge with 12 hours left. If they still haven't answered they're dropped, told by DM, and the next reserve is asked.
- Confirmed runners get a reminder DM 8 hours before (Settings) and 30 minutes before. They can turn reminders off from the DM, with `/reminders`, or on the **Me** page. The thread gets a note too, without pings.

## Completing a gig

Admins complete a gig with a debrief: a summary, rewards for the whole crew (eb, IP, HQ IP, other) and extras for single runners. Each runner's player gets a DM with their payout and, if the fixer is a character, a menu to rate them from one to five stars. Picking stars saves them and opens a box for an optional note (300 characters). They can also rate, and change it, on the gig page. Anyone who had a runner on the gig can rate, including the fixer's own player if they went as a runner. The fixer's profile shows the average and the latest five ratings with their notes. Finished gigs can't be edited.

## Discord setup

1. Create an app at https://discord.com/developers/applications.
2. **Bot**: copy the token. Turn on **Server Members Intent**.
3. **OAuth2**: copy the client secret. Add redirects:
   - `http://localhost:3003/auth/callback`
   - `https://deadline.doxbox.org/auth/callback`
4. Start Deadline and sign in as the app's owner. Until a server is set up, only the owner (or the owning team) can sign in.
5. On **Settings > Discord**, use the invite link to add the bot to a server, then pick the server, the gig forum and the admin, fixer and edgerunner roles.

The bot needs these in the forum: View Channel, Create Posts, Send Messages in Posts, Read Message History, Manage Posts and Embed Links. It also needs Manage Channels to add its tags (Open, Full, Closed, Completed, Cancelled), switch the forum to gallery view and set the archive time. The invite link asks for all of these. Players get DMs, so they need DMs from server members turned on.

Any other forum tags work as gig types. If a gig's type matches a tag, the post gets that tag.

**Bot profile:** **Settings > Bot** sets the bot's Discord banner (a library picture with the board's frame) and About me. Its status shows how many gigs are open.

## Getting started

```bash
npm install
cp .env.example .env   # fill it in
npm run start:dev      # http://localhost:3003
```

## Env

| Name | What |
| --- | --- |
| `NODE_ENV` | `production` serves the built client from `dist/client`, with secure cookies and a CSP. Otherwise Vite runs inside the server |
| `PORT` | HTTP port, default 3003 |
| `PUBLIC_URL` | Where the web UI lives. Used for OAuth and links in posts |
| `DATABASE_PATH` | SQLite file, default `./data/deadline.db` |
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CLIENT_SECRET` | OAuth secret. The client ID is the bot's application ID |

Server, forum and roles live in the database and are set on **Settings > Discord**.

## Commands

| Command | What |
| --- | --- |
| `/board` | Link to the web board (private) |
| `/gig gig` | A live gig, compact, with links to its post and the board. Suggests gigs as you type |
| `/runner [handle]` | A runner's card. Leave out the handle to see your own |
| `/fixer handle` | A fixer's profile, rating and latest notes |
| `/crew name` | A crew, one field per rank with its runners, then its allies |
| `/newrunner handle role` | Makes a runner. Add a picture and extra roles on the web (private) |
| `/mygigs` | Live gigs your runners are on, and what you still need to confirm (private) |
| `/reminders set` | Session reminder DMs on or off (private) |

## Gig posts

- Buttons: **I'm interested** (**Take the job** once a time is set), **Confirm**, **Pull out**, and a link to the board.
- The forum is switched to gallery view and posts auto-archive after a week, the longest Discord allows. Live gigs (open or with sign-ups locked) get reopened if Discord or anyone archives or locks them. The bot also checks every 6 hours and on startup.
- The thread only gets gig-wide news: status changes, the session time being set or cleared, crew slots opening up and the session reminders. Runners signing up, confirming or pulling out get a private reply, and the post's crew list updates.
- Completing a gig posts a debrief as the thread's last message (the summary, the rewards and who went), then locks and archives the post. Cancelling locks and archives it too.
- The line above the title links to the board. Discord doesn't allow links in footers, so the footer just shows the status.
- Each post gets tags for its status, its fixer ("Fixer: Name", added while the forum has room under Discord's 20-tag limit) and its type if a tag matches.
- The brief is the post's description (up to 4,000 characters): everything about the job. The primary objective is what the crew must do to get paid, and carries the pay. Pay shows as a range, from the primary objective alone up to that plus every secondary bonus. The post is two embeds: the job (brief, details, objectives, picture), then Sign-ups (session time, one field per crew plus Freelance for anyone, reserves) with the status underneath.
- Nothing gets cut. Long fields split into "(cont.)" fields, and whatever doesn't fit Discord's limits (6,000 characters a message) goes in follow-up messages in the thread, which are kept up to date.
- The brief and objectives support the markdown Discord embeds render: bold, italic, strikethrough, code, links, lists and quotes.

## Pictures

Every gig has a picture, framed in the board's colours. There are six frame variants (`src/library/frame.ts`), the same shape with the colours and lengths moved around; each picture always gets the same one. Outside the frame's cut edge the picture is transparent, so it sits on any Discord theme. Each picture is stored as WebP in a few versions: plain, framed with a margin for Discord, framed to the edge for the web, and a small thumb (pickers, grids, avatars) and medium copy (gig cards) of the web one. They're built on upload, and on startup for anything missing. A fixer can upload one, or it's picked from the library: the location's region first, then its district, then the general pool.

Admins manage the library under **Settings > Library**. Night City's 2077 districts are seeded on first start. The general pool starts with the photos in `assets/pool` (see its `CREDITS.md`).

For bulk imports, drop images in `import/<Region name>/` (or `import/pool/`) next to the database (by default `data/import/`) and restart. They get added to the library and the files are deleted.

Gig posts use a **gig card** made for each gig (`src/library/gig-card.ts`): its picture cut to 1070x720 (the shape Discord's forum gallery previews use, about 1.485:1), framed with a margin so desktop and mobile both show the whole frame, and the operation's name on the left, centred top to bottom so it clears the forum's tags, one word per line, each on a dark bar so it reads on bright pictures, as big as fits. Cards are PNG: Discord marks WebP pictures as GIFs in the forum gallery. It's rebuilt when the gig's name or picture changes. The font is Chakra Petch Bold (`assets/fonts`, SIL Open Font License).

## Emoji

`assets/emoji/*.svg` are the bot's application emojis, also used on the web. They're original drawings in one style, made by `scripts/draw-emoji.js`: change a shape there and run `npm run emoji`. On startup each one is uploaded as `name_hash` (the hash comes from the SVG), so a changed drawing goes up as a new emoji and old messages keep the old one.

Types get an emoji when one is named `type_<type>`, e.g. `type_heist`. Runner roles use `role_<role>`: RED's core ten have one, roles added in Settings show without.

## Scripts

| Script | What |
| --- | --- |
| `npm run start:dev` | Server and web UI with reload |
| `npm run build` | Builds to `dist/` |
| `npm run start:prod` | Runs the build. Set `NODE_ENV=production` |
| `npm test` | Unit tests |
| `npm run typecheck` | Server and client |
| `npm run emoji` | Redraws `assets/emoji` from `scripts/draw-emoji.js` |
| `npm run db:generate` | New migration after changing `src/db/schema.ts`. Migrations run on startup. |
