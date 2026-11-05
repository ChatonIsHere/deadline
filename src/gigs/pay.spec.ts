import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { payRange } from '../shared/schemas';

describe('payRange', () => {
    const once = (bonus: number) => ({ bonus, each: false });
    const each = (bonus: number) => ({ bonus, each: true });

    it('is just the primary objective with no secondaries', () => {
        assert.deepEqual(payRange({ pay: 1000, objectives: [] }), { min: 1000, max: 1000, open: false });
    });

    it('adds every completion bonus to the top end', () => {
        assert.deepEqual(payRange({ pay: 1000, objectives: [once(200), once(300)] }), { min: 1000, max: 1500, open: false });
    });

    it('counts a per-each bonus once and leaves the top end open', () => {
        assert.deepEqual(payRange({ pay: 1000, objectives: [each(50)] }), { min: 1000, max: 1050, open: true });
        assert.deepEqual(payRange({ pay: 1000, objectives: [once(200), each(50)] }), { min: 1000, max: 1250, open: true });
    });

    it('ignores objectives without a bonus', () => {
        assert.deepEqual(payRange({ pay: 1000, objectives: [{ bonus: null, each: false }] }), { min: 1000, max: 1000, open: false });
    });
});
