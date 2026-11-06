import assert from 'node:assert/strict';
import test from 'node:test';

import {
    formatAppUpdateError,
    INITIAL_APP_UPDATER_STATE,
    isAppUpdaterBusy,
    nextUpdateDownloadProgress,
    reduceAppUpdaterState,
} from './appUpdater.js';
import { createI18nError, createTranslator } from '../i18n/translator.js';

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

test('update failures show native details and preserve localized autosave errors', () => {
    const en = createTranslator('en');
    const fr = createTranslator('fr');
    const details = 'Cross-device link (os error 18)';
    assert.equal(formatAppUpdateError(new Error(details), en), `The update could not be installed: ${details}`);
    assert.equal(formatAppUpdateError(details, fr), `La mise à jour n’a pas pu être installée : ${details}`);
    assert.equal(formatAppUpdateError(null, fr), fr('updater.installFailed'));
    assert.equal(formatAppUpdateError(new Error('  '), en), en('updater.installFailed'));
    const state = reduceAppUpdaterState(INITIAL_APP_UPDATER_STATE, {
        type: 'failed', error: createI18nError('storage.createTemporaryFile'),
    });
    assert.equal(formatAppUpdateError(state.error, fr), fr('storage.createTemporaryFile'));
});
