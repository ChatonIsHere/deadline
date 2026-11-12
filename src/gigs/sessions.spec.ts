import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { confirmDeadline, type SessionState, sessionWork } from './sessions';

const H = 3_600_000;
const session = 100 * H;

const state = (now: number, patch: Partial<SessionState> = {}): SessionState => ({
    now,
    sessionAt: session,
    reminderHours: 8,
    confirmHours: 48,
    remindedDay: false,
    remindedSoon: false,
    awaiting: [],
    ...patch,
});

describe('confirmDeadline', () => {
    it('gives the full window when there is time', () => {
        assert.equal(confirmDeadline(0, session, 48), 48 * H);
    });

    it('ends an hour before the session', () => {
        assert.equal(confirmDeadline(80 * H, session, 48), session - H);
    });

    it('always allows at least an hour', () => {
        assert.equal(confirmDeadline(session - 30 * 60_000, session, 48), session + 30 * 60_000);
    });
});

describe('sessionWork', () => {
    it('sends the day-of reminder at the set hours before', () => {
        assert.equal(sessionWork(state(session - 9 * H)).remind, null);
        assert.equal(sessionWork(state(session - 8 * H)).remind, 'day');
        assert.equal(sessionWork(state(session - 8 * H, { remindedDay: true })).remind, null);
    });

    it('sends the 30 minute reminder, and skips the day-of one if both are due', () => {
        assert.equal(sessionWork(state(session - 20 * 60_000)).remind, 'soon');
        assert.equal(sessionWork(state(session - 20 * 60_000, { remindedSoon: true })).remind, null);
    });

    it('does nothing once the session has started', () => {
        const work = sessionWork(state(session, { awaiting: [{ userId: 'a', askedAt: 0, nudged: false }] }));
        assert.deepEqual(work, { remind: null, nudge: [], drop: [] });
    });

    it('nudges once with 12 hours left, then drops at the deadline', () => {
        const awaiting = (nudged: boolean) => [{ userId: 'a', askedAt: 0, nudged }];
        assert.deepEqual(sessionWork(state(30 * H, { awaiting: awaiting(false) })).nudge, []);
        assert.deepEqual(sessionWork(state(36 * H, { awaiting: awaiting(false) })).nudge, ['a']);
        assert.deepEqual(sessionWork(state(36 * H, { awaiting: awaiting(true) })).nudge, []);
        assert.deepEqual(sessionWork(state(48 * H, { awaiting: awaiting(true) })).drop, ['a']);
    });

    it("doesn't nudge someone who was only just asked", () => {
        const awaiting = [{ userId: 'a', askedAt: session - 5 * H, nudged: false }];
        assert.deepEqual(sessionWork(state(session - 5 * H + 10 * 60_000, { awaiting })).nudge, []);
    });

    it('only nudges when the confirm window is longer than a day', () => {
        // Asked 20 hours out: 19 hours to answer, so no nudge at any point
        const short = [{ userId: 'a', askedAt: session - 20 * H, nudged: false }];
        for (const left of [12, 6, 2]) assert.deepEqual(sessionWork(state(session - 1 * H - left * H, { awaiting: short })).nudge, []);
        // Asked 31 hours out: 30 hours to answer, nudged with 12 left
        const long = [{ userId: 'a', askedAt: session - 31 * H, nudged: false }];
        assert.deepEqual(sessionWork(state(session - 14 * H, { awaiting: long })).nudge, []);
        assert.deepEqual(sessionWork(state(session - 13 * H, { awaiting: long })).nudge, ['a']);
    });
});
