import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageClip, parseImageClipInput, getImageClipPoints } from './drawingImageClip.js';
import { getEntityBounds, getEntitySegments, translateEntity, rotateEntity } from './drawingGeometry.js';
import { createSelectionWindow, entityMatchesSelectionWindow } from './drawingSelection.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';

const image = { id: 'image', type: 'image', layerId: 'references', x: 0, y: 0, width: 10, height: 8,
    ...parseImageClipInput('RECT 0.2 0.25 0.8 0.75') };

test('clip parser supports reversible disable and rejects invalid or self-crossing contours', () => {
    assert.equal(image.imageClip.points.length, 4);
    const disabled = parseImageClipInput('OFF', image.imageClip);
    assert.deepEqual(disabled.imageClip.points, image.imageClip.points);
    assert.equal(getImageClipPoints({ ...image, ...disabled }), null);
    assert.equal(parseImageClipInput('ON', disabled.imageClip).imageClip.enabled, true);
    assert.deepEqual(parseImageClipInput('DELETE'), { imageClip: undefined });
    for (const input of ['RECT 0 0 0 1', 'RECT -1 0 1 1', 'POLYGON 0 0 1 1 0 1 1 0', 'POLYGON 0 0 1 0', 'RECT 0 0 NaN 1']) assert.equal(parseImageClipInput(input), null, input);
    assert.equal(normalizeImageClip({ points: Array.from({ length: 129 }, () => ({ x: 0, y: 0 })) }), null);
});

test('image clip bounds, selection and snapping segments follow visible transformed geometry', () => {
    assert.deepEqual(getEntityBounds(image), { minX: 2, minY: 2, maxX: 8, maxY: 6 });
    assert.equal(getEntitySegments(image).length, 4);
    assert.equal(entityMatchesSelectionWindow(image, createSelectionWindow({ x: 0.1, y: 0.1 }, { x: 1, y: 1 })), false);
    assert.equal(entityMatchesSelectionWindow(image, createSelectionWindow({ x: 3, y: 3 }, { x: 4, y: 4 })), true);
    const moved = translateEntity(image, 10, 20);
    assert.deepEqual(getEntityBounds(moved), { minX: 12, minY: 22, maxX: 18, maxY: 26 });
    const rotated = rotateEntity(image, 90, { x: 5, y: 4 });
    const bounds = getEntityBounds(rotated);
    assert.ok(Math.abs(bounds.minX - 3) < 1e-8 && Math.abs(bounds.maxY - 7) < 1e-8);
    assert.deepEqual(rotated.imageClip, image.imageClip);
    const triangle = { ...image, ...parseImageClipInput('POLYGON 0 0 1 0 0 1') };
    assert.equal(entityMatchesSelectionWindow(triangle, createSelectionWindow({ x: 8, y: 6 }, { x: 9, y: 7 })), false);
});

test('archive and clipboard keep crop definitions and emit SVG clip geometry', () => {
    const document = createLcadDocument({ name: 'Cropped image' });
    document.content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: [{ ...image, link: 'data:image/png;base64,AA==' }] });
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content, document.content);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, ['image']));
    assert.match(svg, /<clipPath/);
    assert.match(svg, /clip-path="url\(#clipboard-image-/);
    assert.match(svg, /2,2 8,2 8,6 2,6/);
});
