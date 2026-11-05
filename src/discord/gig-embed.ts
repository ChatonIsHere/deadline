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

    // Once a time is set, say who has confirmed. Before that everyone is just interested.
    const runnerLine = (s: GigView['slots'][number]) => {
        if (!s.runner) return `${icon('slot_open', '□')} open`;
        const state = gig.sessionAt && s.state !== 'confirmed' ? ` · *${s.state}*` : '';
        return `${icon('slot_filled', '▣')} <@${s.runner.id}>${state}`;
    };
    const slotLines = groupSlots(gig.slots).map((group) => {
        const title = group.crew ? `**${group.crew.name}**` : '**Any edgerunner**';
        return [title, ...group.slots.map(runnerLine)].join('\n');
    });

    const taken = gig.slots.length - openSlots(gig);
    const active = gig.status === 'open' || gig.status === 'closed';

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
            { name: 'Session', value: gig.sessionAt ? voice.when(gig.sessionAt) : 'Not scheduled yet. Sign up to show interest.' },
            { name: `Crew ${taken}/${gig.slots.length}`, value: slotLines.join('\n\n') },
            ...(gig.reserves.length ? [{ name: 'Reserves', value: gig.reserves.map((r, i) => `${i + 1}. <@${r.id}>`).join('\n') }] : []),
        )
        .setFooter({ text: voice.footer(gig.status) })
        .setImage(imageUrl)
        .setTimestamp(gig.createdAt);

    // Full gigs still take sign-ups: they go on the reserves.
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`gig/join/${gig.id}`)
            .setLabel(gig.sessionAt ? 'Take the job' : "I'm interested")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(gig.status !== 'open'),
        ...(gig.sessionAt ? [confirmButton(gig.id).setDisabled(!active)] : []),
        dropButton(gig.id).setDisabled(!active),
    );

    return { embeds: [embed], components: [buttons] };
}

const confirmButton = (id: number) => new ButtonBuilder().setCustomId(`gig/confirm/${id}`).setLabel('Confirm').setStyle(ButtonStyle.Success);
const dropButton = (id: number) => new ButtonBuilder().setCustomId(`gig/leave/${id}`).setLabel('Pull out').setStyle(ButtonStyle.Secondary);

/** Confirm / drop out buttons for asking runners about a session. */
export const confirmButtons = (id: number) => new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton(id), dropButton(id));

const postButton = (threadUrl: string) => new ButtonBuilder().setLabel('Gig post').setStyle(ButtonStyle.Link).setURL(threadUrl);

/** A DM asking a runner to confirm the session time (or nudging them to). */
export function confirmMessage(gigId: number, content: string, threadUrl: string) {
    return { content, components: [confirmButtons(gigId).addComponents(postButton(threadUrl))] };
}

/** A session reminder DM, with a way to turn reminders off. */
export function reminderMessage(content: string, threadUrl: string) {
    const stop = new ButtonBuilder().setCustomId('prefs/reminders/off').setLabel('Stop reminders').setStyle(ButtonStyle.Secondary);
    return { content, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(postButton(threadUrl), stop)] };
}
