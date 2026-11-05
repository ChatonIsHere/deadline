# Deadline

Gig board for a Cyberpunk RED campaign. Fixers and admins post gigs on the web, each approved gig gets its own Discord forum post, and edgerunners sign up from there.

## Stack

- NestJS 11 + Necord 6 (discord.js 14) on Node 24
- SQLite through Drizzle (`better-sqlite3`), file at `DATABASE_PATH`
- Web UI: React 19, Vite, Tailwind 4, shadcn-style components, served by the same Nest app

## Roles

| Role | Can |
| --- | --- |
| Admin | Everything. Approves gigs, changes status, edits any gig or crew. |
| Fixer | Submits gigs from one of their fixer characters, and edits them until an admin approves. After that the gig is a session and admins (the GMs) run it. |
| Edgerunner | Signs their runners up for gigs, creates and runs crews. |

People with none of these roles can't log in.

## Runners and fixers

- Players make **runners** (characters): a handle, a main role, extra roles and a square picture. The roles come from a list in Settings, starting with RED's core ten. Admins can make runners for any player (or hand one over) from the runner form on the web.
- Gigs, crews and Discord posts show runners, not Discord names. A player puts one runner on a gig. If they have several, the post's button asks which (a private menu), and so does the web.
- A runner with the Fixer role is a **fixer** once their player has the Discord fixer role. Fixers show on the Fixers tab with an office, specialties, how to reach them, a bio, their gigs and their rating. Admins can add NPC fixers that have no player.
- A fixer's gigs come from one of their fixer characters. Admins can pick any fixer or type a name for a one-off.

## Completing a gig

Admins complete a gig with a debrief: a summary, rewards for the whole crew (eb, IP, HQ IP, other) and extras for single runners. Each runner's player gets a DM with their payout and a menu to rate the fixer from one to five stars. They can also rate (and change it) on the gig page. The average shows on the fixer's profile.

## Discord setup

1. Create an app at https://discord.com/developers/applications.
2. **Bot**: copy the token. Turn on **Server Members Intent**.
3. **OAuth2**: copy the client secret. Add redirects:
   - `http://localhost:3003/auth/callback`
   - `https://deadline.doxbox.org/auth/callback`
4. Start Deadline and sign in as the app's owner. Until a server is set up, only the owner (or the owning team) can sign in.
5. On **Settings**, use the invite link to add the bot to a server, then pick the server, the gig forum and the admin, fixer and edgerunner roles.

The bot needs View Channel, Send Messages, Send Messages in Threads, Create Posts, Manage Threads and Embed Links in the forum, plus Manage Channels so it can create its tags (Open, Full, Closed, Completed, Cancelled). The invite link asks for all of these.

Admins are people with the admin role, anyone with Manage Server, and the app's owner. Only the owner can change the server.

Any other forum tags work as gig types. If a gig's type matches a tag, the post gets that tag.

## Getting started

```bash
npm install
cp .env.example .env   # fill it in
npm run start:dev      # http://localhost:3003
```

## Env

| Name | What |
| --- | --- |
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

Gig posts have **Take the job** and **Pull out** buttons.

## Gig posts

- The forum is switched to gallery view and posts auto-archive after a week, the longest Discord allows. Live gigs (open or closed to sign-ups) get reopened if Discord or anyone archives or locks them. The bot also checks every 6 hours and on startup.
- Completing or cancelling a gig locks and archives its post. Only admins can do that.
- Each post gets tags for its status, its fixer ("Fixer: Name", added while the forum has room under Discord's 20-tag limit) and its type if a tag matches.
- Objectives support the markdown Discord embeds render: bold, italic, strikethrough, code, links, lists and quotes.

## Sessions

Each gig is one session.

- Before an admin sets a session time, signing up marks a runner **interested** and takes a slot. When the slots are full, people go on the **reserves**, first come first served.
- Setting the time (on the gig's web page) DMs everyone in a slot to **confirm** or drop out. If someone's DMs are closed they get pinged in the gig's thread instead. Changing the time asks everyone again.
- Once a time is set, new sign-ups are confirmed straight away.
- When a slot frees up, the oldest reserve who can take it moves up, and gets a DM to confirm if there's a time.
- Admins can add edgerunners from the gig page. It works like them signing up, except they're asked to confirm a set time.
- Runners can drop out after sign-ups lock. Only completing or cancelling the gig stops that.
- Runners asked to confirm have 48 hours (Settings), ending an hour before the session if that's sooner, and at least an hour. They get one nudge with 12 hours left. If they still haven't answered they're dropped, told by DM, and the next reserve is asked.
- Confirmed runners get a reminder DM 8 hours before (Settings) and 30 minutes before. They can turn reminders off from the DM or on the **Me** page. The thread gets a note too, without pings.
- Admins can open a crew's reserved slots to anyone from the gig page. Reserves who now fit move up.

## Pictures

Every gig has a picture, framed in the board's colours. Pictures are stored as WebP. A fixer can upload one, or it's picked from the library: the location's region first, then its district, then the general pool.

Admins manage the library under **Settings > Library**. Night City's 2077 districts are seeded on first start. The general pool starts with the photos in `assets/pool` (see its `CREDITS.md`).

For bulk imports, drop images in `data/import/<Region name>/` (or `data/import/pool/`) and restart. They get added to the library and the files are deleted.

## Emoji

`assets/emoji/*.svg` get uploaded as the bot's application emojis on startup if they're missing. To change one, edit the SVG, delete the emoji in the developer portal and restart. Types get an emoji when one is named `type_<type>`, e.g. `type_heist`.

## Scripts

| Script | What |
| --- | --- |
| `npm run start:dev` | Server and web UI with reload |
| `npm run build` | Builds to `dist/` |
| `npm test` | Unit tests |
| `npm run typecheck` | Server and client |
| `npm run db:generate` | New migration after changing `src/db/schema.ts`. Migrations run on startup. |
