import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingRegion } from './drawingRegions.js';
import { getEntityBounds, translateEntity, rotateEntity } from './drawingGeometry.js';
import { extractEntityPaths } from './drawingCurveKernel.js';
import { createSelectionWindow, entityMatchesSelectionWindow, getEntityGrips, editEntityGrip } from './drawingSelection.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { explodeDrawingEntities } from './drawingCompoundOperations.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingHatch } from './drawingHatches.js';

const sources = [
    { id: 'outer', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 10, height: 8 },
    { id: 'hole', type: 'circle', layerId: 'geometry', cx: 4, cy: 4, r: 1 },
];
const region = () => createDrawingRegion(sources, 'geometry', 'area');

test('regions preserve native loops as an independent area and accept interior picks', () => {
    const area = region();
    assert.equal(area.type, 'region');
    assert.equal(area.boundaries.length, 2);
    assert.equal(area.pattern, undefined);
    assert.equal(area.sourceIds, undefined);
    assert.equal(extractEntityPaths(area).length, 2);
    assert.equal(area.boundaries[1].parts[0].type, 'circle');
    const picked = createDrawingRegion(sources, 'geometry', 'picked', { x: 1, y: 1 });
    assert.equal(picked.boundaries.length, 2);
    assert.equal(createDrawingRegion(sources, 'geometry', 'outside', { x: 20, y: 20 }), null);
    assert.equal(createDrawingRegion([{ type: 'line', x1: 0, y1: 0, x2: 1, y2: 1 }], 'geometry', 'open'), null);
    assert.equal(createDrawingHatch([area], 'geometry', { name: 'solid' }, 'fill').boundaries.length, 2);
});

test('region selection respects holes and its single grip moves every loop together', () => {
    const area = region();
    assert.equal(entityMatchesSelectionWindow(area, createSelectionWindow({ x: 1, y: 1 }, { x: 2, y: 2 })), true);
    assert.equal(entityMatchesSelectionWindow(area, createSelectionWindow({ x: 3.8, y: 3.8 }, { x: 4.2, y: 4.2 })), false);
    assert.deepEqual(getEntityGrips(area), [{ id: 'region-origin', x: 5, y: 4 }]);
    const moved = editEntityGrip(area, 'region-origin', { x: 15, y: 14 });
    assert.deepEqual(moved, translateEntity(area, 10, 10));
    assert.deepEqual(getEntityBounds(moved), { minX: 10, minY: 10, maxX: 20, maxY: 18 });
    const rotated = rotateEntity(area, 90, { x: 0, y: 0 });
    assert.equal(rotated.type, 'region');
    assert.equal(rotated.boundaries.length, 2);
    assert.equal(rotated.pattern, undefined);
});

test('regions persist, copy as one object, render closed SVG paths and explode to native curves', () => {
    const content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: [region()] });
    const document = createLcadDocument({ name: 'Regions' });
    document.content = content;
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content, content);
    const payload = createDrawingClipboardPayload({ content }, ['area']);
    const svg = drawingClipboardPayloadToSvg(payload);
    assert.match(svg, /<path d="M/);
    assert.match(svg, /fill-rule="evenodd"/);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, payload, { point: { x: 20, y: 20 } });
    assert.equal(pasted.content.entities.length, 1);
    assert.equal(pasted.content.entities[0].type, 'region');
    assert.equal(pasted.content.entities[0].boundaries.length, 2);
    const exploded = explodeDrawingEntities(content, ['area']);
    assert.equal(exploded.entities.length, 5);
    assert.equal(exploded.entities.filter(entity => entity.type === 'circle').length, 1);
});
