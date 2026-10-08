import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildDrawingRevisionSymbol, transformDrawingRevisionSymbol } from './drawingRevisionSymbols.js';
import { curvePointAt } from './drawingCurveKernel.js';
const rectangle = { type: 'polyline', closed: true, points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 2 }, { x: 0, y: 2 }] };
const make = revisionSymbol => rebuildDrawingRevisionSymbol({ id: 'revision', layerId: 'geometry', revisionSymbol });

test('cloud conversion retains closed exact arc joins and controllable scallop length/direction', () => {
    const cloud = make({ kind: 'cloud', source: rectangle, arcLength: 1 });
    assert.equal(cloud.parts.length, 12);
    cloud.parts.forEach((part, index) => {
        const end = curvePointAt(part, 1); const next = curvePointAt(cloud.parts[(index + 1) % cloud.parts.length], 0);
        assert.ok(Math.hypot(end.x - next.x, end.y - next.y) < 1e-8);
    });
    assert.ok(curvePointAt(cloud.parts[0], 0.5).y < 0);
    const inward = make({ kind: 'cloud', source: rectangle, arcLength: 1, reverse: true });
    assert.ok(curvePointAt(inward.parts[0], 0.5).y > 0);
    const moved = transformDrawingRevisionSymbol(cloud, { a: 2, b: 0, c: 0, d: 1, e: 10, f: 20 });
    assert.ok(moved);
    assert.equal(moved.revisionSymbol.arcLength, 1);
    assert.ok(Math.abs(curvePointAt(moved.parts[0], 0).x - 10) < 1e-8);
});

test('breakline places an editable zigzag between extended endpoints', () => {
    const symbol = make({ kind: 'break', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, size: 2, extension: 1 });
    assert.equal(symbol.parts.length, 5);
    assert.equal(symbol.parts[0].x1, -1);
    assert.equal(symbol.parts.at(-1).x2, 11);
    assert.equal(symbol.parts[2].y1, -1);
    assert.equal(symbol.parts[2].y2, 1);
    assert.equal(make({ ...symbol.revisionSymbol, size: 20 }), null);
});

test('clouds reject open paths and excessive subdivision atomically', () => {
    assert.equal(make({ kind: 'cloud', source: { ...rectangle, closed: false }, arcLength: 1 }), null);
    assert.equal(make({ kind: 'cloud', source: rectangle, arcLength: 0.00001 }), null);
});

test('revision symbol definitions remain consistent after editor transforms and archive normalization', async () => {
    const { translateEntity, rotateEntity, scaleEntity } = await import('./drawingPrimitives.js');
    const { normalizeDrawingContent } = await import('./drawingDocument.js');
    let cloud = make({ kind: 'cloud', source: rectangle, arcLength: 1 });
    cloud = translateEntity(cloud, 5, 6);
    cloud = rotateEntity(cloud, 90, { x: 0, y: 0 });
    cloud = scaleEntity(cloud, 2, { x: 0, y: 0 });
    const normalized = normalizeDrawingContent({ entities: [cloud] }).entities[0];
    assert.deepEqual(normalized.revisionSymbol, cloud.revisionSymbol);
    const start = curvePointAt(normalized.parts[0], 0);
    assert.ok(Math.abs(start.x + 12) < 1e-8);
    assert.ok(Math.abs(start.y - 10) < 1e-8);
});

test('revision grips edit the retained source through transformed coordinates', async () => {
    const { getEntityGrips, editEntityGrip } = await import('./drawingSelection.js');
    const symbol = transformDrawingRevisionSymbol(make({ kind: 'break', start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, size: 1 }),
        { a: 2, b: 0, c: 0, d: 2, e: 5, f: 6 });
    const grips = getEntityGrips(symbol);
    assert.ok(grips.length >= 2);
    const changed = editEntityGrip(symbol, grips[0].id, { x: 7, y: 6 });
    assert.equal(changed.revisionSymbol.start.x, 1);
    assert.equal(changed.revisionSymbol.end.x, 10);
});

test('cloud vertex grips update both connected source edges and regenerate a closed cloud', async () => {
    const { getEntityGrips, editEntityGrip } = await import('./drawingSelection.js');
    const cloud = make({ kind: 'cloud', source: rectangle, arcLength: 1 });
    const grips = getEntityGrips(cloud);
    const changed = editEntityGrip(cloud, grips[0].id, { x: -1, y: -1 });
    assert.notDeepEqual(changed.parts, cloud.parts);
    assert.ok(changed.revisionSymbol.source.closed);
    assert.equal(changed.revisionSymbol.source.parts[0].x1, -1);
    assert.equal(changed.revisionSymbol.source.parts.at(-1).x2, -1);
});

test('revision source conversion preserves IDs, rejects locked sources and persists both symbol kinds', async () => {
    const { createDrawingRevision, editDrawingRevision } = await import('./drawingRevisionCommands.js');
    const { createLcadDocument, createLcadEnvelope } = await import('./lcadDocument.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } = await import('./drawingClipboard.js');
    const document = createLcadDocument();
    const original = { ...rectangle, id: 'outline', layerId: document.content.activeLayerId };
    document.content.entities = [original];
    const converted = createDrawingRevision(document.content, { kind: 'cloud', arcLength: 1 }, 'outline');
    assert.deepEqual(converted.selectedIds, ['outline']);
    assert.equal(converted.content.entities.length, 1);
    assert.deepEqual(document.content.entities, [original]);
    assert.equal(createDrawingRevision({ ...document.content, entities: [{ ...original, locked: true }] }, { kind: 'cloud', arcLength: 1 }, 'outline').error, 'selection');
    const changed = editDrawingRevision(converted.content, ['outline'], { arcLength: 0.5, reverse: true });
    assert.equal(changed.content.entities[0].parts.length, 24);
    document.content = createDrawingRevision(changed.content, { kind: 'break', start: { x: 0, y: 5 }, end: { x: 10, y: 5 }, size: 1 }).content;
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.entities, document.content.entities);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, document.content.entities.map(entity => entity.id)));
    const pasted = pasteDrawingClipboardPayload({ content: createLcadDocument().content, assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    assert.deepEqual(pasted.content.entities.map(({ id, ...rest }) => rest), document.content.entities.map(({ id, ...rest }) => rest));
});
