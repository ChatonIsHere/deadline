import type { APIEmbed, APIEmbedField } from 'discord.js';

/** Discord's embed limits. `total` counts every embed in one message together. */
export const LIMITS = { description: 4096, fieldName: 256, fieldValue: 1024, fields: 25, embeds: 10, total: 6000 };

/** Cuts text into pieces of at most `max` characters, at a line break or space where possible. */
export function splitText(text: string, max: number): string[] {
    const pieces: string[] = [];
    let rest = text;
    while (rest.length > max) {
        let at = rest.lastIndexOf('\n', max);
        if (at <= 0) at = rest.lastIndexOf(' ', max);
        if (at <= 0) at = max;
        pieces.push(rest.slice(0, at).trimEnd());
        rest = rest.slice(at).trimStart();
    }
    pieces.push(rest);
    return pieces.filter(Boolean);
}

/** Long field values go over several fields. The later ones are named "(cont.)". */
function splitFields(fields: APIEmbedField[]): APIEmbedField[] {
    return fields.flatMap((f) =>
        splitText(f.value, LIMITS.fieldValue).map((value, i) => ({
            name: (i ? `${f.name} (cont.)` : f.name).slice(0, LIMITS.fieldName),
            value,
            inline: i ? false : f.inline,
        })),
    );
}

/** Characters Discord counts towards an embed's limit. */
export function embedSize(e: APIEmbed): number {
    const fields = (e.fields ?? []).reduce((sum, f) => sum + f.name.length + f.value.length, 0);
    return (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0) + fields;
}

/**
 * Lays out an embed and its fields so nothing gets cut: long text is split, extra embeds are
 * added when one fills up, and extra messages when a message does. Returns the embeds for
 * each message, the first holding `head`. Later embeds start from `more` (e.g. just a colour).
 */
export function packEmbeds(head: APIEmbed, fields: APIEmbedField[], more: APIEmbed = {}): APIEmbed[][] {
    const [first, ...rest] = head.description ? splitText(head.description, LIMITS.description) : [];
    const embeds: APIEmbed[] = [{ ...head, description: first, fields: [] }, ...rest.map((description) => ({ ...more, description, fields: [] }))];

    let current = embeds[embeds.length - 1];
    for (const field of splitFields(fields)) {
        const full = current.fields!.length >= LIMITS.fields || embedSize(current) + field.name.length + field.value.length > LIMITS.total;
        if (full) {
            current = { ...more, fields: [] };
            embeds.push(current);
        }
        current.fields!.push(field);
    }

    const messages: APIEmbed[][] = [];
    let message: APIEmbed[] = [];
    let total = 0;
    for (const embed of embeds) {
        const size = embedSize(embed);
        if (message.length && (message.length >= LIMITS.embeds || total + size > LIMITS.total)) {
            messages.push(message);
            message = [];
            total = 0;
        }
        message.push(embed);
        total += size;
    }
    messages.push(message);
    return messages;
}
