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
| Fixer | Submits gigs. They wait for an admin before they get posted. |
| Edgerunner | Takes gigs from Discord, creates and runs crews. |

People with none of these roles can't log in.

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
| `/board` | Link to the web board |

Gig posts have **Take the job** and **Pull out** buttons.

## Gig posts

- The forum is switched to gallery view and posts auto-archive after a week, the longest Discord allows. Live gigs (open or closed to sign-ups) get reopened if Discord or anyone archives or locks them. The bot also checks every 6 hours and on startup.
- Completing or cancelling a gig locks and archives its post. The gig's fixer can do that, as well as admins.
- Each post gets tags for its status, its fixer ("Fixer: Name", added while the forum has room under Discord's 20-tag limit) and its type if a tag matches.
- Objectives support the markdown Discord embeds render: bold, italic, strikethrough, code, links, lists and quotes.

## Pictures

Every gig has a picture, framed in the board's colours. A fixer can upload one, or it's picked from the library: the location's region first, then its district, then the general pool.

Admins manage the library on the **Library** page. Night City's 2077 districts are seeded on first start. The general pool starts with the photos in `assets/pool` (see its `CREDITS.md`).

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
