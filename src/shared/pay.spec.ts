import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { splitPot } from './pay';

describe('splitPot', () => {
    it('divides evenly when it can', () => {
        assert.deepEqual(splitPot(600, 6), [100, 100, 100, 100, 100, 100]);
    });

    it('gives what is left over to the front of the list', () => {
        assert.deepEqual(splitPot(605, 6), [101, 101, 101, 101, 101, 100]);
    });

    it('never pays out more or less than the pot', () => {
        assert.equal(splitPot(1001, 7).reduce((a, b) => a + b, 0), 1001);
    });

    it('copes with a pot smaller than the crew and with nobody on the gig', () => {
        assert.deepEqual(splitPot(2, 4), [1, 1, 0, 0]);
        assert.deepEqual(splitPot(500, 0), []);
    });
});
