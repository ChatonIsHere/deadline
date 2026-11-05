import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { groupSlots } from '../shared/slots';
import { diffSlots, pickSlot, Slot } from './slots';

const slot = (id: number, crewId: number | null, userId: string | null = null): Slot => ({ id, crewId, userId });

describe('pickSlot', () => {
    it('prefers a crew slot over an open one', () => {
        const slots = [slot(1, null), slot(2, 7)];
        assert.equal(pickSlot(slots, [7])?.id, 2);
    });

    it('checks every crew the runner is in', () => {
        const slots = [slot(1, 3, 'a'), slot(2, 9)];
        assert.equal(pickSlot(slots, [3, 9])?.id, 2);
    });

    it('falls back to an open slot when crew slots are full', () => {
        const slots = [slot(1, 7, 'a'), slot(2, null)];
        assert.equal(pickSlot(slots, [7])?.id, 2);
    });

    it("won't put a runner in another crew's slot", () => {
        assert.equal(pickSlot([slot(1, 7)], [8]), null);
        assert.equal(pickSlot([slot(1, 7)], []), null);
    });

    it('returns null when everything is taken', () => {
        assert.equal(pickSlot([slot(1, null, 'a')], []), null);
    });
});

describe('diffSlots', () => {
    it('adds slots for a new gig', () => {
        const changes = diffSlots([], [{ crewId: 7, count: 2 }, { crewId: null, count: 1 }]);
        assert.deepEqual(changes, { add: [7, 7, null], remove: [] });
    });

    it('merges groups for the same crew', () => {
        const changes = diffSlots([], [{ crewId: null, count: 1 }, { crewId: null, count: 2 }]);
        assert.deepEqual(changes.add, [null, null, null]);
    });

    it('removes empty slots when shrinking', () => {
        const existing = [slot(1, null, 'a'), slot(2, null), slot(3, null)];
        assert.deepEqual(diffSlots(existing, [{ crewId: null, count: 2 }]), { add: [], remove: [2] });
    });

    it('removes a dropped crew entirely', () => {
        const existing = [slot(1, 7), slot(2, null)];
        assert.deepEqual(diffSlots(existing, [{ crewId: null, count: 1 }]), { add: [], remove: [1] });
    });

    it('refuses to drop taken slots', () => {
        const existing = [slot(1, 7, 'a'), slot(2, 7, 'b')];
        assert.throws(() => diffSlots(existing, [{ crewId: 7, count: 1 }]), /already taken/);
    });

    it('leaves matching slots alone', () => {
        const existing = [slot(1, 7, 'a'), slot(2, null)];
        assert.deepEqual(diffSlots(existing, [{ crewId: 7, count: 1 }, { crewId: null, count: 1 }]), { add: [], remove: [] });
    });
});

describe('groupSlots', () => {
    it('puts crew groups before open slots', () => {
        const groups = groupSlots([
            { id: 1, crew: null },
            { id: 2, crew: { id: 7, name: 'Moxes' } },
            { id: 3, crew: { id: 7, name: 'Moxes' } },
        ]);
        assert.deepEqual(
            groups.map((g) => [g.crew?.name ?? 'open', g.slots.length]),
            [['Moxes', 2], ['open', 1]],
        );
    });
});
