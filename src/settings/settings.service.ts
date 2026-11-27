import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ChannelType, Client, PermissionFlagsBits } from 'discord.js';
import { z } from 'zod';
import { CacheService } from '../cache/cache.service';
import { PrismaService } from '../prisma/prisma.service';
import { CORE_ROLES, FIXER_ROLE, type GuildOptions, type Me, type Option, type Settings } from '../shared/schemas';

const roleList = z.array(z.string());

const EMPTY: Settings = {
    guildId: null,
    forumId: null,
    adminRoleId: null,
    fixerRoleId: null,
    edgerunnerRoleId: null,
    reminderHours: 8,
    confirmHours: 48,
    runnerRoles: CORE_ROLES,
    maxSignups: 0,
    dmChannelId: null,
};

/**
 * Which server, forum and roles Deadline uses. Kept in the database, changed on the web.
 * Read once at startup and kept in memory: there's one instance, and every change goes
 * through save(), so it never goes stale. That keeps get() synchronous for its many callers.
 */
@Injectable()
export class SettingsService implements OnModuleInit {
    private cached: Settings = EMPTY;
    /** Told after each save (the chat relay picks up a new DM channel). */
    private readonly listeners: ((next: Settings, before: Settings) => void)[] = [];

    constructor(
        private readonly prisma: PrismaService,
        @Inject(Client) private readonly client: Client,
        private readonly cache: CacheService,
    ) {}

    async onModuleInit() {
        const row = await this.prisma.settings.findUnique({ where: { id: 1 } });
        if (row) {
            const { id: _, runnerRoles, ...rest } = row;
            this.cached = { ...rest, runnerRoles: roleList.parse(runnerRoles) };
        }
    }

    get(): Settings {
        return this.cached;
    }

    onSave(listener: (next: Settings, before: Settings) => void) {
        this.listeners.push(listener);
    }

    /** Checks the new settings against Discord and saves them. Only the bot's owner can change the server. */
    async save(user: Me, next: Settings) {
        if (!user.isAdmin) throw new ForbiddenException();
        if (next.guildId !== this.get().guildId && !user.isOwner) throw new ForbiddenException('Only the bot owner can change the server.');

        if (next.guildId) {
            const { forums, roles, textChannels } = await this.options(next.guildId);
            if (next.forumId && !forums.some((f) => f.id === next.forumId)) throw new BadRequestException('That forum is not in this server.');
            if (next.dmChannelId && !textChannels.some((c) => c.id === next.dmChannelId)) throw new BadRequestException('That channel is not in this server.');
            for (const roleId of [next.adminRoleId, next.fixerRoleId, next.edgerunnerRoleId]) {
                if (roleId && !roles.some((r) => r.id === roleId)) throw new BadRequestException('That role is not in this server.');
            }
        } else {
            next = { ...EMPTY, reminderHours: next.reminderHours, confirmHours: next.confirmHours, runnerRoles: next.runnerRoles, maxSignups: next.maxSignups };
        }

        // Fixer always stays: it's what makes a runner a fixer
        if (!next.runnerRoles.includes(FIXER_ROLE)) next = { ...next, runnerRoles: [...next.runnerRoles, FIXER_ROLE] };
        await this.prisma.settings.upsert({ where: { id: 1 }, create: { id: 1, ...next }, update: next });
        const before = this.cached;
        this.cached = next;
        for (const listener of this.listeners) listener(next, before);
    }

    inviteUrl(): string {
        const p = PermissionFlagsBits;
        // Read Message History is needed to edit a post's first message. Chats: private threads,
        // a webhook to post as characters, and Manage Messages to swap players' messages for those posts.
        const permissions = [
            p.ViewChannel,
            p.SendMessages,
            p.SendMessagesInThreads,
            p.ReadMessageHistory,
            p.ManageThreads,
            p.EmbedLinks,
            p.AttachFiles,
            p.ManageChannels,
            // Setting the DM channel's permissions for the player roles
            p.ManageRoles,
            p.CreatePrivateThreads,
            p.ManageWebhooks,
            p.ManageMessages,
        ];
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

    /** A server's forums and roles, for the dropdowns. Cached for 5 minutes: it asks Discord. */
    async options(guildId: string): Promise<GuildOptions> {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) throw new NotFoundException('The bot is not in that server.');
        return this.cache.remember(`guild-options:v2:${guildId}`, 300, () => this.loadOptions(guildId));
    }

    private async loadOptions(guildId: string): Promise<GuildOptions> {
        const guild = this.client.guilds.cache.get(guildId)!;

        const channels = await guild.channels.fetch();
        const forums = channels
            .filter((c) => c?.type === ChannelType.GuildForum)
            .map((c) => ({ id: c!.id, name: c!.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const textChannels = channels
            .filter((c) => c?.type === ChannelType.GuildText)
            .map((c) => ({ id: c!.id, name: c!.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        // Highest first, like Discord shows them. Bot roles can't be given to people, so they're left out.
        const roles = guild.roles.cache
            .filter((r) => !r.managed)
            .sort((a, b) => b.position - a.position)
            .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : undefined }));

        return { forums, roles, textChannels };
    }
}
