import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainVoice, starRow, voice } from './voice';

const uploaded = (name: string) => (name === 'star_full' ? '<:star_full_a1b2c3:111>' : name === 'star_empty' ? '<:star_empty_d4e5f6:222>' : '');

describe('stars', () => {
    it('uses the bot\'s emoji, filled first', () => {
        assert.equal(starRow(2, uploaded), '<:star_full_a1b2c3:111><:star_full_a1b2c3:111><:star_empty_d4e5f6:222><:star_empty_d4e5f6:222><:star_empty_d4e5f6:222>');
    });

    it('falls back to standard emoji if they are not uploaded', () => {
        assert.equal(starRow(3, () => ''), '⭐⭐⭐⬛⬛');
    });

    it('always shows five', () => {
        assert.equal([...starRow(0, () => '')].length, 5);
        assert.equal([...starRow(5, () => '')].length, 5);
    });

    it('turns them into text for the web', () => {
        assert.equal(plainVoice(voice.rated(4, uploaded)), 'rating logged: ★★★★☆. change it any time.');
    });

    it('leaves no custom emoji code in web text', () => {
        assert.equal(plainVoice({ text: 'paid <:eb_123456:999> today', tone: 'info' }), 'paid today');
    });

    it('uses standard stars where Discord cannot draw custom emoji', () => {
        assert.equal(voice.rateComment(3), '⭐⭐⭐ saved. Add a note?');
    });
});
