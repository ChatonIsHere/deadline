import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupSlots } from '../shared/slots';
import { diffSlots, fillFromReserves, pickSlot, shiftToCrewSlots, Slot } from './slots';

const slot = (id: string, crewId: string | null, userId: string | null = null): Slot => ({ id, crewId, userId });

describe('pickSlot', () => {
    it('prefers a crew slot over an open one', () => {
        const slots = [slot('s1', null), slot('s2', 'moxes')];
        assert.equal(pickSlot(slots, ['moxes'])?.id, 's2');
    });

    it('checks every crew the runner is in', () => {
        const slots = [slot('s1', 'wolves', 'a'), slot('s2', 'moxes')];
        assert.equal(pickSlot(slots, ['wolves', 'moxes'])?.id, 's2');
    });

    it('falls back to an open slot when crew slots are full', () => {
        const slots = [slot('s1', 'moxes', 'a'), slot('s2', null)];
        assert.equal(pickSlot(slots, ['moxes'])?.id, 's2');
    });

    it("won't put a runner in another crew's slot", () => {
        assert.equal(pickSlot([slot('s1', 'moxes')], ['wolves']), null);
        assert.equal(pickSlot([slot('s1', 'moxes')], []), null);
    });

    it('returns null when everything is taken', () => {
        assert.equal(pickSlot([slot('s1', null, 'a')], []), null);
    });
});

describe('diffSlots', () => {
    it('adds slots for a new gig', () => {
        const changes = diffSlots([], [{ crewId: 'moxes', count: 2 }, { crewId: null, count: 1 }]);
        assert.deepEqual(changes, { add: ['moxes', 'moxes', null], remove: [] });
    });

    it('merges groups for the same crew', () => {
        const changes = diffSlots([], [{ crewId: null, count: 1 }, { crewId: null, count: 2 }]);
        assert.deepEqual(changes.add, [null, null, null]);
    });

    it('removes empty slots when shrinking', () => {
        const existing = [slot('s1', null, 'a'), slot('s2', null), slot('s3', null)];
        assert.deepEqual(diffSlots(existing, [{ crewId: null, count: 2 }]), { add: [], remove: ['s2'] });
    });

    it('removes a dropped crew entirely', () => {
        const existing = [slot('s1', 'moxes'), slot('s2', null)];
        assert.deepEqual(diffSlots(existing, [{ crewId: null, count: 1 }]), { add: [], remove: ['s1'] });
    });

    it('refuses to drop taken slots', () => {
        const existing = [slot('s1', 'moxes', 'a'), slot('s2', 'moxes', 'b')];
        assert.throws(() => diffSlots(existing, [{ crewId: 'moxes', count: 1 }]), /already taken/);
    });

    it('leaves matching slots alone', () => {
        const existing = [slot('s1', 'moxes', 'a'), slot('s2', null)];
        assert.deepEqual(diffSlots(existing, [{ crewId: 'moxes', count: 1 }, { crewId: null, count: 1 }]), { add: [], remove: [] });
    });
});

describe('groupSlots', () => {
    it('puts crew groups before open slots', () => {
        const groups = groupSlots([
            { crew: null },
            { crew: { id: 'moxes', name: 'Moxes' } },
            { crew: { id: 'moxes', name: 'Moxes' } },
        ]);
        assert.deepEqual(
            groups.map((g) => [g.crew?.name ?? 'open', g.slots.length]),
            [['Moxes', 2], ['open', 1]],
        );
    });
});

describe('fillFromReserves', () => {
    it('moves the oldest reserve into a free slot', () => {
        const moves = fillFromReserves([slot('s1', null, 'a'), slot('s2', null)], [
            { userId: 'b', crewIds: [] },
            { userId: 'c', crewIds: [] },
        ]);
        assert.deepEqual(moves, [{ slotId: 's2', userId: 'b' }]);
    });

    it('only gives crew slots to that crew', () => {
        const moves = fillFromReserves([slot('s1', 'moxes')], [
            { userId: 'b', crewIds: [] },
            { userId: 'c', crewIds: ['moxes'] },
        ]);
        assert.deepEqual(moves, [{ slotId: 's1', userId: 'c' }]);
    });

    it('fills crew slots before open ones', () => {
        const moves = fillFromReserves([slot('s1', null), slot('s2', 'moxes')], [
            { userId: 'c', crewIds: ['moxes'] },
            { userId: 'b', crewIds: [] },
        ]);
        assert.deepEqual(moves, [
            { slotId: 's2', userId: 'c' },
            { slotId: 's1', userId: 'b' },
        ]);
    });

    it('leaves slots empty when no reserve fits', () => {
        assert.deepEqual(fillFromReserves([slot('s1', 'moxes')], [{ userId: 'b', crewIds: [] }]), []);
    });
});

describe('shiftToCrewSlots', () => {
    const member = (id: string, crewId: string | null, userId: string | null, crewIds: string[] = []) => ({ ...slot(id, crewId, userId), crewIds });

    it('moves a crew member from an open slot to their crew slot', () => {
        const slots = [member('s1', 'moxes', null), member('s2', null, 'a', ['moxes'])];
        assert.deepEqual(shiftToCrewSlots(slots), [{ from: 's2', to: 's1' }]);
    });

    it('leaves runners outside the crew where they are', () => {
        assert.deepEqual(shiftToCrewSlots([member('s1', 'moxes', null), member('s2', null, 'a', ['wolves'])]), []);
    });

    it('moves one member per empty crew slot', () => {
        const slots = [member('s1', 'moxes', null), member('s2', null, 'a', ['moxes']), member('s3', null, 'b', ['moxes'])];
        assert.deepEqual(shiftToCrewSlots(slots), [{ from: 's2', to: 's1' }]);
    });
});
