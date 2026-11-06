import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client, Guild, GuildMember, type MessageCreateOptions, PermissionFlagsBits, Team, User } from 'discord.js';
import { Context, ContextOf, On, Once } from 'necord';
import { PrefsService } from '../auth/prefs.service';
import { CacheService } from '../cache/cache.service';
import { SettingsService } from '../settings/settings.service';
import { FIXER_ROLE, type Me, type Member } from '../shared/schemas';

/** People and their roles, read from the bot's view of the server. Names, avatars and roles aren't stored. */
@Injectable()
export class MembersService {
    private readonly logger = new Logger(MembersService.name);
    /** Whoever owns the Discord application (or its team). Always admins, so setup can't lock anyone out. */
    private readonly owners = new Set<string>();

    constructor(
        @Inject(Client) private readonly client: Client,
        private readonly settings: SettingsService,
        private readonly prefs: PrefsService,
        private readonly cache: CacheService,
    ) {}

    /** Someone's roles changed: their cached sign-in goes, so the change shows on their next click. */
    @On('guildMemberUpdate')
    async onMemberUpdate(@Context() [, member]: ContextOf<'guildMemberUpdate'>) {
        await this.forget(member.id);
    }

    /** Drops someone's cached sign-in (roles, player view, timezone, setup). */
    async forget(id: string) {
        await this.cache.del(meKey(id));
    }

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

    /**
     * A person with their roles, or null if they can't use Deadline. The owner with player
     * view on (Me page) isn't an admin, so they see the board as a player with their real roles.
     */
    async me(id: string): Promise<Me | null> {
        // Every request asks, so it's cached for a minute (and dropped when roles or player view change)
        const cached = await this.cache.get<{ me: Me | null }>(meKey(id));
        if (cached) return cached.me;
        const me = await this.lookUp(id);
        await this.cache.set(meKey(id), { me }, 60);
        return me;
    }

    private async lookUp(id: string): Promise<Me | null> {
        const isOwner = this.owners.has(id);
        const prefs = await this.prefs.get(id);
        const playerView = isOwner && prefs.playerView;
        const own = { timezone: prefs.timezone, needsSetup: !(await this.prefs.setUp(id)) };
        const member = this.guild?.members.cache.get(id) ?? (await this.guild?.members.fetch(id).catch(() => null));

        if (!member) {
            if (!isOwner) return null;
            const user = await this.client.users.fetch(id);
            return { id, name: user.displayName, avatar: user.displayAvatarURL({ size: 64 }), isOwner, isAdmin: !playerView, isFixer: false, isEdgerunner: false, playerView, ...own };
        }

        const { adminRoleId, fixerRoleId, edgerunnerRoleId } = this.settings.get();
        const has = (roleId: string | null) => !!roleId && member.roles.cache.has(roleId);
        return {
            ...toMember(member),
            isOwner,
            isAdmin: !playerView && (isOwner || member.permissions.has(PermissionFlagsBits.ManageGuild) || has(adminRoleId)),
            isFixer: has(fixerRoleId),
            isEdgerunner: has(edgerunnerRoleId),
            playerView,
            ...own,
        };
    }

    /** Name and avatar for display. Falls back to a placeholder for people who left. */
    member(id: string): Member {
        const member = this.guild?.members.cache.get(id);
        return member ? toMember(member) : { id, name: 'Unknown player', avatar: null };
    }

    /** Whether someone on the server has the edgerunner role (from the cache), so their runners can go on gigs. */
    isEdgerunner(userId: string): boolean {
        const roleId = this.settings.get().edgerunnerRoleId;
        return !!roleId && !!this.guild?.members.cache.get(userId)?.roles.cache.has(roleId);
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

    /** Sends a DM to each person. Returns who couldn't be reached (DMs closed, or gone). */
    async dm(userIds: string[], message: MessageCreateOptions): Promise<string[]> {
        const failed: string[] = [];
        for (const id of userIds) {
            try {
                await (await this.client.users.fetch(id)).send(message);
            } catch {
                failed.push(id);
            }
        }
        return failed;
    }
}

const meKey = (id: string) => `me:${id}`;

function toMember(m: GuildMember): Member {
    return { id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }) };
}
