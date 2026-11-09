import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hasLiving, LIFESTYLES, LIVING, periodAt, previousPeriod, totals } from './downtime';
import { runnerInput } from './schemas';

describe('periodAt', () => {
    const at = (iso: string) => new Date(iso).getTime();

    it('moves over at noon on the 1st on their own clock', () => {
        assert.equal(periodAt(at('2026-12-01T11:59:00Z'), 'Europe/London'), '2026-11');
        assert.equal(periodAt(at('2026-12-01T12:00:00Z'), 'Europe/London'), '2026-12');
    });

    it('is a different moment in each zone', () => {
        // Noon in Tokyo is 03:00 UTC, noon in Los Angeles (PST) is 20:00 UTC
        const moment = at('2026-12-01T10:00:00Z');
        assert.equal(periodAt(moment, 'Asia/Tokyo'), '2026-12');
        assert.equal(periodAt(moment, 'America/Los_Angeles'), '2026-11');
    });

    it('goes back over New Year', () => {
        assert.equal(periodAt(at('2027-01-01T06:00:00Z'), 'Europe/London'), '2026-12');
        assert.equal(periodAt(at('2027-01-01T12:00:00Z'), 'Europe/London'), '2027-01');
    });

    it('stays put through the rest of the month', () => {
        assert.equal(periodAt(at('2026-11-30T23:00:00Z'), 'Europe/London'), '2026-11');
    });

    it('finds the month before', () => {
        assert.equal(previousPeriod('2026-11'), '2026-10');
        assert.equal(previousPeriod('2027-01'), '2026-12');
    });

    it('sorts in date order as text', () => {
        assert.ok('2026-12' > '2026-11' && '2027-01' > '2026-12');
    });
});

describe('totals', () => {
    it('adds the two tables together', () => {
        assert.deepEqual(totals({ living: 'low-1', lifestyle: 'low', customLiving: null }), { dtMonth: 17, dtGig: 7, due: 1300, humanity: 0 });
        assert.deepEqual(totals({ living: 'high-5', lifestyle: 'upper', customLiving: null }), { dtMonth: 40, dtGig: 16, due: 16500, humanity: 9 });
    });

    it('counts an unset side as nothing', () => {
        assert.deepEqual(totals({ living: null, lifestyle: 'squalid', customLiving: null }), { dtMonth: 1, dtGig: 1, due: 100, humanity: -1 });
        assert.deepEqual(totals({ living: null, lifestyle: null, customLiving: null }), { dtMonth: 0, dtGig: 0, due: 0, humanity: 0 });
    });

    it('uses custom numbers', () => {
        const customLiving = { name: 'Flat share', dtMonth: 21, dtGig: 8, rent: 1333, humanity: 3 };
        assert.deepEqual(totals({ living: 'custom', lifestyle: 'middle', customLiving }), { dtMonth: 27, dtGig: 11, due: 1933, humanity: 3 });
    });

    it('knows when nothing is set', () => {
        assert.equal(hasLiving({ living: null, lifestyle: null, customLiving: null }), false);
        assert.equal(hasLiving({ living: 'custom', lifestyle: null, customLiving: null }), false);
        assert.equal(hasLiving({ living: 'coffin', lifestyle: null, customLiving: null }), true);
    });

    it('has every row of the house tables', () => {
        assert.equal(LIVING.length, 13);
        assert.equal(LIFESTYLES.length, 5);
        assert.equal(new Set(LIVING.map((l) => l.key)).size, 13);
    });
});

describe('custom living limits', () => {
    const base = { handle: 'Vex', role: 'Solo', extraRoles: [], imageId: null, fixerAlias: null, officeLocation: null, specialties: null, contact: null, bio: null, living: 'custom' };
    const custom = (patch: object) => ({ ...base, customLiving: { name: 'Flat', dtMonth: 21, dtGig: 8, rent: 0, humanity: 3, ...patch } });

    it('takes an owned place at no rent', () => {
        assert.ok(runnerInput.safeParse(custom({})).success);
    });

    it("can't beat the best place on the table", () => {
        assert.equal(runnerInput.safeParse(custom({ dtMonth: 29 })).success, false);
        assert.equal(runnerInput.safeParse(custom({ dtGig: 12 })).success, false);
        assert.equal(runnerInput.safeParse(custom({ humanity: 8 })).success, false);
    });

    it('needs its numbers', () => {
        assert.equal(runnerInput.safeParse({ ...base, customLiving: null }).success, false);
    });

    it('refuses a place that does not exist', () => {
        assert.equal(runnerInput.safeParse({ ...base, living: 'penthouse', customLiving: null }).success, false);
    });
});
