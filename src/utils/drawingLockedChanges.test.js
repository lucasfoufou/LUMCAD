import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import { drawingChangesAffectLockedEntities } from './drawingLockedChanges.js';
import { compareDrawingDocuments } from './drawingComparison.js';
import { importDrawingComparison } from './drawingComparisonImport.js';
import { createDrawingStandards, checkDrawingStandards } from './drawingStandards.js';
import { repairDrawingStandards } from './drawingStandardsRepair.js';
import { applyDimensionStyle } from './drawingDimensionStyles.js';

function fixture() {
    const document = createLcadDocument();
    const child = createAnonymousDrawingBlock([{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 }], { id: 'child' });
    const parent = createAnonymousDrawingBlock([createAnonymousDrawingBlockReference(child, { id: 'nested' })], { id: 'parent' });
    document.content.blocks = [child, parent];
    document.content.entities = [{ ...createAnonymousDrawingBlockReference(parent, { id: 'root' }), locked: true }];
    return document;
}

test('changed shared definitions cannot affect locked nested insertions through comparison import', () => {
    const before = fixture(); const after = structuredClone(before);
    after.content.blocks[0].entities[0].x2 = 5;
    assert.equal(drawingChangesAffectLockedEntities(before, after), true);
    const report = compareDrawingDocuments(before, after);
    assert.equal(importDrawingComparison(before, before, after, report.changes.map((_, index) => index)).error, 'comparisonLocked');
    before.content.entities[0].locked = false;
    assert.equal(drawingChangesAffectLockedEntities(before, after), false);
});

test('paper insertions and locked members of otherwise editable definitions are protected; caches are ignored', () => {
    const before = fixture();
    before.layouts[0].paperEntities = before.content.entities;
    before.content.entities = [];
    const after = structuredClone(before);
    after.content.blocks[0].entities[0].x2 = 4;
    assert.equal(drawingChangesAffectLockedEntities(before, after), true);
    before.layouts[0].paperEntities = []; after.layouts[0].paperEntities = [];
    before.content.blocks[0].entities[0].locked = true;
    assert.equal(drawingChangesAffectLockedEntities(before, after), true);
    const cacheOnly = structuredClone(before);
    cacheOnly.content.blocks[0].bounds = { minX: 999, minY: 0, maxX: 1000, maxY: 1 };
    assert.equal(drawingChangesAffectLockedEntities(before, cacheOnly), false);
});

test('standards dimension repairs refuse a locked parent insertion without partial mutation', () => {
    const document = fixture();
    const style = document.content.dimensionStyles[0];
    const standard = createDrawingStandards(document.content);
    style.textSize = 2;
    document.content.blocks[0].entities = [applyDimensionStyle({ id: 'dimension', type: 'linearDimension', layerId: 'dimensions',
        p1: { x: 0, y: 0 }, p2: { x: 2, y: 0 }, offset: 1 }, style)];
    const report = checkDrawingStandards(document.content, standard);
    const before = structuredClone(document);
    const result = repairDrawingStandards(document, standard, report, [0]);
    assert.equal(result.error, 'standardsLocked');
    assert.equal(result.document, undefined);
    assert.deepEqual(document, before);
});
