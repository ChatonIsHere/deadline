import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fromWallTime, heatmap, nightCityDate } from './time';

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

describe('heatmap', () => {
    // Monday 9 Nov 2026, midday
    const NOV = at('2026-11-09T12:00Z');

    it('shows each player on the viewer’s clock', () => {
        // 11:00 Monday in Los Angeles is 19:00 Monday in London
        const cells = heatmap([{ timezone: LA, hours: [11] }], LONDON, NOV);
        assert.deepEqual(cells[19].free, [0]);
        assert.equal(cells.filter((c) => c.free.length).length, 1);
    });

    it('wraps round the end of the week', () => {
        // 01:00 Monday in UTC+2 is 23:00 Sunday in UTC+0
        assert.deepEqual(heatmap([{ timezone: 'Etc/GMT-2', hours: [1] }], 'UTC', NOV)[6 * 24 + 23].free, [0]);
        // 22:00 Sunday in Los Angeles is 06:00 Monday in London
        assert.deepEqual(heatmap([{ timezone: LA, hours: [6 * 24 + 22] }], LONDON, NOV)[6].free, [0]);
    });

    it('follows clock changes coming up in the week, per country', () => {
        // Wednesday 21 Oct: the UK changes on Sunday 25th, the US on Sunday 1 Nov.
        // This Wednesday the gap is 8 hours; by Monday the 26th it's 7.
        const cells = heatmap([{ timezone: LA, hours: [2 * 24 + 11, 11] }], LONDON, at('2026-10-21T12:00Z'));
        assert.deepEqual(cells[2 * 24 + 19].free, [0]);
        assert.deepEqual(cells[18].free, [0]);
        assert.deepEqual(cells[19].free, []);
    });

    it('needs both halves of an hour in a half-hour zone', () => {
        // 19:00 London is 00:30 to 01:30 in Kolkata on Tuesday
        assert.deepEqual(heatmap([{ timezone: KOLKATA, hours: [24] }], LONDON, NOV)[19].free, []);
        assert.deepEqual(heatmap([{ timezone: KOLKATA, hours: [24, 25] }], LONDON, NOV)[19].free, [0]);
    });

    it('marks the hour the viewer’s clocks skip', () => {
        // UK clocks jump from 01:00 to 02:00 on Sunday 28 Mar 2027
        const cells = heatmap([{ timezone: LONDON, hours: Array.from({ length: 168 }, (_, i) => i) }], LONDON, at('2027-03-24T12:00Z'));
        assert.equal(cells[6 * 24 + 1].skipped, true);
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
