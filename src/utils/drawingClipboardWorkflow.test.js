import assert from 'node:assert/strict';
import test from 'node:test';

import { createDrawingClipboardPayload } from './drawingClipboard.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { createDrawingClipboardWorkflow } from './drawingClipboardWorkflow.js';

test('COPYBASE stages a point and writes the selected dependency payload at that base', async () => {
    const harness = workflowHarness();
    let written = null;
    harness.options.clipboardAdapter = {
        async write(payload) { written = payload; },
        async read() { throw new Error('unused'); },
    };
    const workflow = createDrawingClipboardWorkflow(harness.options);
    assert.equal(workflow.beginCopyBase(), true);
    assert.deepEqual(harness.operations[0], { type: 'copyBase', stage: 'base', entityIds: ['line'] });
    assert.equal(await workflow.handleClipboardPoint(harness.operations[0], { x: 9, y: 8 }), true);
    assert.deepEqual(written.basePoint, { x: 9, y: 8 });
    assert.equal(harness.commits.length, 0);
    assert.equal(harness.operations.at(-1), null);
});

test('CUTCLIP commits one deletion only after the adapter write succeeds', async () => {
    const failing = workflowHarness();
    failing.options.clipboardAdapter = {
        async write() { throw Object.assign(new Error('denied'), { drawingClipboardAdapterCode: 'write-permission-denied' }); },
    };
    assert.equal(await createDrawingClipboardWorkflow(failing.options).cutClip(), false);
    assert.equal(failing.commits.length, 0);
    assert.match(failing.messages.at(-1), /write-permission-denied/);

    const passing = workflowHarness();
    passing.options.clipboardAdapter = { async write() {} };
    assert.equal(await createDrawingClipboardWorkflow(passing.options).cutClip(), true);
    assert.equal(passing.commits.length, 1);
    assert.equal(passing.commits[0].entities.length, 0);
    assert.deepEqual(passing.selections.at(-1), []);
});

test('PASTECLIP reads before staging and commits one cross-document merge at the picked point', async () => {
    const source = createDefaultDrawingContent();
    source.layers.push(testLayer('source-layer', 'Source'));
    source.entities = [{ id: 'source-line', type: 'line', layerId: 'source-layer', x1: 10, y1: 10, x2: 12, y2: 10 }];
    const payload = createDrawingClipboardPayload({ content: source, assets: [] }, ['source-line'], {
        basePoint: { x: 10, y: 10 },
    });
    const harness = workflowHarness({ selectedIds: [] });
    harness.options.clipboardAdapter = { async read() { return payload; } };
    const workflow = createDrawingClipboardWorkflow(harness.options);

    assert.equal(await workflow.beginPasteClip(), true);
    const operation = harness.operations.at(-1);
    assert.equal(operation.type, 'pasteClip');
    assert.equal(harness.commits.length, 0);
    assert.equal(await workflow.handleClipboardPoint(operation, { x: 2, y: 3 }), true);
    assert.equal(harness.commits.length, 1);
    const pasted = harness.commits[0].entities.at(-1);
    assert.deepEqual({ x1: pasted.x1, y1: pasted.y1, x2: pasted.x2, y2: pasted.y2 }, {
        x1: 2, y1: 3, x2: 4, y2: 3,
    });
    assert.equal(harness.commits[0].layers.some(layer => layer.name === 'Source'), true);
    assert.deepEqual(harness.selections.at(-1), [pasted.id]);
});

test('PASTEORIG commits immediately without an insertion operation', async () => {
    const source = createDefaultDrawingContent();
    source.entities = [{ id: 'source-line', type: 'line', layerId: 'geometry', x1: 5, y1: 6, x2: 7, y2: 6 }];
    const payload = createDrawingClipboardPayload({ content: source, assets: [] }, ['source-line']);
    const harness = workflowHarness({ selectedIds: [] });
    harness.options.clipboardAdapter = { async read() { return payload; } };
    const workflow = createDrawingClipboardWorkflow(harness.options);

    assert.equal(await workflow.pasteOriginal(), true);
    assert.equal(harness.commits.length, 1);
    const pasted = harness.commits[0].entities.at(-1);
    assert.deepEqual({ x1: pasted.x1, y1: pasted.y1 }, { x1: 5, y1: 6 });
    assert.equal(harness.operations.some(Boolean), false);
});

function workflowHarness({ selectedIds = ['line'] } = {}) {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 }];
    const commits = [];
    const messages = [];
    const operations = [];
    const selections = [];
    const assetUpdates = [];
    return {
        commits,
        messages,
        operations,
        selections,
        assetUpdates,
        options: {
            assets: [],
            canvasRef: { current: { cancel() {} } },
            document: { id: 'target' },
            history: { content, commit(next) { commits.push(next); } },
            selectedIds,
            setActiveTool() {},
            setAssets(next) { assetUpdates.push(next); },
            setInteractiveOperation(next) { operations.push(next); },
            setMessage(next) { messages.push(next); },
            setSelectedIds(next) { selections.push(next); },
            t(key, values) { return values ? `${key}:${JSON.stringify(values)}` : key; },
        },
    };
}

function testLayer(id, name) {
    return { id, name, color: '#172033', lineWeight: 1, lineType: 'continuous', transparency: 0, visible: true, locked: false };
}
