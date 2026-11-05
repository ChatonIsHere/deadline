import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { groupSlots } from '../shared/slots';
import type { GigStatus, GigView } from '../shared/schemas';
import type { EmojiLookup } from './emoji.service';
import { voice } from './voice';

const COLOURS: Record<GigStatus, number> = {
    pending: 0x8b8ba7,
    open: 0xf3e600,
    closed: 0x00e5ff,
    completed: 0x39ff88,
    cancelled: 0xff2a6d,
    rejected: 0xff2a6d,
};

/** "2,000eb", or the eb emoji followed by the number when it's uploaded. */
export function money(amount: number, emoji: EmojiLookup): string {
    const n = amount.toLocaleString('en-GB');
    const eb = emoji('eb');
    return eb ? `${eb} ${n}` : `${n}eb`;
}

export const openSlots = (gig: GigView) => gig.slots.filter((s) => !s.runner).length;

/** The forum post's starter message: the gig card plus Join / Leave buttons. */
export function gigMessage(gig: GigView, emoji: EmojiLookup, boardUrl: string, imageUrl: string | null = null) {
    const icon = (name: string, fallback = '') => emoji(name) || fallback;
    const typeIcon = gig.type ? emoji(`type_${gig.type.toLowerCase().replace(/\W+/g, '_')}`) : '';

    const description = [`${icon('objective')} **PRIMARY**`.trim(), gig.objective];
    if (gig.objectives.length) {
        description.push('', `${icon('bonus')} **SECONDARY**`.trim());
        for (const o of gig.objectives) {
            description.push(`- ${o.text}${o.bonus ? ` · +${money(o.bonus, emoji)}` : ''}`);
        }
    }

    const slotLines = groupSlots(gig.slots).map((group) => {
        const title = group.crew ? `**${group.crew.name}**` : '**Any edgerunner**';
        const lines = group.slots.map((s) => (s.runner ? `${icon('slot_filled', '▣')} <@${s.runner.id}>` : `${icon('slot_open', '□')} open`));
        return [title, ...lines].join('\n');
    });

    const taken = gig.slots.length - openSlots(gig);

    const embed = new EmbedBuilder()
        .setColor(COLOURS[gig.status])
        .setTitle(gig.name)
        .setURL(`${boardUrl}/gigs/${gig.id}`)
        .setDescription(description.join('\n'))
        .addFields(
            { name: 'Fixer', value: `${icon('fixer')} ${gig.fixerName}`.trim(), inline: true },
            { name: 'Location', value: `${icon('location')} ${gig.location}`.trim(), inline: true },
            { name: 'Pay', value: money(gig.pay, emoji), inline: true },
            ...(gig.type ? [{ name: 'Type', value: `${typeIcon} ${gig.type}`.trim(), inline: true }] : []),
            { name: `Crew ${taken}/${gig.slots.length}`, value: slotLines.join('\n\n') },
        )
        .setFooter({ text: voice.footer(gig.status) })
        .setImage(imageUrl)
        .setTimestamp(gig.createdAt);

    const canJoin = gig.status === 'open';
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`gig/join/${gig.id}`)
            .setLabel('Take the job')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!canJoin || taken === gig.slots.length),
        new ButtonBuilder()
            .setCustomId(`gig/leave/${gig.id}`)
            .setLabel('Pull out')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!canJoin),
    );

    return { embeds: [embed], components: [buttons] };
}
