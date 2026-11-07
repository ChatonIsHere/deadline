import { type APIEmbed, type APIEmbedField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import type { Payout } from '../gigs/debrief.service';
import { groupSlots } from '../shared/slots';
import { type GigStatus, type GigView, payRange, type RunnerCard } from '../shared/schemas';
import { layoutEmbeds, packEmbeds, toMessages } from './embed-pack';
import type { EmojiLookup } from './emoji.service';
import { voice } from './voice';

export const COLOURS: Record<GigStatus, number> = {
    pending: 0x8b8ba7,
    open: 0xf3e600,
    closed: 0x00e5ff,
    completed: 0x39ff88,
    cancelled: 0xff3b30,
    rejected: 0xff3b30,
};

/** "2,000eb", or the eb emoji followed by the number when it's uploaded. */
export function money(amount: number, emoji: EmojiLookup): string {
    const n = amount.toLocaleString('en-GB');
    const eb = emoji('eb');
    return eb ? `${eb} ${n}` : `${n}eb`;
}

/**
 * "€$ 2,000", or a range when secondary objectives pay bonuses: "€$ 2,000 – 2,500". A + on
 * the end means per-each bonuses can take it higher.
 */
export function payText(gig: GigView, emoji: EmojiLookup): string {
    const { min, max, open } = payRange(gig);
    return (max > min ? `${money(min, emoji)} – ${max.toLocaleString('en-GB')}` : money(min, emoji)) + (open ? '+' : '');
}

/** A secondary objective's bonus: "+€$ 500", or "+€$ 50 each" when it's paid per time. */
const bonusText = (o: GigView['objectives'][number], emoji: EmojiLookup) => (o.bonus ? ` · +${money(o.bonus, emoji)}${o.each ? ' each' : ''}` : '');

/** The primary objective: one part with its pay on the line, or a list of parts and the pay under them. */
function primaryText(gig: GigView, emoji: EmojiLookup, icon: string): string {
    const parts = gig.primaryObjective;
    if (parts.length === 1) return `${icon} ${parts[0]} · ${money(gig.pay, emoji)}`.trim();
    return [...parts.map((p) => `${icon} ${p}`.trim()), `**Pays** ${money(gig.pay, emoji)}`].join('\n');
}

export const openSlots = (gig: GigView) => gig.slots.filter((s) => !s.runner).length;

const cut = (text: string, max = 1024) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The GM's summary and the crew's rewards, once a gig is complete. */
function debriefFields(gig: GigView, emoji: EmojiLookup): APIEmbedField[] {
    if (gig.status !== 'completed' || !gig.crewRewards) return [];
    const r = gig.crewRewards;
    const rewards = [r.eb ? money(r.eb, emoji) : '', r.ip ? `${r.ip} IP` : '', r.hqIp ? `${r.hqIp} HQ IP` : '', r.text ?? ''].filter(Boolean);
    const extra = gig.runnerRewards.map((x) => `**${x.runner.handle}**: ${[x.eb ? `+${money(x.eb, emoji)}` : '', x.ip ? `+${x.ip} IP` : '', x.text ?? ''].filter(Boolean).join(' · ')}`);
    return [
        ...(gig.summary ? [{ name: 'Debrief', value: gig.summary }] : []),
        ...(rewards.length || extra.length ? [{ name: 'Crew rewards', value: [rewards.join(' · ') || 'none', ...extra].join('\n') }] : []),
    ];
}

/**
 * The forum post. `first` is the starter message: the brief as the description, the
 * details as fields, and the buttons. Nothing gets cut: whatever doesn't fit Discord's
 * limits goes in `more`, follow-up messages in the thread.
 */
export function gigMessage(gig: GigView, emoji: EmojiLookup, boardUrl: string, images: { gig: string | null; fixer: string | null } = { gig: null, fixer: null }) {
    const icon = (name: string, fallback = '') => emoji(name) || fallback;
    const typeIcon = gig.type ? emoji(`type_${gig.type.toLowerCase().replace(/\W+/g, '_')}`) : '';

    // Once a time is set, say who has confirmed. Before that everyone is just interested.
    const runnerLine = (s: GigView['slots'][number]) => {
        if (!s.runner) return `${icon('slot_open', '□')} open`;
        const state = gig.sessionAt && s.state !== 'confirmed' ? ` · *${s.state}*` : '';
        return `${icon('slot_filled', '▣')} **${s.runner.handle}**${state}`;
    };
    // One field per crew (and one for anyone), side by side, with how many of its slots are taken
    const slotFields: APIEmbedField[] = groupSlots(gig.slots).map((group) => ({
        name: `${group.crew ? group.crew.name : 'Freelance'} · ${group.slots.filter((x) => x.runner).length}/${group.slots.length}`,
        value: group.slots.map(runnerLine).join('\n'),
        inline: true,
    }));
    const active = gig.status === 'open' || gig.status === 'closed';

    const fields: APIEmbedField[] = [
        { name: 'Fixer', value: `${icon('fixer')} ${gig.fixerName}`.trim(), inline: true },
        { name: 'Location', value: `${icon('location')} ${gig.location}`.trim(), inline: true },
        { name: 'Pay', value: payText(gig, emoji), inline: true },
        ...(gig.type ? [{ name: 'Type', value: `${typeIcon} ${gig.type}`.trim(), inline: true }] : []),
        ...(gig.primaryObjective.length ? [{ name: 'Primary objective', value: primaryText(gig, emoji, icon('objective', '-')) }] : []),
        ...(gig.objectives.length
            ? [
                  {
                      name: 'Secondary objectives',
                      // Undisclosed ones keep their place in the list, but not what they are or pay
                      value: gig.objectives.map((o) => `${icon('bonus', '-')} ${o.secret ? '`[ NOT DISCLOSED ]`' : `${o.text}${bonusText(o, emoji)}`}`).join('\n'),
                  },
              ]
            : []),
        ...debriefFields(gig, emoji),
    ];
    const signupFields: APIEmbedField[] = [
        { name: 'Session', value: gig.sessionAt ? voice.when(gig.sessionAt) : 'Not scheduled yet. Sign up to show interest.' },
        ...slotFields,
        ...(gig.reserves.length ? [{ name: 'Reserves', value: gig.reserves.map((r, i) => `${i + 1}. ${r.handle}`).join('\n') }] : []),
    ];

    // Two embeds: the job (brief, details, picture), then sign-ups (session, crew) with the status underneath
    const colour = { color: COLOURS[gig.status] };
    const head: APIEmbed = {
        ...colour,
        title: gig.name,
        url: `${boardUrl}/gigs/${gig.ref}`,
        description: gig.brief,
        // Footers can't hold links, so the link to the board goes on the author line, which can
        author: { name: 'DEADLINE // GIG BOARD', url: `${boardUrl}/gigs`, icon_url: `${boardUrl}/logo.png` },
        thumbnail: images.fixer ? { url: images.fixer } : undefined,
        image: images.gig ? { url: images.gig } : undefined,
    };
    const signups: APIEmbed = { ...colour, title: 'Sign-ups', footer: { text: voice.footer(gig.status) }, timestamp: new Date(gig.createdAt).toISOString() };
    const [embeds, ...more] = toMessages([...layoutEmbeds(head, fields, colour), ...layoutEmbeds(signups, signupFields, colour)]);

    // Full gigs still take sign-ups: they go on the reserves.
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`gig/join/${gig.id}`)
            .setLabel(gig.sessionAt ? 'Take the job' : "I'm interested")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(gig.status !== 'open'),
        ...(gig.sessionAt ? [confirmButton(gig.id).setDisabled(!active)] : []),
        dropButton(gig.id).setDisabled(!active),
        new ButtonBuilder().setLabel('Open on board').setStyle(ButtonStyle.Link).setURL(`${boardUrl}/gigs/${gig.ref}`),
    );

    return { first: { embeds, components: [buttons] }, more: more.map((embeds) => ({ embeds })) };
}

/**
 * The last message in a finished gig's thread: the GM's summary, the rewards and who went.
 * The post itself keeps the same details in its fields.
 */
export function debriefMessages(gig: GigView, emoji: EmojiLookup): { content?: string; embeds: APIEmbed[] }[] {
    const crew = gig.slots.filter((s) => s.runner).map((s) => `**${s.runner!.handle}**`);
    const fields: APIEmbedField[] = [
        ...debriefFields(gig, emoji).filter((f) => f.name !== 'Debrief'),
        ...(crew.length ? [{ name: 'Crew', value: crew.join(', ') }] : []),
    ];
    const head: APIEmbed = { color: COLOURS.completed, title: `Debrief // ${gig.name}`, description: gig.summary ?? undefined };
    const [first, ...more] = packEmbeds(head, fields, { color: COLOURS.completed });
    return [{ content: voice.statusChanged.completed, embeds: first }, ...more.map((embeds) => ({ embeds }))];
}

const confirmButton = (id: string) => new ButtonBuilder().setCustomId(`gig/confirm/${id}`).setLabel('Confirm').setStyle(ButtonStyle.Success);
const dropButton = (id: string) => new ButtonBuilder().setCustomId(`gig/leave/${id}`).setLabel('Pull out').setStyle(ButtonStyle.Secondary);

/** Confirm and Pull out buttons, for asking runners about a session. */
export const confirmButtons = (id: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton(id), dropButton(id));

const postButton = (threadUrl: string) => new ButtonBuilder().setLabel('Gig post').setStyle(ButtonStyle.Link).setURL(threadUrl);

/** A DM asking a runner to confirm the session time (or nudging them to). */
export function confirmMessage(gigId: string, content: string, threadUrl: string) {
    return { content, components: [confirmButtons(gigId).addComponents(postButton(threadUrl))] };
}

/**
 * A runner's payout DM: what they earned, and a star rating menu for the fixer when the
 * gig had a fixer character.
 */
export function payoutMessage(gig: GigView, payout: Payout, emoji: EmojiLookup, threadUrl: string | null) {
    const embed = new EmbedBuilder()
        .setColor(COLOURS.completed)
        .setTitle(`Payout // ${gig.name}`)
        .setDescription(gig.summary ? cut(gig.summary, 2000) : null)
        .addFields(
            { name: 'Runner', value: payout.handle, inline: true },
            { name: 'Pay', value: payout.eb ? money(payout.eb, emoji) : '-', inline: true },
            { name: 'IP', value: String(payout.ip || '-'), inline: true },
            ...(payout.hqIp ? [{ name: 'HQ IP (crew)', value: String(payout.hqIp), inline: true }] : []),
            ...(payout.extras.length ? [{ name: 'Extras', value: cut(payout.extras.map((e) => `- ${e}`).join('\n')) }] : []),
        );

    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
    if (gig.fixerRunnerId) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`rate/${gig.id}`)
            .setPlaceholder(voice.rateFixer(gig.fixerName))
            .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: `${'★'.repeat(n)}${'☆'.repeat(5 - n)}`, value: String(n) })));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
    }
    if (threadUrl) rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(postButton(threadUrl)));
    return { content: voice.payout(gig.name), embeds: [embed], components: rows };
}

/** Lets a player pick which of their runners signs up. */
export function pickRunnerMessage(gigId: string, choices: RunnerCard[]) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`gig/pick/${gigId}`)
        .setPlaceholder('Pick a runner')
        .addOptions(choices.slice(0, 25).map((r) => ({ label: r.handle, description: [r.role, ...r.extraRoles].join(', ').slice(0, 100), value: String(r.id) })));
    return { content: voice.pickRunnerPrompt(), components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

/** A session reminder DM, with a way to turn reminders off. */
export function reminderMessage(content: string, threadUrl: string) {
    const stop = new ButtonBuilder().setCustomId('prefs/reminders/off').setLabel('Stop reminders').setStyle(ButtonStyle.Secondary);
    return { content, components: [new ActionRowBuilder<ButtonBuilder>().addComponents(postButton(threadUrl), stop)] };
}
