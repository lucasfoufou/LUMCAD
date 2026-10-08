import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLcadRecoveryHistory, createLcadRecoveryHistoryEntry, appendLcadRecoveryHistory, forgetLcadRecoveryHistoryEntry } from './lcadRecoveryHistory.js';
import { parseLcadRecoveryManagerInput } from './lcadRecovery.js';

const record = (id, sourcePath = `/tmp/${id}.lcad`) => createLcadRecoveryHistoryEntry({ ready: true, sourcePath, sourceName: 'Drawing.lcad', report: { quarantine: [{ raw: 'private geometry' }], issues: [], archiveIssues: [] } }, { id, recordedAt: 100 });

test('history retains bounded metadata and never candidate geometry or quarantine payload', () => {
    const entry = record('one');
    assert.equal(entry.quarantined, 1);
    const history = normalizeLcadRecoveryHistory({ version: 1, entries: [{ ...entry, candidate: { secret: true } }] });
    assert.equal(JSON.stringify(history).includes('secret'), false);
    assert.equal(JSON.stringify(history).includes('private geometry'), false);
    assert.deepEqual(JSON.parse(JSON.stringify(history)).entries[0], entry);
});

test('history retains twelve latest records and refreshes a source without duplicating it', () => {
    let history = { version: 1, entries: [] };
    for (let i = 0; i < 15; i++) history = appendLcadRecoveryHistory(history, record(String(i)));
    assert.equal(history.entries.length, 12);
    assert.equal(history.entries.at(-1).id, '3');
    history = appendLcadRecoveryHistory(history, record('new', '/tmp/10.lcad'));
    assert.equal(history.entries[0].id, 'new');
    assert.equal(history.entries.some(entry => entry.id === '10'), false);
    const before = structuredClone(history);
    const removed = forgetLcadRecoveryHistoryEntry(history, 'new');
    assert.equal(removed.entries.length, 11);
    assert.deepEqual(history, before);
});

test('portable sources with equal names retain separate records and Unicode names are byte bounded', () => {
    let history = appendLcadRecoveryHistory({ version: 1, entries: [] }, record('a', null));
    history = appendLcadRecoveryHistory(history, record('b', null));
    assert.equal(history.entries.length, 2);
    const entry = createLcadRecoveryHistoryEntry({ ready: false, sourceName: '😀'.repeat(100) }, { id: 'unicode', recordedAt: 100 });
    assert.equal(new TextEncoder().encode(entry.sourceName).length, 256);
    assert.equal(entry.unresolved, 1);
});

test('history refuses invalid counts, duplicate IDs, controls and inconsistent completion', () => {
    const valid = record('a');
    for (const patch of [{ ready: 2 }, { files: 0 }, { limited: true }, { recordedAt: 0 }, { sourcePath: 'bad\npath' }, { sourceName: 'é'.repeat(129) }]) {
        assert.throws(() => normalizeLcadRecoveryHistory({ version: 1, entries: [{ ...valid, ...patch }] }));
    }
    assert.throws(() => normalizeLcadRecoveryHistory({ version: 1, entries: [valid, valid] }));
});

test('batch history counts unresolved, failed and dependency issues without retaining sources', () => {
    const entry = createLcadRecoveryHistoryEntry({ complete: false, limited: false, entries: [
        { sourcePath: '/tmp/root.lcad', status: 'ready', result: { sourceName: 'Root', report: {} } },
        { status: 'unresolved', result: { report: { issues: [{}] } } },
        { status: 'failed', error: 'missing' },
    ], edges: [{ status: 'cycle' }] }, { batch: true, id: 'batch', recordedAt: 100 });
    assert.deepEqual([entry.files, entry.ready, entry.unresolved, entry.failed, entry.issues], [3, 1, 1, 1, 3]);
});

test('manager history commands enforce bounded one-based record numbers', () => {
    assert.deepEqual(parseLcadRecoveryManagerInput('HISTORY'), { action: 'history' });
    assert.deepEqual(parseLcadRecoveryManagerInput('RETRY 12'), { action: 'retry', index: 11 });
    assert.deepEqual(parseLcadRecoveryManagerInput('REMOVE 1'), { action: 'remove', index: 0 });
    for (const input of ['RETRY 0', 'REMOVE 13', 'REMOVE -1', 'RETRY 1.5']) assert.equal(parseLcadRecoveryManagerInput(input), null);
});
