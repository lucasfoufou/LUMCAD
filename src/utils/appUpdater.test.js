import assert from 'node:assert/strict';
import test from 'node:test';

import {
    INITIAL_APP_UPDATER_STATE,
    isAppUpdaterBusy,
    nextUpdateDownloadProgress,
    reduceAppUpdaterState,
} from './appUpdater.js';

test('application updater state keeps one explicit lifecycle', () => {
    let state = reduceAppUpdaterState(INITIAL_APP_UPDATER_STATE, { type: 'check-started' });
    assert.equal(state.phase, 'checking');
    state = reduceAppUpdaterState(state, { type: 'update-available', version: '0.2.0' });
    assert.deepEqual(state, {
        phase: 'available',
        version: '0.2.0',
        progress: null,
        error: null,
    });
    state = reduceAppUpdaterState(state, { type: 'download-started' });
    assert.equal(isAppUpdaterBusy(state), true);
    state = reduceAppUpdaterState(state, { type: 'install-started' });
    assert.equal(state.phase, 'installing');
    state = reduceAppUpdaterState(state, { type: 'failed', error: new Error('offline') });
    assert.equal(state.phase, 'error');
    assert.equal(state.version, '0.2.0');
    assert.equal(state.error, 'offline');
    assert.equal(isAppUpdaterBusy(state), false);
});

test('download progress handles known, unknown and excessive content lengths', () => {
    let progress = nextUpdateDownloadProgress(null, {
        event: 'Started',
        data: { contentLength: 1_000 },
    });
    progress = nextUpdateDownloadProgress(progress, {
        event: 'Progress',
        data: { chunkLength: 405 },
    });
    assert.deepEqual(progress, {
        downloaded: 405,
        total: 1_000,
        percent: 41,
        finished: false,
    });
    progress = nextUpdateDownloadProgress(progress, {
        event: 'Progress',
        data: { chunkLength: 900 },
    });
    assert.equal(progress.percent, 100);
    assert.equal(nextUpdateDownloadProgress(progress, { event: 'Finished' }).finished, true);

    const unknown = nextUpdateDownloadProgress(null, {
        event: 'Started',
        data: { contentLength: undefined },
    });
    assert.equal(unknown.total, null);
    assert.equal(nextUpdateDownloadProgress(unknown, {
        event: 'Progress',
        data: { chunkLength: 12 },
    }).percent, null);
});

test('no available update resets stale progress and errors', () => {
    const state = reduceAppUpdaterState({
        phase: 'error',
        version: '0.2.0',
        progress: { percent: 50 },
        error: 'failed',
    }, { type: 'no-update' });
    assert.deepEqual(state, INITIAL_APP_UPDATER_STATE);
});
