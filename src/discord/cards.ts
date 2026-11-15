import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { GigView, Review, RunnerView } from '../shared/schemas';
import type { EmojiLookup } from './emoji.service';
import { COLOURS, SITE } from './colours';
import { payText } from './gig-embed';
import { slotCount } from '../shared/slots';
import { starRow, voice } from './voice';

// Compact cards for slash command replies. The full gig card is the forum post (gig-embed.ts).

const link = (label: string, url: string) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** /gig: the essentials and links to the post and board. */
export function gigCard(gig: GigView, emoji: EmojiLookup, boardUrl: string, imageUrl: string | null) {
    const embed = new EmbedBuilder()
        .setColor(COLOURS[gig.status])
        .setTitle(gig.name)
        .setURL(`${boardUrl}/gigs/${gig.ref}`)
        .setDescription(cut(gig.brief, 300))
        .addFields(
            { name: 'Fixer', value: gig.fixerName, inline: true },
            { name: 'Location', value: gig.location, inline: true },
            { name: 'Pay', value: payText(gig, emoji), inline: true },
            { name: 'Session', value: gig.sessionAt ? voice.when(gig.sessionAt, gig.sessionEndAt) : 'Not scheduled', inline: true },
            { name: 'Crew', value: `${slotCount(gig.slots)}${gig.reserves.length ? ` (+${gig.reserves.length} reserve)` : ''}`, inline: true },
            { name: 'Status', value: gig.status === 'open' ? 'Taking runners' : 'Sign-ups locked', inline: true },
        )
        .setThumbnail(imageUrl);

    const buttons = new ActionRowBuilder<ButtonBuilder>();
    if (gig.threadUrl) buttons.addComponents(link('Forum post', gig.threadUrl));
    buttons.addComponents(link('Open on board', `${boardUrl}/gigs/${gig.ref}`));
    return { embeds: [embed], components: [buttons] };
}

/** /runner and /fixer: who they are, and for fixers, how to find them and how they rate. */
/**
 * /runner and /fixer. The runner side has roles and crews; the fixer side (for fixers) goes by
 * their alias, with their office, rating and the gigs they put out.
 */
export function runnerCard(runner: RunnerView, side: 'runner' | 'fixer', emoji: EmojiLookup, boardUrl: string, imageUrl: string | null) {
    const fixer = side === 'fixer' && runner.isFixer;
    const roles = [runner.role, ...runner.extraRoles].join(', ');
    const recent = (fixer ? runner.fixerGigs : runner.gigs).slice(0, 5);
    const fields = [
        ...(fixer ? [] : [{ name: 'Roles', value: roles, inline: true }]),
        { name: 'Played by', value: runner.ownerId ? `<@${runner.ownerId}>` : 'NPC', inline: true },
        ...(runner.status !== 'active' ? [{ name: 'Status', value: runner.status === 'dead' ? 'Flatlined' : 'Retired', inline: true }] : []),
        ...(!fixer && runner.crews.length ? [{ name: 'Crews', value: runner.crews.map((c) => c.name).join(', '), inline: true }] : []),
    ];
    if (fixer) {
        fields.push(
            { name: 'Rating', value: runner.rating.average ? `${starRow(runner.rating.average, emoji)} (${runner.rating.count})` : 'Not rated yet', inline: true },
            ...(runner.officeLocation ? [{ name: 'Office', value: runner.officeLocation, inline: true }] : []),
            ...(runner.contact ? [{ name: 'Reach them', value: runner.contact, inline: true }] : []),
            ...(runner.specialties ? [{ name: 'Specialties', value: runner.specialties, inline: false }] : []),
        );
        if (runner.reviews.length) {
            const review = (r: Review) =>
                `${starRow(r.stars, emoji)} [${r.gig.name}](${boardUrl}/gigs/${r.gig.ref})${r.by ? ` · ${r.by.handle}` : ''}${r.comment ? `\n> ${cut(r.comment, 150)}` : ''}`;
            // Whole ratings only: cutting one short could leave half an emoji code showing
            const lines = runner.reviews.slice(0, 3).map(review);
            while (lines.join('\n').length > 1024) lines.pop();
            if (lines.length) fields.push({ name: 'Latest ratings', value: lines.join('\n'), inline: false });
        }
    }
    if (recent.length) {
        fields.push({
            name: fixer ? 'Recent gigs put out' : 'Recent gigs',
            value: recent.map((g) => `[${g.name}](${boardUrl}/gigs/${g.ref}) · ${g.status}`).join('\n'),
            inline: false,
        });
    }

    const name = fixer ? runner.fixerName : runner.handle;
    const url = fixer ? `${boardUrl}/fixers/${runner.fixerSlug}` : `${boardUrl}/runners/${runner.slug}`;
    const embed = new EmbedBuilder()
        .setColor(runner.status === 'dead' ? SITE.red : runner.status === 'retired' ? SITE.grey : fixer ? SITE.cyan : SITE.yellow)
        .setTitle(runner.status === 'dead' ? `${name} †` : name)
        .setURL(url)
        .setDescription([runner.tagline && `*${runner.tagline}*`, runner.obituary ? cut(runner.obituary, 400) : runner.bio && cut(runner.bio, 400)].filter(Boolean).join('\n\n') || null)
        .addFields(fields)
        .setThumbnail(imageUrl);
    return { embeds: [embed], components: [new ActionRowBuilder<ButtonBuilder>().addComponents(link('Profile', url))] };
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
