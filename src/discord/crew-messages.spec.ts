import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CrewView } from '../shared/schemas';
import { crewCard } from './crew-messages';

const crew: CrewView = { id: 'c', slug: 'moxes', name: 'Moxes', tagline: '', imageId: null, ranks: ['Boss', 'Kid'], members: [], allies: [], invites: [], gigs: [], hqIp: 0, hqLog: [] };

describe('crewCard', () => {
    it('shows the logo as a thumbnail', () => {
        const [first] = crewCard(crew, () => '', 'https://board', 'attachment://logo.webp');
        assert.deepEqual(first.embeds[0].thumbnail, { url: 'attachment://logo.webp' });
    });

    it('has no thumbnail without a logo', () => {
        const [first] = crewCard(crew, () => '', 'https://board', null);
        assert.equal(first.embeds[0].thumbnail, undefined);
    });
});
