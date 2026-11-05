import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { embedSize, LIMITS, packEmbeds, splitText } from './embed-pack';

const lines = (n: number, width = 99) => Array.from({ length: n }, (_, i) => `${i}`.padEnd(width, 'x')).join('\n');

describe('splitText', () => {
    it('splits at line breaks and keeps every line', () => {
        const text = lines(30);
        const pieces = splitText(text, 1024);
        assert.ok(pieces.every((p) => p.length <= 1024));
        assert.equal(pieces.join('\n'), text);
    });

    it('cuts words that have no break', () => {
        assert.deepEqual(splitText('a'.repeat(25), 10), ['a'.repeat(10), 'a'.repeat(10), 'a'.repeat(5)]);
    });
});

describe('packEmbeds', () => {
    it('keeps a small gig in one embed', () => {
        const messages = packEmbeds({ title: 'Job', description: 'Brief' }, [{ name: 'Pay', value: '100' }]);
        assert.equal(messages.length, 1);
        assert.equal(messages[0].length, 1);
    });

    it('splits a long field into "(cont.)" fields', () => {
        const [[embed]] = packEmbeds({ title: 'Job' }, [{ name: 'Crew', value: lines(25) }]);
        assert.deepEqual(
            embed.fields!.map((f) => f.name),
            ['Crew', 'Crew (cont.)', 'Crew (cont.)'],
        );
    });

    it('moves fields to another message when the first is full, and loses nothing', () => {
        const fields = [1, 2, 3].map((i) => ({ name: `Field ${i}`, value: lines(10) }));
        const messages = packEmbeds({ title: 'Job', description: 'b'.repeat(4000) }, fields, { color: 1 });
        assert.ok(messages.length > 1);
        for (const message of messages) {
            assert.ok(message.reduce((sum, e) => sum + embedSize(e), 0) <= LIMITS.total);
            assert.ok(message.length <= LIMITS.embeds);
        }
        const values = messages.flat().flatMap((e) => e.fields ?? []).map((f) => f.value);
        assert.equal(values.join('\n'), fields.map((f) => f.value).join('\n'));
        assert.equal(messages[1][0].color, 1);
    });

    it('starts a new embed after 25 fields', () => {
        const fields = Array.from({ length: 30 }, (_, i) => ({ name: `F${i}`, value: 'v' }));
        const [message] = packEmbeds({ title: 'Job' }, fields);
        assert.deepEqual(message.map((e) => e.fields!.length), [25, 5]);
    });
});
