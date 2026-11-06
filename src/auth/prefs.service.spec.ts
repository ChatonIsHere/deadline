import { emptyDb, prisma } from '../test-db';
import assert from 'node:assert/strict';
import { after, beforeEach, describe, it } from 'node:test';
import { availabilityInput } from '../shared/schemas';
import { PrefsService } from './prefs.service';

describe('PrefsService', () => {
    let prefs: PrefsService;

    beforeEach(async () => {
        await emptyDb();
        prefs = new PrefsService(prisma);
    });

    after(() => prisma.$disconnect());

    it('needs a runner before setup ends, unless an admin', async () => {
        await assert.rejects(prefs.finishSetup('a', false, { timezone: 'Europe/London', reminders: true }), /Make a runner first/);
        assert.equal(await prefs.setUp('a'), false);

        await prisma.runner.create({ data: { handle: 'Vex', slug: 'vex', role: 'Solo', ownerId: 'a' } });
        await prefs.finishSetup('a', false, { timezone: 'Europe/London', reminders: false });
        assert.equal(await prefs.setUp('a'), true);
        assert.deepEqual(await prefs.get('a'), { reminders: false, playerView: false, timezone: 'Europe/London' });

        await prefs.finishSetup('admin', true, { timezone: 'America/New_York', reminders: true });
        assert.equal(await prefs.setUp('admin'), true);
    });

    it('changes only the prefs given', async () => {
        await prefs.set('a', { timezone: 'Asia/Tokyo' });
        await prefs.set('a', { reminders: false });
        assert.deepEqual(await prefs.get('a'), { reminders: false, playerView: false, timezone: 'Asia/Tokyo' });
    });

    it('keeps availability as sorted, unique hours', async () => {
        const { hours } = availabilityInput.parse({ hours: [20, 19, 19, 167, 0] });
        await prefs.setAvailability('a', hours);
        assert.deepEqual(await prefs.availability('a'), { timezone: null, hours: [0, 19, 20, 167] });
        assert.equal(availabilityInput.safeParse({ hours: [168] }).success, false);
    });
});
