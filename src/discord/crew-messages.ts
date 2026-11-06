import { type APIEmbed, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { CrewView, RunnerCard } from '../shared/schemas';
import { packEmbeds } from './embed-pack';
import type { EmojiLookup } from './emoji.service';
import { COLOURS } from './gig-embed';
import { voice } from './voice';

/** A role's emoji (role_solo, role_netrunner...), or '' for roles without one. */
export const roleIcon = (emoji: EmojiLookup, role: string) => emoji(`role_${role.toLowerCase().replace(/\W+/g, '_')}`);

/** "<icon> **Handle** · Role". */
export const runnerLine = (emoji: EmojiLookup, r: RunnerCard) => `${roleIcon(emoji, r.role)} **${r.handle}** · ${r.role}`.trim();

/** The DM a runner's player gets when a crew invites them. */
export function inviteMessage(crew: { id: string; slug: string; name: string; tagline: string }, runner: RunnerCard, from: string, boardUrl: string) {
    const embed = { color: COLOURS.open, title: crew.name, url: `${boardUrl}/crews/${crew.slug}`, description: crew.tagline || undefined };
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`crew/accept/${crew.id}/${runner.id}`).setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`crew/decline/${crew.id}/${runner.id}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setLabel('See the crew').setStyle(ButtonStyle.Link).setURL(`${boardUrl}/crews/${crew.slug}`),
    );
    return { content: voice.crewInvite(crew.name, runner.handle, from), embeds: [embed], components: [buttons] };
}

/** /crew: one field per rank with its runners, then allies. Big crews spill into more messages. */
export function crewCard(crew: CrewView, emoji: EmojiLookup, boardUrl: string): { embeds: APIEmbed[] }[] {
    const fields = crew.ranks
        .map((rank) => ({ name: rank, value: crew.members.filter((m) => m.rank === rank).map((m) => runnerLine(emoji, m)).join('\n') }))
        .filter((f) => f.value);
    if (crew.allies.length) fields.push({ name: 'Allies', value: crew.allies.map((a) => runnerLine(emoji, a)).join('\n') });

    const head: APIEmbed = {
        color: COLOURS.closed,
        title: crew.name,
        url: `${boardUrl}/crews/${crew.slug}`,
        description: [crew.tagline, `${emoji('crew')} ${crew.members.length} runner${crew.members.length === 1 ? '' : 's'}`.trim()].filter(Boolean).join('\n'),
    };
    return packEmbeds(head, fields, { color: COLOURS.closed }).map((embeds) => ({ embeds }));
}
