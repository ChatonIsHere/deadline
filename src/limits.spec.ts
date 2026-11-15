import './test-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { until, Window } from './limits';

describe('limits', () => {
    it('counts hits in a sliding window', () => {
        const w = new Window(60_000);
        assert.equal(w.hit('a', 0), 0);
        assert.equal(w.hit('a', 10_000), 1);
        assert.equal(w.hit('b', 10_000), 0);
        assert.equal(w.count('a', 59_999), 2);
        // The first hit has dropped out
        assert.equal(w.hit('a', 60_001), 1);
    });

    it('says how long is left', () => {
        assert.equal(until(30_000, 0), 'in 1 minute');
        assert.equal(until(25 * 60_000, 0), 'in 25 minutes');
        assert.equal(until(5 * 3_600_000, 0), 'in 5 hours');
        assert.equal(until(7 * 86_400_000, 0), 'in 7 days');
    });
});
