import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingDimensionExportEntities } from './drawingDimensionExport.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { getDimensionGeometry } from './drawingDimensions.js';
import { presentDrawingDimension } from './drawingDimensionPresentation.js';
import { getDrawingTextLayout } from './drawingText.js';
import { framedDrawingPoint } from './drawingAffineFrame.js';
import { exportDrawingWmf } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
const dimension = { id: 'dim', layerId: 'geometry', type: 'linearDimension', p1: { x: 0, y: 0 },
    p2: { x: 10, y: 0 }, offset: 2, textSize: .4, arrowType: 'closed', color: '#224466', extensionGap: .2, extensionOverrun: .5 };

test('dimension export reuses styled linework and filled arrows without altering measurements', () => {
    const before = structuredClone(dimension);
    const geometry = presentDrawingDimension(getDimensionGeometry(dimension), dimension, dimension.textSize);
    const parts = drawingDimensionExportEntities(dimension, new Map());
    assert.deepEqual(parts.filter(p => p.type === 'line').map(p => [p.x1, p.y1, p.x2, p.y2]),
        geometry.lines.map(l => [l.start.x, l.start.y, l.end.x, l.end.y]));
    assert.equal(parts.filter(p => p.type === 'hatch').length, 2);
    assert.ok(parts.every(p => p.color === dimension.color && p.layerId === dimension.layerId));
    assert.deepEqual(dimension, before);
});

test('dimension export preserves moved/rotated text baseline and reports one source object', () => {
    const entity = { ...dimension, dimensionTextPosition: { x: 8, y: 9 }, dimensionTextAngle: Math.PI / 3 };
    const [text] = drawingDimensionExportEntities(entity, new Map()).filter(p => p.type === 'text');
    const layout = getDrawingTextLayout(text);
    const anchor = framedDrawingPoint(text, { x: layout.textX, y: layout.firstBaseline });
    const offset = -.35 * entity.textSize;
    assert.ok(Math.abs(anchor.x - (8 - Math.sin(Math.PI / 3) * offset)) < 1e-10);
    assert.ok(Math.abs(anchor.y - (9 + Math.cos(Math.PI / 3) * offset)) < 1e-10);
    const content = { ...createDefaultDrawingContent(), entities: [entity] };
    const before = structuredClone(content); const result = exportDrawingWmf(content);
    const primitives = readDrawingWmfGraphics(result.bytes).primitives;
    assert.equal(result.report.exported, 1);
    assert.ok(result.report.warnings.includes('dimensionTextAppearance'));
    assert.equal(primitives.filter(p => p.kind === 'text').length, 1);
    assert.equal(primitives.filter(p => p.kind === 'polypolygon').length, 2);
    assert.deepEqual(content, before);
});

test('center marks export their common geometry without manufacturing a text label', () => {
    const entity = { id: 'center', layerId: 'geometry', type: 'centerMark', sourceId: 'circle', size: 1 };
    const circle = { id: 'circle', layerId: 'geometry', type: 'circle', cx: 2, cy: 3, r: 4 };
    const parts = drawingDimensionExportEntities(entity, new Map([[circle.id, circle]]));
    assert.ok(parts.length > 0); assert.ok(parts.every(p => p.type !== 'text'));
    const result = exportDrawingWmf({ ...createDefaultDrawingContent(), entities: [circle, entity] });
    assert.ok(!result.report.warnings.includes('dimensionTextAppearance'));
});

test('dimension WMF labels follow locale while associative geometry uses its current source', () => {
    const circle = { id: 'circle', type: 'circle', layerId: 'geometry', cx: 2, cy: 3, r: 1.25 };
    const radial = { id: 'radius', type: 'radialDimension', layerId: 'geometry', sourceId: circle.id, angle: 0, textSize: .2 };
    const content = { ...createDefaultDrawingContent(), entities: [circle, radial] };
    const result = exportDrawingWmf(content, { locale: 'fr' });
    const texts = readDrawingWmfGraphics(result.bytes).primitives.filter(p => p.kind === 'text');
    assert.equal(texts.length, 1); assert.match(texts[0].text, /R 1,25 m/);
    circle.r = 2.5;
    const changed = readDrawingWmfGraphics(exportDrawingWmf(content, { locale: 'fr' }).bytes).primitives;
    assert.match(changed.find(p => p.kind === 'text').text, /R 2,5 m/);
});
