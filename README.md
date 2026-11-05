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
3. **OAuth2**: copy the client ID and secret. Add redirects:
   - `http://localhost:3003/auth/callback`
   - `https://deadline.doxbox.org/auth/callback`
4. Invite the bot with the `bot` and `applications.commands` scopes.
5. In the gig forum, the bot needs View Channel, Send Messages, Send Messages in Threads, Create Posts, Manage Threads and Embed Links. Give it Manage Channels too, at least for the first start, so it can create its tags (Open, Full, Closed, Completed, Cancelled).

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
| `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` | OAuth app |
| `DISCORD_GUILD_ID` | The campaign server |
| `ADMIN_ROLE_ID` / `FIXER_ROLE_ID` / `EDGERUNNER_ROLE_ID` | Role IDs |
| `GIG_FORUM_ID` | Forum channel gigs get posted to |

## Commands

| Command | What |
| --- | --- |
| `/board` | Link to the web board |

Gig posts have **Take the job** and **Pull out** buttons.

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
