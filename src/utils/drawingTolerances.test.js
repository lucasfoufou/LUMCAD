import test from 'node:test';
import assert from 'node:assert/strict';
import { DRAWING_TOLERANCE_SYMBOLS, normalizeDrawingTolerance, rebuildDrawingToleranceEntity } from './drawingTolerances.js';
import { createDrawingTolerance, editDrawingTolerance, parseDrawingTolerance } from './drawingToleranceCommands.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';
import { getEntityBounds } from './drawingGeometry.js';
import { getDrawingTextLayout } from './drawingText.js';
import { translateEntity, rotateEntity, scaleEntity, mirrorEntity } from './drawingPrimitives.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { explodeDrawingEntities } from './drawingCompoundOperations.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } from './drawingClipboard.js';
import { getEntityGrips, editEntityGrip } from './drawingSelection.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const definition = () => parseDrawingTolerance('position 0.02 DIAMETER MATERIAL M DATUM A DATUM B:L PROJECTED 10 IDENTIFIER C');

test('tolerance definitions preserve numeric labels and reject malformed or oversized frames', () => {
    const value = definition();
    assert.equal(value.rows[0].values[0].value, '0.02');
    assert.deepEqual(value.rows[0].datums, [{ label: 'A', material: '' }, { label: 'B', material: 'L' }]);
    assert.equal(value.projectedHeight, '10');
    assert.equal(parseDrawingTolerance('flatness 0,05').rows[0].values[0].value, '0,05');
    for (const source of ['position -1', 'position NaN', 'position 0.1 MATERIAL', 'position 1 MATERIAL X', 'position 1 PROJECTED', 'position 1 PROJECTED 0', 'position 1 IDENTIFIER', 'position 1 DATUM A:B:C', 'position 1 DATUM A DATUM B DATUM C DATUM D', 'position 1 SECOND 2 SECOND 3']) assert.equal(parseDrawingTolerance(source), null, source);
    assert.equal(normalizeDrawingTolerance({ ...value, rows: Array(5).fill(value.rows[0]) }), null);
    assert.equal(normalizeDrawingTolerance({ ...value, transform: { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 } }), null);
    assert.equal(rebuildDrawingToleranceEntity({ id: 'bad', tolerance: { ...value, style: { padding: 1e6 } } }), null);
});

test('all geometric symbols materialize as bounded native vectors with deterministic IDs', () => {
    for (const symbol of DRAWING_TOLERANCE_SYMBOLS) {
        const entity = rebuildDrawingToleranceEntity({ id: 't', layerId: 'geometry', tolerance: parseDrawingTolerance(`${symbol} 0.1`) });
        const glyphs = entity.parts.filter(part => part.id.startsWith('t:frame:0:symbol'));
        assert.ok(glyphs.length, symbol);
        assert.ok(glyphs.every(part => ['line', 'ellipse'].includes(part.type)), symbol);
        assert.ok(getEntityBounds(entity), symbol);
        assert.equal(new Set(entity.parts.map(part => part.id)).size, entity.parts.length);
        assert.deepEqual(rebuildDrawingToleranceEntity(entity), entity);
    }
});

test('diameter, material, projected-zone and datum cells use independent vector/letter geometry', () => {
    const entity = rebuildDrawingToleranceEntity({ id: 't', layerId: 'geometry', tolerance: definition() });
    assert.ok(entity.parts.some(part => part.id.includes(':diameter:') && part.type === 'ellipse'));
    assert.ok(entity.parts.some(part => part.id.includes(':material:') && part.type === 'ellipse'));
    for (const text of ['M', 'L', 'P', '0.02', 'A', 'B', '10', 'C']) assert.ok(entity.parts.some(part => part.type === 'text' && part.text === text), text);
    for (const part of entity.parts.filter(part => part.type === 'text' && part.text)) {
        assert.deepEqual(getDrawingTextLayout(part).lines, [part.text]);
    }
    assert.equal(entity.table, undefined);
    const two = parseDrawingTolerance('position 0.1 SECOND 0.05 MATERIAL L DATUM A perpendicularity 0.2 DATUM B');
    assert.equal(two.rows.length, 2); assert.equal(two.rows[0].values.length, 2);
    assert.ok(rebuildDrawingToleranceEntity({ id: 'two', tolerance: two }));
});

test('frame transforms and origin grips preserve definitions through normalization and archive', () => {
    const created = createDrawingTolerance(createDefaultDrawingContent(), definition(), { x: 10, y: 20 });
    const source = created.content.entities[0];
    let moved = rotateEntity(translateEntity(source, 5, -2), 90, { x: 0, y: 0 });
    assert.deepEqual(moved.tolerance.rows, source.tolerance.rows);
    assert.ok(Math.abs(moved.tolerance.transform.e + 18) < 1e-8);
    assert.ok(Math.abs(moved.tolerance.transform.f - 15) < 1e-8);
    const grip = getEntityGrips(moved)[0]; assert.equal(grip.id, 'tolerance-origin');
    moved = editEntityGrip(moved, grip.id, { x: 1, y: 2 });
    assert.equal(moved.tolerance.transform.e, 1); assert.equal(moved.tolerance.transform.f, 2);
    const content = normalizeDrawingContent({ ...created.content, entities: [moved] });
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope({ ...createLcadDocument(), content }))).document;
    assert.deepEqual(loaded.content.entities[0].tolerance, moved.tolerance);
    assert.deepEqual(loaded.content.entities[0].parts.map(part => part.id), source.parts.map(part => part.id));
});

test('tolerance edits preserve identity and placement and refuse locked targets', () => {
    const original = createDefaultDrawingContent();
    const created = createDrawingTolerance(original, definition(), { x: 10, y: 20 });
    const edited = editDrawingTolerance(created.content, created.selectedIds, parseDrawingTolerance('parallelism 0.5 DATUM A'));
    assert.equal(edited.content.entities[0].id, created.selectedIds[0]);
    assert.deepEqual(edited.content.entities[0].tolerance.transform, created.content.entities[0].tolerance.transform);
    assert.equal(original.entities.length, 0);
    assert.equal(editDrawingTolerance({ ...created.content, entities: [{ ...created.content.entities[0], locked: true }] }, created.selectedIds, definition()).error, 'selection');
    assert.equal(createDrawingTolerance({ ...original, layers: original.layers.map(layer => ({ ...layer, locked: true })) }, definition(), { x: 0, y: 0 }).error, 'layer');
});

test('scaled, reflected and sheared frames retain editable definitions and exact exploded geometry', () => {
    const created = createDrawingTolerance(createDefaultDrawingContent(), definition(), { x: 10, y: 20 });
    const source = created.content.entities[0];
    const scaled = scaleEntity(source, 2, { x: 0, y: 0 });
    assert.equal(scaled.tolerance.transform.e, 20);
    assert.equal(scaled.tolerance.transform.f, 40);
    const reflected = mirrorEntity(scaled, { x: 0, y: 0 }, { x: 1, y: 0 });
    assert.equal(reflected.tolerance.transform.f, -40);
    const sheared = transformDrawingEntityAffine(reflected, { a: 1, b: 0, c: 0.5, d: 1, e: 3, f: 4 });
    assert.deepEqual(sheared.tolerance.rows, source.tolerance.rows);
    assert.equal(sheared.tolerance.transform.e, 3);
    assert.equal(sheared.tolerance.transform.f, -36);
    assert.deepEqual(rebuildDrawingToleranceEntity(sheared), sheared);
    const exploded = explodeDrawingEntities({ ...created.content, entities: [sheared] }, [source.id]);
    assert.equal(exploded.changed, true);
    assert.equal(exploded.content.entities.length, sheared.parts.length);
    assert.ok(exploded.content.entities.every(part => !part.tolerance));
    assert.deepEqual(exploded.content.entities.map(part => part.type), sheared.parts.map(part => part.type));
    const bounds = getEntityBounds(sheared);
    for (const part of exploded.content.entities) {
        const actual = getEntityBounds(part);
        assert.ok(actual.minX >= bounds.minX - 1e-8 && actual.maxX <= bounds.maxX + 1e-8);
        assert.ok(actual.minY >= bounds.minY - 1e-8 && actual.maxY <= bounds.maxY + 1e-8);
    }
});

test('SVG clipboard keeps vector symbols and editable tolerance metadata on paste', () => {
    const document = createLcadDocument();
    const created = createDrawingTolerance(document.content, definition(), { x: 10, y: 20 });
    document.content = created.content;
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, created.selectedIds));
    assert.match(svg, /<path|<ellipse/);
    assert.match(svg, /0\.02/);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    const entity = pasted.content.entities[0];
    assert.deepEqual(entity.tolerance, created.content.entities[0].tolerance);
    assert.notEqual(entity.id, created.selectedIds[0]);
    assert.deepEqual(rebuildDrawingToleranceEntity(entity), entity);
});
