import { type APIEmbed, type APIEmbedField, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import type { Payout } from '../gigs/debrief.service';
import { periodName, signed } from '../shared/downtime';
import { groupSlots, slotCount } from '../shared/slots';
import { type GigView, payRange, type RunnerCard } from '../shared/schemas';
import { layoutEmbeds, packEmbeds, toMessages } from './embed-pack';
import type { EmojiLookup } from './emoji.service';
import { COLOURS, lineEmbed, SITE } from './colours';
import { plainStars, type Said, voice } from './voice';

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
    return (max > min ? `${money(min, emoji)} – ${max.toLocaleString('en-GB')}` : money(min, emoji)) + (open ? '+' : '') + (gig.splitPay ? ' split' : ' per head');
}

/** A secondary objective's bonus: "+€$ 500", or "+€$ 50 each" when it's paid per time. */
const bonusText = (o: GigView['objectives'][number], emoji: EmojiLookup) => (o.bonus ? ` · +${money(o.bonus, emoji)}${o.each ? ' each' : ''}` : '');

/** The primary objective: one part with its pay on the line, or a list of parts and the pay under them. */
function primaryText(gig: GigView, emoji: EmojiLookup, icon: string): string {
    const parts = gig.primaryObjective;
    const pay = `${money(gig.pay, emoji)}${gig.splitPay ? ' split' : ''}`;
    if (parts.length === 1) return `${icon} ${parts[0]} · ${pay}`.trim();
    return [...parts.map((p) => `${icon} ${p}`.trim()), `**Pays** ${pay}`].join('\n');
}

export const openSlots = (gig: GigView) => gig.slots.filter((s) => !s.runner).length;

const cut = (text: string, max = 1024) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** The GM's summary and the crew's rewards, once a gig is complete. */
function debriefFields(gig: GigView, emoji: EmojiLookup): APIEmbedField[] {
    if (gig.status !== 'completed' || !gig.crewRewards) return [];
    const r = gig.crewRewards;
    const runners = gig.slots.filter((s) => s.runner).length;
    const rewards = [r.eb ? `${money(r.eb, emoji)}${gig.splitPay ? ` split between ${runners}` : ''}` : '', r.ip ? `${r.ip} IP` : '', r.hqIp ? `${r.hqIp} HQ IP` : '', r.text ?? ''].filter(Boolean);
    const extra = gig.runnerRewards.map((x) => `**${x.runner.handle}**: ${[x.share ? money(x.share, emoji) : '', x.eb ? `+${money(x.eb, emoji)}` : '', x.ip ? `+${x.ip} IP` : '', x.hqIp ? `+${x.hqIp} HQ IP` : '', x.text ?? ''].filter(Boolean).join(' · ')}`);
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
/**
 * The pictures already uploaded to a message. Discord leaves anything an embed shows out of the
 * message's attachments, so they're read from the embeds' links: .../attachments/<channel>/<id>/<name>.
 */
export function embedUploads(embeds: { image: { url: string } | null; thumbnail: { url: string } | null }[]): { id: string; name: string }[] {
    return embeds.flatMap((e) => [e.image, e.thumbnail]).flatMap((picture) => {
        const [, id, name] = /\/attachments\/\d+\/(\d+)\/([^/?]+)/.exec(picture?.url ?? '') ?? [];
        return id ? [{ id, name }] : [];
    });
}

export function gigMessage(gig: GigView, emoji: EmojiLookup, boardUrl: string, images: { gig: string | null; fixer: string | null } = { gig: null, fixer: null }) {
    const icon = (name: string, fallback = '') => emoji(name) || fallback;
    const typeIcon = gig.type ? emoji(`type_${gig.type.toLowerCase().replace(/\W+/g, '_')}`) : '';

    // Once a time is set, say who has confirmed. Before that everyone is just interested.
    const runnerLine = (s: GigView['slots'][number]) => {
        if (!s.runner) return `${icon('slot_open', '□')} open${s.unlimited ? ', no limit' : ''}`;
        const state = gig.sessionAt && s.state !== 'confirmed' ? ` · *${s.state}*` : '';
        return `${icon('slot_filled', '▣')} **${s.runner.handle}**${state}`;
    };
    // One field per crew (and one for anyone), side by side, with how many of its slots are taken
    const slotFields: APIEmbedField[] = groupSlots(gig.slots).map((group) => ({
        name: `${group.crew ? group.crew.name : 'Freelance'} · ${slotCount(group.slots)}`,
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
        { name: 'Session', value: gig.sessionAt ? voice.when(gig.sessionAt, gig.sessionEndAt) : 'Not scheduled yet. Sign up to show interest.' },
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
        author: { name: 'Gig board', url: `${boardUrl}/gigs`, icon_url: `${boardUrl}/logo.png` },
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
export function debriefMessages(gig: GigView, emoji: EmojiLookup): { embeds: APIEmbed[] }[] {
    const crew = gig.slots.filter((s) => s.runner).map((s) => `**${s.runner!.handle}**`);
    const fields: APIEmbedField[] = [
        ...debriefFields(gig, emoji).filter((f) => f.name !== 'Debrief'),
        ...(crew.length ? [{ name: 'Crew', value: crew.join(', ') }] : []),
    ];
    const head: APIEmbed = { color: COLOURS.completed, title: `Debrief // ${gig.name}`, description: gig.summary ?? undefined };
    const [first, ...more] = packEmbeds(head, fields, { color: COLOURS.completed });
    return [first, ...more].map((embeds) => ({ embeds }));
}

const confirmButton = (id: string) => new ButtonBuilder().setCustomId(`gig/confirm/${id}`).setLabel('Confirm').setStyle(ButtonStyle.Success);
const dropButton = (id: string) => new ButtonBuilder().setCustomId(`gig/leave/${id}`).setLabel('Pull out').setStyle(ButtonStyle.Secondary);

/** Confirm and Pull out buttons, for asking runners about a session. */
export const confirmButtons = (id: string) => new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton(id), dropButton(id));

const postButton = (threadUrl: string) => new ButtonBuilder().setLabel('Gig post').setStyle(ButtonStyle.Link).setURL(threadUrl);
const boardButton = (gig: GigView, boardUrl: string) => new ButtonBuilder().setLabel('Open on board').setStyle(ButtonStyle.Link).setURL(`${boardUrl}/gigs/${gig.ref}`);

/** Links every gig DM carries: the forum post (once there is one) and the gig on the board. */
const gigLinks = (gig: GigView, threadUrl: string | null, boardUrl: string) => [...(threadUrl ? [postButton(threadUrl)] : []), boardButton(gig, boardUrl)];

/** A gig DM that's just a line, such as being dropped for not confirming. */
export function gigLineMessage(gig: GigView, said: Said, threadUrl: string | null, boardUrl: string) {
    return { embeds: [lineEmbed(said)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(gigLinks(gig, threadUrl, boardUrl))] };
}

/** A DM asking a runner to confirm the session time (or nudging them to). */
export function confirmMessage(gig: GigView, said: Said, threadUrl: string, boardUrl: string) {
    return { embeds: [lineEmbed(said)], components: [confirmButtons(gig.id).addComponents(gigLinks(gig, threadUrl, boardUrl))] };
}

/**
 * A runner's payout DM: what they earned, and a star rating menu for the fixer when the
 * gig had a fixer character.
 */
export function payoutMessage(gig: GigView, payout: Payout, emoji: EmojiLookup, threadUrl: string | null, boardUrl: string) {
    const embed = new EmbedBuilder()
        // Yellow: it's money, and it's yours
        .setColor(SITE.yellow)
        .setTitle(`Payout // ${gig.name}`)
        .setURL(`${boardUrl}/gigs/${gig.ref}`)
        .setDescription(gig.summary ? cut(gig.summary, 2000) : null)
        .addFields(
            { name: 'Runner', value: payout.handle, inline: true },
            { name: 'Pay', value: payout.eb ? money(payout.eb, emoji) : '-', inline: true },
            { name: 'IP', value: String(payout.ip || '-'), inline: true },
            ...(payout.dt ? [{ name: 'DT', value: `+${payout.dt}`, inline: true }] : []),
            ...(payout.hqIp ? [{ name: 'HQ IP (crew)', value: String(payout.hqIp), inline: true }] : []),
            ...(payout.extras.length ? [{ name: 'Extras', value: cut(payout.extras.map((e) => `- ${e}`).join('\n')) }] : []),
        );

    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];
    if (gig.fixerRunnerId) {
        const menu = new StringSelectMenuBuilder()
            .setCustomId(`rate/${gig.id}`)
            .setPlaceholder(voice.rateFixer(gig.fixerName))
            .addOptions([5, 4, 3, 2, 1].map((n) => ({ label: plainStars(n), value: String(n) })));
        rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
    }
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(gigLinks(gig, threadUrl, boardUrl)));
    return { embeds: [embed], components: rows };
}

/** One character's start of the month. */
export interface MonthlyLine {
    runnerId: string;
    handle: string;
    dt: number;
    due: number;
    humanity: number;
    skippable: boolean;
    period: string;
}

/** A player's DT and what's due for the new month, a part per character. */
export function monthlyMessage(period: string, lines: MonthlyLine[], emoji: EmojiLookup, boardUrl: string) {
    const said = voice.monthStart();
    const fields = lines.slice(0, 25).map((l) => ({ name: l.handle, value: `+${l.dt} DT · ${money(l.due, emoji)} due · humanity ${signed(l.humanity)}${l.skippable ? '\n*No game last month, so you can skip this one.*' : ''}` }));
    const embed: APIEmbed = { color: SITE.yellow, title: `Month start // ${periodName(period)}`, description: said.text.replace(/^./, (c) => c.toUpperCase()), fields };

    const skips = lines.filter((l) => l.skippable).slice(0, 19);
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let i = 0; i < skips.length; i += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(skips.slice(i, i + 5).map((l) => new ButtonBuilder().setCustomId(`downtime/skip/${l.runnerId}/${l.period}`).setLabel(`Skip: ${l.handle}`.slice(0, 80)).setStyle(ButtonStyle.Secondary))));
    }
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('Open on board').setStyle(ButtonStyle.Link).setURL(`${boardUrl}/runners`)));
    return { embeds: [embed], components: rows };
}

/** Lets a player pick which of their runners signs up. */
export function pickRunnerMessage(gigId: string, choices: RunnerCard[]) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId(`gig/pick/${gigId}`)
        .setPlaceholder('Pick a runner')
        .addOptions(choices.slice(0, 25).map((r) => ({ label: r.handle, description: [r.role, ...r.extraRoles].join(', ').slice(0, 100), value: String(r.id) })));
    return { embeds: [lineEmbed(voice.pickRunnerPrompt())], components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)] };
}

/** A session reminder DM, with a way to turn reminders off. */
export function reminderMessage(gig: GigView, said: Said, threadUrl: string, boardUrl: string) {
    const stop = new ButtonBuilder().setCustomId('prefs/reminders/off').setLabel('Stop reminders').setStyle(ButtonStyle.Secondary);
    return { embeds: [lineEmbed(said)], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(...gigLinks(gig, threadUrl, boardUrl), stop)] };
}
