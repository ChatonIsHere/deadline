import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client, Guild, GuildMember, PermissionFlagsBits, Team, User } from 'discord.js';
import { Context, ContextOf, Once } from 'necord';
import { SettingsService } from '../settings/settings.service';
import type { Me, Member } from '../shared/schemas';

/** People and their roles, read from the bot's view of the server. Nothing about users is stored. */
@Injectable()
export class MembersService {
    private readonly logger = new Logger(MembersService.name);
    /** Whoever owns the Discord application (or its team). Always admins, so setup can't lock anyone out. */
    private readonly owners = new Set<string>();

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly settings: SettingsService,
    ) {}

    @Once('clientReady')
    async onReady(@Context() [client]: ContextOf<'clientReady'>) {
        const { owner } = await client.application.fetch();
        if (owner instanceof Team) owner.members.forEach((m) => this.owners.add(m.id));
        else if (owner instanceof User) this.owners.add(owner.id);
        await this.load();
    }

    /** Caches everyone in the chosen server. Run again when the server changes. */
    async load() {
        const guild = this.guild;
        if (!guild) return;
        const members = await guild.members.fetch();
        this.logger.log(`Cached ${members.size} members of ${guild.name}`);
    }

    private get guild(): Guild | undefined {
        const id = this.settings.get().guildId;
        return id ? this.client.guilds.cache.get(id) : undefined;
    }

    /** A person with their roles, or null if they can't use Deadline. */
    async me(id: string): Promise<Me | null> {
        const isOwner = this.owners.has(id);
        const member = this.guild?.members.cache.get(id) ?? (await this.guild?.members.fetch(id).catch(() => null));

        if (!member) {
            if (!isOwner) return null;
            const user = await this.client.users.fetch(id);
            return { id, name: user.displayName, avatar: user.displayAvatarURL({ size: 64 }), isOwner, isAdmin: true, isFixer: false, isEdgerunner: false };
        }

        const { adminRoleId, fixerRoleId, edgerunnerRoleId } = this.settings.get();
        const has = (roleId: string | null) => !!roleId && member.roles.cache.has(roleId);
        return {
            ...toMember(member),
            isOwner,
            isAdmin: isOwner || member.permissions.has(PermissionFlagsBits.ManageGuild) || has(adminRoleId),
            isFixer: has(fixerRoleId),
            isEdgerunner: has(edgerunnerRoleId),
        };
    }

    /** Name and avatar for display. Falls back to a placeholder for people who left. */
    member(id: string): Member {
        const member = this.guild?.members.cache.get(id);
        return member ? toMember(member) : { id, name: 'Unknown runner', avatar: null };
    }

    edgerunners(): Member[] {
        return this.withRole(this.settings.get().edgerunnerRoleId);
    }

    fixers(): Member[] {
        return this.withRole(this.settings.get().fixerRoleId);
    }

    private withRole(roleId: string | null): Member[] {
        const role = roleId ? this.guild?.roles.cache.get(roleId) : undefined;
        return [...(role?.members.values() ?? [])].map(toMember).sort((a, b) => a.name.localeCompare(b.name));
    }
}

function toMember(m: GuildMember): Member {
    return { id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }) };
}
