import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainText, previewTags } from './tags';

const preview = { title: 'A', description: 'B', image: 'https://x/i.png', url: 'https://x/' };

describe('previewTags', () => {
    it('escapes what players wrote, so a name cannot break out of the tag', () => {
        const tags = previewTags({ ...preview, title: `"><script>alert('x')</script>` });
        assert.ok(!tags.includes('<script>'));
        assert.ok(tags.includes('content="&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;"'));
    });

    it('asks for a large picture only when told to', () => {
        assert.ok(previewTags(preview).includes('content="summary"'));
        assert.ok(previewTags({ ...preview, large: true }).includes('content="summary_large_image"'));
    });
});

describe('plainText', () => {
    it('takes the markdown out', () => {
        assert.equal(plainText('## Job\n\n- **Get** the [case](https://x) to _Lucky_\n> ~~now~~ `soon`', 200), 'Job Get the case to Lucky now soon');
    });

    it('leaves underscores inside words alone', () => {
        assert.equal(plainText('find snake_case_guy', 200), 'find snake_case_guy');
    });

    it('cuts at a word', () => {
        assert.equal(plainText('one two three four', 11), 'one two...');
    });

    it('leaves short text whole', () => {
        assert.equal(plainText('one two', 7), 'one two');
    });
});
