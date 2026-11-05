import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { DB, Db } from '../db/db';
import { settings } from '../db/schema';
import { CORE_ROLES, FIXER_ROLE, type GuildOptions, type Me, type Option, type Settings } from '../shared/schemas';

const EMPTY: Settings = {
    guildId: null,
    forumId: null,
    adminRoleId: null,
    fixerRoleId: null,
    edgerunnerRoleId: null,
    reminderHours: 8,
    confirmHours: 48,
    runnerRoles: CORE_ROLES,
};

/** Which server, forum and roles Deadline uses. Kept in SQLite, changed on the web. */
@Injectable()
export class SettingsService {
    private cached: Settings | null = null;

    constructor(
        @Inject(DB) private readonly db: Db,
        @Inject(Client) private readonly client: Client,
    ) {}

    get(): Settings {
        if (!this.cached) {
            const { id: _, ...row } = this.db.query.settings.findFirst().sync() ?? { id: 1, ...EMPTY };
            this.cached = row;
        }
        return this.cached;
    }

    /** Checks the new settings against Discord and saves them. Only the bot's owner can change the server. */
    async save(user: Me, next: Settings) {
        if (!user.isAdmin) throw new ForbiddenException();
        if (next.guildId !== this.get().guildId && !user.isOwner) throw new ForbiddenException('Only the bot owner can change the server.');

        if (next.guildId) {
            const { forums, roles } = await this.options(next.guildId);
            if (next.forumId && !forums.some((f) => f.id === next.forumId)) throw new BadRequestException('That forum is not in this server.');
            for (const roleId of [next.adminRoleId, next.fixerRoleId, next.edgerunnerRoleId]) {
                if (roleId && !roles.some((r) => r.id === roleId)) throw new BadRequestException('That role is not in this server.');
            }
        } else {
            next = { ...EMPTY, reminderHours: next.reminderHours, confirmHours: next.confirmHours, runnerRoles: next.runnerRoles };
        }

        // Fixer always stays: it's what makes a runner a fixer
        if (!next.runnerRoles.includes(FIXER_ROLE)) next = { ...next, runnerRoles: [...next.runnerRoles, FIXER_ROLE] };
        this.db.insert(settings).values({ id: 1, ...next }).onConflictDoUpdate({ target: settings.id, set: next }).run();
        this.cached = next;
    }

    inviteUrl(): string {
        const p = PermissionFlagsBits;
        const permissions = [p.ViewChannel, p.SendMessages, p.SendMessagesInThreads, p.CreatePublicThreads, p.ManageThreads, p.EmbedLinks, p.ManageChannels];
        const params = new URLSearchParams({
            client_id: this.client.application?.id ?? '',
            scope: 'bot applications.commands',
            permissions: permissions.reduce((all, bit) => all | bit, 0n).toString(),
        });
        return `https://discord.com/oauth2/authorize?${params}`;
    }

    /** Servers the bot is in. */
    guilds(): Option[] {
        return this.client.guilds.cache.map((g) => ({ id: g.id, name: g.name })).sort((a, b) => a.name.localeCompare(b.name));
    }

    /** A server's forums and roles, for the dropdowns. */
    async options(guildId: string): Promise<GuildOptions> {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) throw new NotFoundException('The bot is not in that server.');

        const channels = await guild.channels.fetch();
        const forums = channels
            .filter((c) => c?.type === ChannelType.GuildForum)
            .map((c) => ({ id: c!.id, name: c!.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        // Highest first, like Discord shows them. Bot roles can't be given to people, so they're left out.
        const roles = guild.roles.cache
            .filter((r) => !r.managed)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : undefined }));

        return { forums, roles };
    }
}
