import '../test-env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CacheService, MemoryStore } from './cache.service';

describe('CacheService', () => {
    it('keeps values until they expire', async () => {
        const cache = new CacheService(new MemoryStore());
        await cache.set('sess:a', { userId: '1' }, 60);
        assert.deepEqual(await cache.get('sess:a'), { userId: '1' });
        await cache.set('sess:b', { userId: '2' }, -1);
        assert.equal(await cache.get('sess:b'), null);
    });

    it('forgets on request, so a changed player view or role shows straight away', async () => {
        const cache = new CacheService(new MemoryStore());
        await cache.set('me:1', { me: { isAdmin: true } }, 60);
        await cache.del('me:1');
        assert.equal(await cache.get('me:1'), null);
    });

    it('loads once and remembers', async () => {
        const cache = new CacheService(new MemoryStore());
        let loads = 0;
        const load = async () => ++loads;
        assert.equal(await cache.remember('k', 60, load), 1);
        assert.equal(await cache.remember('k', 60, load), 1);
        assert.equal(loads, 1);
    });
});
