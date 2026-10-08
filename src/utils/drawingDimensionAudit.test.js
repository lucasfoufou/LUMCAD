import test from 'node:test';
import assert from 'node:assert/strict';
import { validRawDimensionGeometry } from './drawingDimensionAudit.js';
import { createLcadDocument } from './lcadDocument.js';
import { auditDrawingDocument } from './drawingAudit.js';
import { salvageDrawingDocument } from './drawingRecovery.js';

const variants = [
    ['linearDimension', { p1: { x: 0, y: 0 }, p2: { x: 2, y: 1 }, offset: 0.5 }, { p2: { x: null, y: 1 } }],
    ['radialDimension', { angle: 1, leaderScale: 1.5 }, { leaderScale: -2 }],
    ['angularDimension', { radius: 2 }, { radius: -2 }],
    ['arcLengthDimension', { offset: 0.5 }, { offset: 'wrong' }],
    ['ordinateDimension', { origin: { x: 1, y: 0 }, axis: 'x' }, { origin: { x: Infinity, y: 0 } }],
    ['centerMark', { size: 0.2, extension: 1 }, { size: 0 }],
    ['centerLine', { extension: 1 }, { extension: -1 }],
];

test('all seven dimension types distinguish omitted defaults from corrupt supplied geometry', () => {
    for (const [type, valid, invalid] of variants) {
        assert.equal(validRawDimensionGeometry({ type }), true, type);
        assert.equal(validRawDimensionGeometry({ type, ...valid }), true, type);
        assert.equal(validRawDimensionGeometry({ type, ...valid, ...invalid }), false, type);
    }
    assert.equal(validRawDimensionGeometry({ type: 'linearDimension', measurementMode: 'unknown' }), false);
    assert.equal(validRawDimensionGeometry({ type: 'angularDimension', sourcePickPoints: [{ x: 0, y: NaN }] }), false);
    assert.equal(validRawDimensionGeometry({ type: 'radialDimension', detachedSource: { type: 'circle', cx: 0, cy: 0, r: -1 } }), false);
    assert.equal(validRawDimensionGeometry({ type: 'radialDimension', detachedSource: { type: 'circle', cx: 0, cy: 0, r: 2 } }), true);
});

test('audit and copy salvage preserve corrupt dimension evidence across model, blocks and paper', () => {
    const document = createLcadDocument();
    const good = { id: 'good', type: 'linearDimension', layerId: 'geometry', p1: { x: 0, y: 0 }, p2: { x: 2, y: 1 }, offset: 0.5 };
    const corrupt = variants.map(([type, valid, invalid], index) => ({ id: `bad-${index}`, type, layerId: 'geometry', ...valid, ...invalid }));
    document.content.entities = [good, ...corrupt.slice(0, 3)];
    document.content.blocks = [{ id: 'block', name: 'Block', entities: corrupt.slice(3, 5) }];
    document.layouts[0].paperEntities = corrupt.slice(5);
    const original = structuredClone(document);
    assert.equal(auditDrawingDocument(document).issues.filter(issue => issue.code === 'invalidGeometry').length, 7);
    const result = salvageDrawingDocument(document);
    assert.equal(result.report.valid, true);
    assert.equal(result.report.quarantine.length, 7);
    assert.deepEqual(result.document.content.entities, [good]);
    assert.deepEqual(result.report.quarantine.map(item => item.value), corrupt);
    assert.deepEqual(document, original);
});
