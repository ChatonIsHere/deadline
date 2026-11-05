import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client, Guild, GuildMember, PermissionFlagsBits, Team, User } from 'discord.js';
import { Context, ContextOf, Once } from 'necord';
import { SettingsService } from '../settings/settings.service';
import { FIXER_ROLE, type Me, type Member } from '../shared/schemas';

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
        return member ? toMember(member) : { id, name: 'Unknown player', avatar: null };
    }

    /** Everyone who can sign in (admin, fixer or edgerunner role, or Manage Server). For admins giving out runners. */
    players(): Member[] {
        const { adminRoleId, fixerRoleId, edgerunnerRoleId } = this.settings.get();
        const roles = [adminRoleId, fixerRoleId, edgerunnerRoleId].filter((r): r is string => !!r);
        return [...(this.guild?.members.cache.values() ?? [])]
            .filter((m) => !m.user.bot && (roles.some((r) => m.roles.cache.has(r)) || m.permissions.has(PermissionFlagsBits.ManageGuild)))
            .map(toMember)
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * Whether a runner counts as a fixer: it has the Fixer role, and it's an NPC (no player)
     * or its player has the Discord fixer role.
     */
    isFixerRunner(runner: { role: string; extraRoles: string[]; ownerId: string | null }): boolean {
        if (runner.role !== FIXER_ROLE && !runner.extraRoles.includes(FIXER_ROLE)) return false;
        if (!runner.ownerId) return true;
        const roleId = this.settings.get().fixerRoleId;
        return !!roleId && !!this.guild?.members.cache.get(runner.ownerId)?.roles.cache.has(roleId);
    }
}

function toMember(m: GuildMember): Member {
    return { id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }) };
}
