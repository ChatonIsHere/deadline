import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { GigView, Review, RunnerView } from '../shared/schemas';
import type { EmojiLookup } from './emoji.service';
import { COLOURS, openSlots, payText } from './gig-embed';
import { voice } from './voice';

// Compact cards for slash command replies. The full gig card is the forum post (gig-embed.ts).

const link = (label: string, url: string) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const stars = (avg: number) => '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));

/** /gig: the essentials and links to the post and board. */
export function gigCard(gig: GigView, emoji: EmojiLookup, boardUrl: string, imageUrl: string | null) {
    const taken = gig.slots.length - openSlots(gig);
    const embed = new EmbedBuilder()
        .setColor(COLOURS[gig.status])
        .setTitle(gig.name)
        .setURL(`${boardUrl}/gigs/${gig.ref}`)
        .setDescription(cut(gig.brief, 300))
        .addFields(
            { name: 'Fixer', value: gig.fixerName, inline: true },
            { name: 'Location', value: gig.location, inline: true },
            { name: 'Pay', value: payText(gig, emoji), inline: true },
            { name: 'Session', value: gig.sessionAt ? voice.when(gig.sessionAt) : 'Not scheduled', inline: true },
            { name: 'Crew', value: `${taken}/${gig.slots.length}${gig.reserves.length ? ` (+${gig.reserves.length} reserve)` : ''}`, inline: true },
            { name: 'Status', value: gig.status === 'open' ? 'Taking runners' : 'Sign-ups locked', inline: true },
        )
        .setThumbnail(imageUrl);

    const buttons = new ActionRowBuilder<ButtonBuilder>();
    if (gig.threadUrl) buttons.addComponents(link('Forum post', gig.threadUrl));
    buttons.addComponents(link('Open on board', `${boardUrl}/gigs/${gig.ref}`));
    return { embeds: [embed], components: [buttons] };
}

/** /runner and /fixer: who they are, and for fixers, how to find them and how they rate. */
export function runnerCard(runner: RunnerView, boardUrl: string, imageUrl: string | null) {
    const roles = [runner.role, ...runner.extraRoles].join(', ');
    const recent = (runner.isFixer ? runner.fixerGigs : runner.gigs).slice(0, 5);
    const fields = [
        { name: 'Roles', value: roles, inline: true },
        { name: 'Played by', value: runner.ownerId ? `<@${runner.ownerId}>` : 'NPC', inline: true },
        ...(runner.crews.length ? [{ name: 'Crews', value: runner.crews.map((c) => c.name).join(', '), inline: true }] : []),
    ];
    if (runner.isFixer) {
        fields.push(
            { name: 'Rating', value: runner.rating.average ? `${stars(runner.rating.average)} (${runner.rating.count})` : 'Not rated yet', inline: true },
            ...(runner.officeLocation ? [{ name: 'Office', value: runner.officeLocation, inline: true }] : []),
            ...(runner.contact ? [{ name: 'Reach them', value: runner.contact, inline: true }] : []),
            ...(runner.specialties ? [{ name: 'Specialties', value: runner.specialties, inline: false }] : []),
        );
        if (runner.reviews.length) {
            const review = (r: Review) =>
                `${stars(r.stars)} [${r.gig.name}](${boardUrl}/gigs/${r.gig.ref})${r.by ? ` · ${r.by.handle}` : ''}${r.comment ? `\n> ${cut(r.comment, 150)}` : ''}`;
            fields.push({ name: 'Latest ratings', value: cut(runner.reviews.slice(0, 3).map(review).join('\n'), 1024), inline: false });
        }
    }
    if (recent.length) {
        fields.push({
            name: runner.isFixer ? 'Recent gigs put out' : 'Recent gigs',
            value: recent.map((g) => `[${g.name}](${boardUrl}/gigs/${g.ref}) · ${g.status}`).join('\n'),
            inline: false,
        });
    }

    const embed = new EmbedBuilder()
        .setColor(COLOURS.open)
        .setTitle(runner.handle)
        .setURL(`${boardUrl}/runners/${runner.slug}`)
        .setDescription(runner.isFixer && runner.bio ? cut(runner.bio, 400) : null)
        .addFields(fields)
        .setThumbnail(imageUrl);
    return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(link('Profile', `${boardUrl}/runners/${runner.slug}`))] };
}

/** /mygigs: where each of the player's runners stands. */
export function myGigsCard(gigs: GigView[], userId: string, boardUrl: string) {
    const lines = gigs.map((g) => {
        const slot = g.slots.find((s) => s.runner?.ownerId === userId);
        const reserve = g.reserves.findIndex((r) => r.ownerId === userId) + 1;
        const who = slot?.runner?.handle ?? g.reserves[reserve - 1]?.handle ?? '?';
        let where: string;
        if (reserve) where = `reserve #${reserve}`;
        else if (slot?.state === 'awaiting') where = `**confirm${slot.confirmBy ? ` by <t:${Math.floor(slot.confirmBy / 1000)}:f>` : ''}**`;
        else where = slot?.state ?? '';
        const when = g.sessionAt ? `<t:${Math.floor(g.sessionAt / 1000)}:f>` : 'no time yet';
        const title = g.threadUrl ? `[${g.name}](${g.threadUrl})` : `[${g.name}](${boardUrl}/gigs/${g.ref})`;
        return `${title}\n${who} · ${where} · ${when}`;
    });
    const embed = new EmbedBuilder()
        .setColor(COLOURS.open)
        .setTitle('Your gigs')
        .setDescription(lines.length ? cut(lines.join('\n\n'), 4000) : "None of your runners are on a live gig.");
    return { embeds: [embed] };
}
