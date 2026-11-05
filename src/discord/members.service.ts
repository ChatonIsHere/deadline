import { Inject, Injectable, Logger } from '@nestjs/common';
import { Client, Guild, GuildMember } from 'discord.js';
import { Context, ContextOf, Once } from 'necord';
import { config } from '../config';
import type { Me, Member } from '../shared/schemas';

/** People and their roles, read from the bot's view of the server. Nothing about users is stored. */
@Injectable()
export class MembersService {
    private readonly logger = new Logger(MembersService.name);

    constructor(@Inject(Client) private readonly client: Client) {}

    @Once('clientReady')
    async onReady(@Context() [client]: ContextOf<'clientReady'>) {
        const guild = await client.guilds.fetch(config.DISCORD_GUILD_ID);
        const members = await guild.members.fetch();
        this.logger.log(`Cached ${members.size} members of ${guild.name}`);
    }

    private get guild(): Guild | undefined {
        return this.client.guilds.cache.get(config.DISCORD_GUILD_ID);
    }

    /** A member with their roles, or null if they aren't in the server. */
    async me(id: string): Promise<Me | null> {
        const member = this.guild?.members.cache.get(id) ?? (await this.guild?.members.fetch(id).catch(() => null));
        if (!member) return null;
        const roles = member.roles.cache;
        return {
            ...toMember(member),
            isAdmin: roles.has(config.ADMIN_ROLE_ID),
            isFixer: roles.has(config.FIXER_ROLE_ID),
            isEdgerunner: roles.has(config.EDGERUNNER_ROLE_ID),
        };
    }

    /** Name and avatar for display. Falls back to a placeholder for people who left. */
    member(id: string): Member {
        const member = this.guild?.members.cache.get(id);
        return member ? toMember(member) : { id, name: 'Unknown runner', avatar: null };
    }

    edgerunners(): Member[] {
        const role = this.guild?.roles.cache.get(config.EDGERUNNER_ROLE_ID);
        return [...(role?.members.values() ?? [])].map(toMember).sort((a, b) => a.name.localeCompare(b.name));
    }
}

function toMember(m: GuildMember): Member {
    return { id: m.id, name: m.displayName, avatar: m.displayAvatarURL({ size: 64 }) };
}
