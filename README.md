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
| Edgerunner | Signs their runners up for gigs, creates and runs crews. |

People with none of these roles can't log in. Admins are people with the admin role, anyone with Manage Server, and the app's owner. Only the owner can change the server.

## Runners and fixers

- Players make **runners** (characters): a handle, a main role, extra roles and a square picture. The roles come from a list in Settings, starting with RED's core ten. Admins can make runners for any player (or hand one over) from the runner form on the web.
- Gigs, crews and Discord posts show runners, not Discord names. A player puts one runner on a gig. If they have several, the post's button asks which (a private menu), and so does the web.
- A runner with the Fixer role is a **fixer** once their player has the Discord fixer role. Fixers show on the Fixers tab with an office, specialties, how to reach them, a bio, their gigs and their rating. Admins can add NPC fixers that have no player.
- A fixer's gigs come from one of their fixer characters. Admins can pick any fixer or type a name for a one-off.

## Crews

A crew is a group of runners, run by the player who made it. A gig can hold slots for a crew, and only its runners can take them until an admin opens them to anyone. Deleting a crew opens its slots.

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

Admins complete a gig with a debrief: a summary, rewards for the whole crew (eb, IP, HQ IP, other) and extras for single runners. Each runner's player gets a DM with their payout and, if the fixer is a character, a menu to rate them from one to five stars. They can also rate (and change it) on the gig page. A fixer's own player can't rate them. The average shows on the fixer's profile. Finished gigs can't be edited.

## Discord setup

1. Create an app at https://discord.com/developers/applications.
2. **Bot**: copy the token. Turn on **Server Members Intent**.
3. **OAuth2**: copy the client secret. Add redirects:
   - `http://localhost:3003/auth/callback`
   - `https://deadline.doxbox.org/auth/callback`
4. Start Deadline and sign in as the app's owner. Until a server is set up, only the owner (or the owning team) can sign in.
5. On **Settings**, use the invite link to add the bot to a server, then pick the server, the gig forum and the admin, fixer and edgerunner roles.

The bot needs these in the forum: View Channel, Create Posts, Send Messages in Posts, Read Message History, Manage Posts and Embed Links. It also needs Manage Channels to add its tags (Open, Full, Closed, Completed, Cancelled), switch the forum to gallery view and set the archive time. The invite link asks for all of these. Players get DMs, so they need DMs from server members turned on.

Any other forum tags work as gig types. If a gig's type matches a tag, the post gets that tag.

**Bot profile:** Settings has a card for the bot's Discord banner (a library picture with the board's frame) and About me. Its status shows how many gigs are open.

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

Server, forum and roles live in the database and are set on the Settings page.

## Commands

| Command | What |
| --- | --- |
| `/board` | Link to the web board (private) |
| `/gig gig` | A live gig, compact, with links to its post and the board. Suggests gigs as you type |
| `/runner [handle]` | A runner's card. Leave out the handle to see your own |
| `/fixer handle` | A fixer's profile and rating |
| `/newrunner handle role` | Makes a runner. Add a picture and extra roles on the web (private) |
| `/mygigs` | Live gigs your runners are on, and what you still need to confirm (private) |
| `/reminders set` | Session reminder DMs on or off (private) |

## Gig posts

- Buttons: **I'm interested** (**Take the job** once a time is set), **Confirm**, **Pull out**, and a link to the board.
- The forum is switched to gallery view and posts auto-archive after a week, the longest Discord allows. Live gigs (open or with sign-ups locked) get reopened if Discord or anyone archives or locks them. The bot also checks every 6 hours and on startup.
- Completing or cancelling a gig locks and archives its post.
- Each post gets tags for its status, its fixer ("Fixer: Name", added while the forum has room under Discord's 20-tag limit) and its type if a tag matches.
- Objectives support the markdown Discord embeds render: bold, italic, strikethrough, code, links, lists and quotes.

## Pictures

Every gig has a picture, framed in the board's colours. Pictures are stored as WebP. A fixer can upload one, or it's picked from the library: the location's region first, then its district, then the general pool.

Admins manage the library under **Settings > Library**. Night City's 2077 districts are seeded on first start. The general pool starts with the photos in `assets/pool` (see its `CREDITS.md`).

For bulk imports, drop images in `import/<Region name>/` (or `import/pool/`) next to the database (by default `data/import/`) and restart. They get added to the library and the files are deleted.

## Emoji

`assets/emoji/*.svg` get uploaded as the bot's application emojis on startup if they're missing. To change one, edit the SVG, delete the emoji in the developer portal and restart. Types get an emoji when one is named `type_<type>`, e.g. `type_heist`.

## Scripts

| Script | What |
| --- | --- |
| `npm run start:dev` | Server and web UI with reload |
| `npm run build` | Builds to `dist/` |
| `npm run start:prod` | Runs the build. Set `NODE_ENV=production` |
| `npm test` | Unit tests |
| `npm run typecheck` | Server and client |
| `npm run db:generate` | New migration after changing `src/db/schema.ts`. Migrations run on startup. |
