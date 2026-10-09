import test from 'node:test';
import assert from 'node:assert/strict';

import { auditDrawingDocument } from './drawingAudit.js';
import { createDrawingBenchmarkDocument, DRAWING_BENCHMARK_FIXTURES, drawingBenchmarkSectionEntityCount } from './drawingBenchmarkFixtures.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createLcadEnvelope } from './lcadDocument.js';

test('benchmark fixtures reach their target size with a realistic entity mix', () => {
    const document = createDrawingBenchmarkDocument('S');
    const count = document.content.entities.length;
    assert.ok(count >= DRAWING_BENCHMARK_FIXTURES.S);
    assert.ok(count < DRAWING_BENCHMARK_FIXTURES.S + drawingBenchmarkSectionEntityCount());
    const types = new Set(document.content.entities.map(entity => entity.type));
    for (const type of ['rectangle', 'hatch', 'line', 'circle', 'arc', 'polyline', 'text', 'blockReference', 'linearDimension']) {
        assert.ok(types.has(type), type);
    }
    assert.equal(document.content.entities.find(entity => entity.type === 'hatch').sourceIds.length, 1);
});

test('benchmark fixtures are deterministic, audit-clean and survive an archive round trip', () => {
    const first = createDrawingBenchmarkDocument('S');
    const second = createDrawingBenchmarkDocument('S');
    assert.deepEqual(first.content, second.content);
    assert.equal(auditDrawingDocument(first).issues.length, 0);
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(first))).document.content, first.content);
});

test('benchmark fixtures reject unknown sizes', () => {
    assert.throws(() => createDrawingBenchmarkDocument('XXL'));
    assert.ok(createDrawingBenchmarkDocument(10).content.entities.length >= 10);
});

test('audit covers the largest benchmark fixture', () => {
    const document = createDrawingBenchmarkDocument('XL');
    const audit = auditDrawingDocument(document);
    assert.equal(audit.error, undefined);
    assert.equal(audit.issues.length, 0);
});
