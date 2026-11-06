import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromWallTime, heatmap, nightCityDate, weekHour } from './time';

const at = (iso: string) => Date.parse(iso);
const LONDON = 'Europe/London';
const LA = 'America/Los_Angeles';
const KOLKATA = 'Asia/Kolkata';

describe('fromWallTime', () => {
    it('reads a clock in its own zone', () => {
        assert.equal(fromWallTime({ year: 2026, month: 11, day: 9, hour: 19, minute: 0 }, LONDON), at('2026-11-09T19:00Z'));
        assert.equal(fromWallTime({ year: 2026, month: 11, day: 9, hour: 19, minute: 0 }, LA), at('2026-11-10T03:00Z'));
    });

    it('moves a skipped time an hour on', () => {
        // UK clocks jump from 01:00 to 02:00 on 28 Mar 2027
        assert.equal(fromWallTime({ year: 2027, month: 3, day: 28, hour: 1, minute: 30 }, LONDON), at('2027-03-28T01:30Z'));
    });

    it('takes the first of a time that happens twice', () => {
        assert.equal(fromWallTime({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, LONDON), at('2026-10-25T00:30Z'));
        assert.equal(fromWallTime({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, LA), at('2026-11-01T08:30Z'));
    });
});

describe('weekHour', () => {
    it('is the hour of the week on that zone’s clock', () => {
        const ms = at('2026-11-09T19:00Z'); // a Monday
        assert.equal(weekHour(ms, LONDON), 19);
        assert.equal(weekHour(ms, LA), 11);
        // 00:30 on Tuesday
        assert.equal(weekHour(ms, KOLKATA), 24);
    });
});

describe('heatmap', () => {
    const monday = (day: number, month = 11) => ({ year: 2026, month, day });

    it('shows each player on the viewer’s clock', () => {
        const cells = heatmap([{ timezone: LA, hours: [11] }], monday(9), LONDON);
        assert.deepEqual(cells[19].free, [0]);
        assert.equal(cells.filter((c) => c.free.length).length, 1);
    });

    it('follows the week’s real clock changes', () => {
        // Between the UK and US clock changes the gap is 7 hours, not 8
        const cells = heatmap([{ timezone: LA, hours: [11] }], monday(26, 10), LONDON);
        assert.deepEqual(cells[18].free, [0]);
    });

    it('needs both halves of an hour in a half-hour zone', () => {
        // 19:00 London is 00:30 to 01:30 in Kolkata on Tuesday
        assert.deepEqual(heatmap([{ timezone: KOLKATA, hours: [24] }], monday(9), LONDON)[19].free, []);
        assert.deepEqual(heatmap([{ timezone: KOLKATA, hours: [24, 25] }], monday(9), LONDON)[19].free, [0]);
    });

    it('marks the hour the clocks skip', () => {
        const cells = heatmap([{ timezone: LONDON, hours: Array.from({ length: 168 }, (_, i) => i) }], { year: 2027, month: 3, day: 22 }, LONDON);
        const sunday1am = 6 * 24 + 1;
        assert.equal(cells[sunday1am].skipped, true);
        assert.deepEqual(cells[sunday1am].free, []);
        assert.equal(cells.filter((c) => c.skipped).length, 1);
    });
});

describe('nightCityDate', () => {
    it('is the date in Pacific time, 51 years on', () => {
        // Already the 6th in London, still the 5th in Night City
        assert.equal(nightCityDate(at('2026-11-06T05:00Z')), '05 NOV 2077');
        assert.equal(nightCityDate(at('2026-11-06T09:00Z')), '06 NOV 2077');
    });
});
