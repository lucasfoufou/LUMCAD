import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent } from './drawingDocument.js';
import { exportDrawingWmf } from './drawingWmfExport.js';
import { readDrawingWmfGraphics } from './drawingWmfGraphics.js';
import { drawingExportItems } from './drawingExportEntities.js';
import { importDrawingWmf } from './drawingWmfImport.js';
import { createLcadDocument } from './lcadDocument.js';
const identity = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const rect = (x, y, width, height) => ({ points: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] });
const line = { id: 'line', type: 'line', layerId: 'geometry', x1: -5, y1: 1, x2: 10, y2: 1 };
function drawing() {
    const content = createDefaultDrawingContent();
    content.blocks = [{ id: 'inner', entities: [line] }, { id: 'outer', entities: [{ id: 'child', type: 'blockReference', layerId: 'geometry',
        blockId: 'inner', transform: { ...identity, e: 2 }, blockClip: rect(0, 0, 3, 3) }] }];
    content.entities = [{ id: 'outer', type: 'blockReference', layerId: 'geometry', blockId: 'outer', transform: { ...identity, e: 10, f: 20 }, blockClip: rect(3, 0, 4, 2), externalReference: { loaded: true } },
        { ...line, id: 'unclipped' }];
    return content;
}

test('WMF nested reference rectangles intersect in world space and restore the following drawing context', () => {
    const content = drawing(); const before = structuredClone(content);
    const items = drawingExportItems(content);
    assert.equal(items[0].clips.length, 2); assert.equal(items[1].clips.length, 0);
    const result = exportDrawingWmf(content);
    const [clipped, plain] = readDrawingWmfGraphics(result.bytes).primitives;
    for (const [key, value] of Object.entries({ minX: 13, maxX: 15, minY: 20, maxY: 22 })) {
        const origin = key.endsWith('X') ? result.report.origin.x : result.report.origin.y;
        assert.ok(Math.abs(clipped.deviceClip[key] + origin - value) <= result.report.coordinateStep);
    }
    assert.equal(plain.deviceClip, undefined); assert.deepEqual(content, before);
});

test('WMF block clips include quarter-turn placement but reject oblique or polygonal boundaries', () => {
    const content = drawing();
    content.entities[0].transform = { a: 0, b: 1, c: -1, d: 0, e: 10, f: 20 };
    const result = exportDrawingWmf(content);
    assert.ok(readDrawingWmfGraphics(result.bytes).primitives[0].deviceClip);
    content.entities[0].transform = { a: 1, b: .3, c: 0, d: 1, e: 10, f: 20 };
    assert.throws(() => exportDrawingWmf(content), /wmfExportUnsupported/);
    content.entities[0].transform = identity;
    content.entities[0].blockClip.points.pop();
    assert.throws(() => exportDrawingWmf(content), /wmfExportUnsupported/);
});

test('disjoint ancestor clips suppress the child without suppressing later objects', () => {
    const content = drawing(); content.entities[0].blockClip = rect(8, 0, 1, 1);
    const result = exportDrawingWmf(content);
    const primitives = readDrawingWmfGraphics(result.bytes).primitives;
    assert.ok(primitives[0].deviceClip.minX > primitives[0].deviceClip.maxX);
    assert.equal(primitives[1].deviceClip, undefined);
    assert.equal(importDrawingWmf(createLcadDocument(), result.bytes).content.entities.length, 1);
});
