/** What a link shows when it's pasted into Discord or anywhere else that reads Open Graph tags. */
export interface LinkPreview {
    title: string;
    description: string;
    image: string;
    /** The picture goes full width under the text. Otherwise it's a thumbnail beside it. */
    large?: boolean;
    url: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The tags for the page's head. Names and briefs are written by players, so everything is escaped. */
export function previewTags({ title, description, image, large, url }: LinkPreview): string {
    const tags = [
        ['name', 'description', description],
        ['property', 'og:site_name', 'Deadline'],
        ['property', 'og:type', 'website'],
        ['property', 'og:url', url],
        ['property', 'og:title', title],
        ['property', 'og:description', description],
        ['property', 'og:image', image],
        ['name', 'twitter:card', large ? 'summary_large_image' : 'summary'],
    ];
    return tags.map(([attr, name, content]) => `<meta ${attr}="${name}" content="${escapeHtml(content)}" />`).join('\n        ');
}

/** Markdown as one line of plain text, cut at a word to fit `max` characters. */
export function plainText(markdown: string, max: number): string {
    const text = markdown
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
        .replace(/[*~`]|\b_|_\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}...` : text;
}
