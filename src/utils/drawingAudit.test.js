import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument } from './lcadDocument.js';
import { auditDrawingDocument, repairDrawingDocument } from './drawingAudit.js';

test('raw audit identifies geometry, identifier and dependency defects without normalizing them away', () => {
    const document = createLcadDocument();
    document.content.entities = [
        { id: 'a', type: 'line', layerId: 'missing', x1: 0, y1: 0, x2: NaN, y2: 1 },
        { id: 'a', type: 'blockReference', layerId: 'geometry', blockId: 'gone' },
        { id: 'image', type: 'image', layerId: 'geometry', x: 0, y: 0, width: 3, height: 2, assetId: 'missing-image' },
    ];
    const original = structuredClone(document);
    const result = auditDrawingDocument(document);
    assert.equal(result.valid, false);
    for (const code of ['duplicateId', 'missingLayer', 'invalidGeometry', 'missingBlock', 'missingAsset']) assert.ok(result.issues.some(issue => issue.code === code), code);
    assert.deepEqual(document, original);
});

test('audit covers block-local and paper-space entities and broken constraint catalogs', () => {
    const document = createLcadDocument();
    document.content.blocks = [{ id: 'block', entities: [{ id: 'bad', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: -1 }] }];
    document.layouts[0].paperEntities = [{ id: 'paper', type: 'text', layerId: 'missing-paper-layer', x: 0, y: 0, text: 'Keep me' }];
    document.content.geometricConstraints = [{ id: 'gc', type: 'horizontal', refs: [{ entityId: 'gone' }] }];
    const result = auditDrawingDocument(document);
    assert.ok(result.issues.some(issue => issue.path.startsWith('content.blocks[0]') && issue.code === 'invalidGeometry'));
    assert.ok(result.issues.some(issue => issue.path.startsWith('layouts[0]') && issue.code === 'missingLayer'));
    assert.ok(result.issues.some(issue => issue.code === 'invalidGeometricConstraints'));
});

test('healthy empty documents audit cleanly and oversized audits fail without partial success', () => {
    const document = createLcadDocument();
    assert.equal(auditDrawingDocument(document).valid, true);
    document.content.entities = Array.from({ length: 3 }, (_, index) => ({ id: String(index), type: 'point', layerId: 'geometry', x: index, y: 0 }));
    assert.deepEqual(auditDrawingDocument(document, { maxObjects: 2 }), { error: 'limit' });
});


test('repair restores missing layer identities across scopes, retains geometry and reports unresolved defects', () => {
    const document = createLcadDocument();
    document.content.entities = [{ id: 'line', type: 'line', layerId: 'lost', x1: 1, y1: 2, x2: 4, y2: 2 }];
    document.layouts[0].paperEntities = [{ id: 'paper', type: 'text', x: 1, y: 2, text: 'Preserve' }];
    document.content.blocks = [{ id: 'block', entities: [{ id: 'bad', type: 'circle', layerId: 'lost', cx: 0, cy: 0, r: -1 }] }];
    const saved = structuredClone(document);
    const result = repairDrawingDocument(document);
    assert.equal(result.changed, true);
    assert.equal(result.document.content.layers.filter(layer => layer.id === 'lost').length, 1);
    assert.deepEqual(result.document.content.entities, document.content.entities);
    assert.equal(result.document.layouts[0].paperEntities[0].layerId, 'geometry');
    assert.ok(result.issues.some(issue => issue.code === 'invalidGeometry'));
    assert.ok(!result.issues.some(issue => issue.code === 'missingLayer'));
    assert.ok(result.repairs.some(repair => repair.path === 'layouts[0].paperEntities[0]'));
    assert.deepEqual(document, saved);
    assert.equal(repairDrawingDocument(result.document).changed, false);
});

test('raw audit rejects corrupt block transforms and text/image frames across all scopes', () => {
    const document = createLcadDocument();
    const insertion = { type: 'blockReference', blockId: 'cache', layerId: 'geometry' };
    document.content.blocks = [{ id: 'cache', entities: [{ id: 'nested', ...insertion, blockId: 'empty', transform: [1, 0, 0, 1, null, 0] }] }, { id: 'empty', entities: [] }];
    document.content.entities = [
        { id: 'matrix', ...insertion, transform: { a: 1, b: 0, c: 0, d: 1, e: 'bad', f: 0 } },
        { id: 'legacy', ...insertion, scaleX: Infinity },
        { id: 'text', type: 'text', layerId: 'geometry', x: 1, y: 2, text: 'Keep evidence', affineFrame: { a: 0, b: 0, c: 0, d: 0, e: 2, f: 3 } },
    ];
    document.layouts[0].paperEntities = [{ id: 'paper', type: 'image', layerId: 'geometry', x: 0, y: 0, width: 2, height: 2, affineFrame: null }];
    const saved = structuredClone(document);
    const result = auditDrawingDocument(document);
    assert.deepEqual(new Set(result.issues.filter(issue => issue.code === 'invalidGeometry').map(issue => issue.entityId)), new Set(['matrix', 'legacy', 'text', 'nested', 'paper']));
    assert.deepEqual(document, saved);
    assert.equal(repairDrawingDocument(document).issues.filter(issue => issue.code === 'invalidGeometry').length, 5);
});

test('raw audit preserves valid affine, reflected and legacy block representations', () => {
    const document = createLcadDocument();
    document.content.blocks = [{ id: 'cache', entities: [] }];
    document.content.entities = [
        { id: 'default' }, { id: 'legacy', x: 5, y: -3, scaleX: -2, rotation: 30 },
        { id: 'array', transform: [1, 0, 0.5, 2, 3, 4] },
        { id: 'object', transform: { a: -1, b: 0, c: 0, d: 1, e: 0, f: 0 }, x: 'ignored legacy value' },
    ].map(entity => ({ type: 'blockReference', layerId: 'geometry', blockId: 'cache', ...entity }));
    assert.equal(auditDrawingDocument(document).valid, true);
});
