import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fitPages, pageNumbers } from './pages';

describe('fitPages', () => {
    it('puts everything on one page when it fits', () => {
        assert.deepEqual(fitPages([100, 100, 100, 100], 2, 10, 210), [0]);
    });

    it('starts a new page when the next row would not fit', () => {
        assert.deepEqual(fitPages([100, 100, 100, 100, 100, 100], 2, 10, 210), [0, 4]);
    });

    it('counts a row as tall as its tallest card', () => {
        assert.deepEqual(fitPages([100, 150, 100, 100], 2, 10, 210), [0, 2]);
    });

    it('gives a row that is too tall a page of its own', () => {
        assert.deepEqual(fitPages([500, 100], 1, 10, 200), [0, 1]);
    });
});

describe('pageNumbers', () => {
    it('shows every page when there are few', () => {
        assert.deepEqual(pageNumbers(0, 3), [0, 1, 2]);
    });

    it('leaves gaps around the current page', () => {
        assert.deepEqual(pageNumbers(5, 10), [0, null, 4, 5, 6, null, 9]);
    });
});
