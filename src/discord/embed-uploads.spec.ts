import '../test-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { embedUploads } from './gig-embed';

const link = (id: string, name: string) => ({ url: `https://cdn.discordapp.com/attachments/111/${id}/${name}?ex=abc&is=def&hm=123&` });

describe('embedUploads', () => {
    it('finds the card and the fixer picture from the embed links', () => {
        const uploads = embedUploads([{ image: link('222', 'cards-gig-hash.png'), thumbnail: link('333', 'fixer-framed-v6.webp') }]);
        assert.deepEqual(uploads, [
            { id: '222', name: 'cards-gig-hash.png' },
            { id: '333', name: 'fixer-framed-v6.webp' },
        ]);
    });

    it('skips embeds without pictures and pictures hosted elsewhere', () => {
        assert.deepEqual(embedUploads([{ image: null, thumbnail: { url: 'https://example.com/x.png' } }, { image: null, thumbnail: null }]), []);
    });
});
