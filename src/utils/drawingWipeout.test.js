import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingWipeout, drawingWipeoutFromSources, isDrawingWipeout } from './drawingWipeout.js';
import { translateEntity, rotateEntity } from './drawingGeometry.js';
import { createSelectionWindow, entityMatchesSelectionWindow, editEntityGrip } from './drawingSelection.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';

const points = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 6 }, { x: 0, y: 6 }];
const mask = () => createDrawingWipeout(points, 'geometry', 'mask');

test('masks require simple closed straight geometry and keep native point paths', () => {
    assert.ok(isDrawingWipeout(mask()));
    assert.equal(createDrawingWipeout([points[0], points[2], points[1], points[3]], 'geometry', 'bad'), null);
    assert.equal(createDrawingWipeout(points.slice(0, 2), 'geometry', 'open'), null);
    assert.deepEqual(createDrawingWipeout([...points, points[0]], 'geometry', 'mask'), mask());
    const rectangle = { id: 'source', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 8, height: 6 };
    assert.deepEqual(drawingWipeoutFromSources([rectangle], 'geometry', 'mask'), mask());
    assert.equal(drawingWipeoutFromSources([{ type: 'circle', cx: 0, cy: 0, r: 2 }], 'geometry', 'curved'), null);
});

test('masks transform with their frame, select by interior and reject self-crossing grip edits', () => {
    const source = mask();
    const moved = translateEntity(source, 3, 2);
    assert.deepEqual(moved.points[0], { x: 3, y: 2 });
    assert.ok(isDrawingWipeout(rotateEntity(source, 37, { x: 0, y: 0 })));
    assert.equal(entityMatchesSelectionWindow(source, createSelectionWindow({ x: 2, y: 2 }, { x: 3, y: 3 })), true);
    assert.equal(editEntityGrip(source, 'vertex-1', { x: -2, y: 4 }), source);
    assert.deepEqual(editEntityGrip(source, 'vertex-1', { x: 9, y: 0 }).points[1], { x: 9, y: 0 });
});

test('mask semantics, invisible frames and entity order survive clipboard and archive', () => {
    const document = createLcadDocument({ name: 'Masks' });
    document.content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: [{ ...mask(), wipeout: { frame: false } }] });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content, document.content);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, ['mask']));
    assert.match(svg, /fill="#ffffff" stroke="none"/);
    const invalid = normalizeDrawingContent({ ...document.content, entities: [{ ...mask(), closed: false }] });
    assert.equal(invalid.entities[0].wipeout, undefined);
});
