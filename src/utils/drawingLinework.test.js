import test from 'node:test';
import assert from 'node:assert/strict';
import { rebuildDrawingLinework, normalizeDrawingLinework, DEFAULT_MULTILINE_STYLE } from './drawingLinework.js';
import { translateEntity, rotateEntity, mirrorEntity, scaleEntity } from './drawingPrimitives.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { getEntityGrips, editEntityGrip } from './drawingSelection.js';
import { normalizeDrawingContent } from './drawingDocument.js';

const make = linework => rebuildDrawingLinework({ id: 'linework', layerId: '0', linework });
const donut = () => make({ kind: 'donut', innerDiameter: 2, outerDiameter: 4 });
const points = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('donuts preserve exact nested curves, with zero inner diameter producing a solid disc', () => {
    const ring = donut();
    assert.equal(ring.type, 'hatch');
    assert.equal(ring.boundaries.length, 2);
    near(ring.boundaries[0].parts[0].rx, 2);
    near(ring.boundaries[1].parts[0].rx, 1);
    assert.equal(make({ kind: 'donut', innerDiameter: 0, outerDiameter: 4 }).boundaries.length, 1);
    assert.equal(make({ kind: 'donut', innerDiameter: 4, outerDiameter: 4 }), null);
});

test('multiline offsets meet at shared miters and justification places an outer element on the picked path', () => {
    const entity = make({ kind: 'multiline', points, style: DEFAULT_MULTILINE_STYLE });
    assert.deepEqual(entity.parts[0].points, [{ x: 0, y: -0.1 }, { x: 10.1, y: -0.1 }, { x: 10.1, y: 10 }]);
    const top = make({ kind: 'multiline', points, justification: 'top', style: DEFAULT_MULTILINE_STYLE });
    assert.deepEqual(top.parts[1].points, points);
    assert.equal(entity.parts.length, 4);
});

test('variable widths create a tapered filled boundary and retain zero-width segments', () => {
    const taper = make({ kind: 'wide', points: points.slice(0, 2), widths: [{ start: 2, end: 4 }] });
    assert.deepEqual(taper.parts[0].boundaries[0].parts.map(part => ({ x: part.x1, y: part.y1 })), [{ x: 0, y: 1 }, { x: 10, y: 2 }, { x: 10, y: -2 }, { x: 0, y: -1 }]);
    const hairline = make({ kind: 'wide', points, widths: [{ start: 0, end: 0 }, { start: 0, end: 0 }] });
    assert.equal(hairline.parts.length, 2);
    assert.ok(hairline.parts.every(part => part.type === 'line'));
});

test('transforms retain editable definitions and native geometry agrees after document normalization', () => {
    let ring = translateEntity(donut(), 5, 6);
    ring = rotateEntity(ring, 90, { x: 0, y: 0 });
    ring = mirrorEntity(ring, { x: 0, y: 0 }, { x: 1, y: 0 });
    ring = scaleEntity(ring, 2, { x: 0, y: 0 });
    near(ring.boundaries[0].parts[0].cx, -12);
    near(ring.boundaries[0].parts[0].cy, -10);
    near(ring.boundaries[0].parts[0].rx, 4);
    const normalized = normalizeDrawingContent({ entities: [ring] }).entities[0];
    assert.deepEqual(normalized.linework, ring.linework);
    near(normalized.boundaries[0].parts[0].cx, -12);
    const affine = transformDrawingEntityAffine(donut(), { a: 2, b: 0, c: 1, d: 3, e: 4, f: 5 });
    assert.equal(affine.linework.transform.c, 1);
    near(affine.boundaries[0].parts[0].cx, 4);
});

test('linework grips edit local parameters through an affine transform and reject collapsed geometry', () => {
    const ring = translateEntity(donut(), 5, 6);
    assert.equal(getEntityGrips(ring).length, 3);
    const updated = editEntityGrip(ring, 'linework-outer', { x: 8, y: 6 });
    assert.equal(updated.linework.outerDiameter, 6);
    assert.equal(editEntityGrip(ring, 'linework-outer', { x: 5, y: 6 }), ring);
    const multi = make({ kind: 'multiline', points, style: DEFAULT_MULTILINE_STYLE });
    assert.equal(getEntityGrips(multi).length, 3);
    assert.equal(editEntityGrip(multi, 'linework-vertex-1', points[0]), multi);
});

test('unsafe definitions are rejected and invalid optional metadata leaves cached geometry intact', () => {
    assert.equal(normalizeDrawingLinework({ kind: 'wide', points, widths: [] }), null);
    assert.equal(normalizeDrawingLinework({ kind: 'donut', innerDiameter: 0, outerDiameter: Infinity }), null);
    const ring = donut();
    const normalized = normalizeDrawingContent({ entities: [{ ...ring, linework: { kind: 'invalid' } }] }).entities[0];
    assert.equal(normalized.linework, undefined);
    assert.equal(normalized.boundaries.length, 2);
});


test('filled round multiline caps retain curved fill boundaries at both ends', () => {
    const entity = make({ kind: 'multiline', points: points.slice(0, 2),
        style: { ...DEFAULT_MULTILINE_STYLE, fill: true, startCap: 'arc', endCap: 'arc' } });
    assert.ok(entity);
    const fills = entity.parts.filter(part => part.type === 'hatch');
    assert.equal(fills.length, 3);
    for (const cap of fills.slice(1)) {
        assert.equal(cap.boundaries[0].parts[0].type, 'ellipse');
        assert.equal(cap.boundaries[0].parts[0].fullEllipse, false);
    }
});

test('linework creation and batch editing fail atomically and preserve stable identifiers', async () => {
    const { createDrawingLinework, editDrawingLinework } = await import('./drawingLineworkCommands.js');
    const content = normalizeDrawingContent({ entities: [] });
    const valid = { kind: 'donut', innerDiameter: 1, outerDiameter: 2 };
    assert.equal(createDrawingLinework(content, [valid, { ...valid, outerDiameter: 0 }]).error, 'invalid');
    assert.equal(content.entities.length, 0);
    const created = createDrawingLinework(content, [valid, valid]);
    assert.equal(created.selectedIds.length, 2);
    const edited = editDrawingLinework(created.content, created.selectedIds, { action: 'diameters', innerDiameter: 0, outerDiameter: 8 });
    assert.deepEqual(edited.selectedIds, created.selectedIds);
    assert.ok(edited.content.entities.every(entity => entity.boundaries.length === 1 && entity.linework.outerDiameter === 8));
    assert.equal(editDrawingLinework(created.content, created.selectedIds, { action: 'diameters', innerDiameter: 9, outerDiameter: 8 }).error, 'invalid');
    assert.ok(created.content.entities.every(entity => entity.linework.outerDiameter === 2));
});

test('named multiline styles normalize uniquely and changes preserve existing object snapshots', async () => {
    const { setDrawingMultilineStyle, deleteDrawingMultilineStyle } = await import('./drawingLineworkCommands.js');
    const style = { ...DEFAULT_MULTILINE_STYLE, name: 'Wall', elements: [{ offset: -0.15 }, { offset: 0.15 }] };
    const object = make({ kind: 'multiline', points, style });
    const content = normalizeDrawingContent({ entities: [object] });
    const saved = setDrawingMultilineStyle(content, style).content;
    assert.equal(saved.multilineStyles.length, 2);
    const changed = setDrawingMultilineStyle(saved, { ...style, name: 'WALL', fill: true }).content;
    assert.equal(changed.multilineStyles.length, 2);
    assert.equal(changed.multilineStyles[1].fill, true);
    assert.equal(changed.entities[0].linework.style.fill, false);
    assert.equal(deleteDrawingMultilineStyle(changed, 'Standard').error, 'standard');
    const deleted = deleteDrawingMultilineStyle(changed, 'wall').content;
    assert.equal(deleted.multilineStyles.length, 1);
    assert.deepEqual(deleted.entities, changed.entities);
    assert.deepEqual(normalizeDrawingContent(changed).multilineStyles, changed.multilineStyles);
});

test('multiline commands parse quoted style names, element appearances and reject malformed options', async () => {
    const { runDrawingMultilineStyle, parseMultilineCreation } = await import('./drawingLineworkCommands.js');
    const content = normalizeDrawingContent({ entities: [] });
    const result = runDrawingMultilineStyle(content, 'SET "Wall 20" ELEMENT -0.1 COLOR #ff0000 ELEMENT 0.1 LINETYPE dashed START arc END none FILL ON');
    assert.ok(result.content);
    const options = parseMultilineCreation('STYLE "Wall 20" SCALE 2 JUSTIFY TOP', result.content.multilineStyles);
    assert.equal(options.style.elements[0].color, '#ff0000');
    assert.equal(options.style.elements[1].lineType, 'dashed');
    assert.equal(options.style.fill, true);
    assert.equal(options.scale, 2);
    assert.equal(options.justification, 'top');
    assert.equal(parseMultilineCreation('STYLE missing', result.content.multilineStyles), null);
    assert.equal(parseMultilineCreation('SCALE 2 SCALE 3', result.content.multilineStyles), null);
    assert.ok(runDrawingMultilineStyle(content, 'SET wall ELEMENT 0 ELEMENT 0').error);
    assert.ok(runDrawingMultilineStyle(content, 'SET wall ELEMENT 0 ELEMENT').error);
    assert.deepEqual(runDrawingMultilineStyle(result.content, 'LIST').names, ['Standard', 'Wall 20']);
});

test('linework previews share committed geometry and ignore coincident cursor points', async () => {
    const { previewDrawingLinework } = await import('./drawingLinework.js');
    const operation = { type: 'linework', kind: 'multiline', stage: 'vertices', points: points.slice(0, 2), style: DEFAULT_MULTILINE_STYLE };
    const preview = previewDrawingLinework(operation, points[1], '0');
    assert.equal(preview.linework.points.length, 2);
    assert.deepEqual(preview.parts, make({ kind: 'multiline', points: points.slice(0, 2), style: DEFAULT_MULTILINE_STYLE }).parts);
    const ring = previewDrawingLinework({ type: 'linework', kind: 'donut', stage: 'center', innerDiameter: 1, outerDiameter: 2 }, { x: 5, y: 6 }, '0');
    near(ring.boundaries[0].parts[0].cx, 5);
});

test('wide polyline vertex capture retains each segment width and closes with the current width', async () => {
    const { appendDrawingLineworkVertex, finishDrawingLineworkDefinition, previewDrawingLinework } = await import('./drawingLinework.js');
    let operation = { type: 'linework', stage: 'vertices', kind: 'wide', points: [], widths: [], nextWidth: { start: 1, end: 2 } };
    operation = appendDrawingLineworkVertex(operation, points[0]);
    assert.deepEqual(operation.widths, []);
    operation = appendDrawingLineworkVertex(operation, points[1]);
    operation = { ...operation, nextWidth: { start: 2, end: 3 } };
    const preview = previewDrawingLinework(operation, points[2], '0');
    operation = appendDrawingLineworkVertex(operation, points[2]);
    assert.deepEqual(operation.widths, [{ start: 1, end: 2 }, { start: 2, end: 3 }]);
    assert.deepEqual(preview.linework.widths, operation.widths);
    const closed = finishDrawingLineworkDefinition(operation, true);
    assert.equal(closed.widths.length, 3);
    assert.ok(make(closed));
    assert.equal(appendDrawingLineworkVertex(operation, points[2]), null);
});

test('curved wide segments retain signed circular definitions and bounded tapered ribbons', async () => {
    const { drawingLineworkArc } = await import('./drawingLinework.js');
    const start = { x: 0, y: 0 }; const end = { x: 10, y: 0 };
    const arc = drawingLineworkArc(start, end, 1);
    near(arc.center.x, 5); near(arc.center.y, 0); near(arc.radius, 5); near(arc.sweep, Math.PI);
    const definition = { kind: 'wide', points: [start, end], widths: [{ start: 1, end: 2 }], bulges: [1] };
    const entity = make(definition);
    assert.ok(entity);
    const edges = entity.parts[0].boundaries[0].parts;
    assert.ok(edges.length > 20);
    assert.ok(edges.some(edge => edge.y1 < -5));
    const mirrored = make({ ...definition, bulges: [-1] });
    assert.ok(mirrored.parts[0].boundaries[0].parts.some(edge => edge.y1 > 5));
    const thin = make({ ...definition, widths: [{ start: 0, end: 0 }] });
    assert.equal(thin.parts[0].type, 'ellipse');
    near(thin.parts[0].rx, 5);
    assert.equal(make({ ...definition, widths: [{ start: 10, end: 10 }] }), null);
    const shifted = translateEntity(entity, 4, 7);
    assert.deepEqual(normalizeDrawingContent({ entities: [shifted] }).entities[0].linework.bulges, [1]);
});

test('linework definitions and curved filled geometry survive archive and SVG clipboard round trips', async () => {
    const { createLcadDocument, createLcadEnvelope } = await import('./lcadDocument.js');
    const { createLcadArchive, readLcadArchive } = await import('./lcadArchive.js');
    const { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, parseDrawingClipboardText, pasteDrawingClipboardPayload } = await import('./drawingClipboard.js');
    const document = createLcadDocument();
    document.content.entities = [donut(), { ...make({ kind: 'wide', points: points.slice(0, 2), widths: [{ start: 1, end: 2 }], bulges: [1] }), id: 'curve' }];
    document.content.entities = document.content.entities.map(entity => ({ ...entity, layerId: document.content.activeLayerId }));
    const loaded = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(loaded.content.entities, document.content.entities);
    const svg = drawingClipboardPayloadToSvg(createDrawingClipboardPayload(document, ['linework', 'curve']));
    assert.match(svg, /fill-rule="evenodd"/);
    const pasted = pasteDrawingClipboardPayload({ content: normalizeDrawingContent({}), assets: [] }, parseDrawingClipboardText(svg), { mode: 'original' });
    assert.deepEqual(pasted.content.entities.map(({ id, ...rest }) => rest), document.content.entities.map(({ id, ...rest }) => rest));
});

test('exploding linework preserves filled surfaces and detaches parametric metadata', async () => {
    const { explodeDrawingEntities } = await import('./drawingCompoundOperations.js');
    const content = normalizeDrawingContent({});
    const wide = { ...make({ kind: 'wide', points, widths: [{ start: 1, end: 2 }, { start: 2, end: 1 }] }), layerId: content.activeLayerId };
    content.entities = [wide];
    const result = explodeDrawingEntities(content, [wide.id]);
    assert.equal(result.changed, true);
    assert.equal(result.content.entities.length, 1);
    const fill = result.content.entities[0];
    assert.equal(fill.type, 'hatch');
    assert.equal(fill.linework, undefined);
    assert.deepEqual(fill.boundaries, wide.parts[0].boundaries);
});

test('multiline sharp joins stay bounded and closed ribbons keep their interior hole', () => {
    const acute = make({ kind: 'multiline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.01 }], style: DEFAULT_MULTILINE_STYLE });
    assert.ok(acute);
    assert.ok(acute.parts[0].points.every(point => Math.abs(point.x) < 12));
    const closed = make({ kind: 'wide', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        closed: true, widths: Array.from({ length: 4 }, () => ({ start: 1, end: 1 })) });
    assert.equal(closed.parts[0].boundaries.length, 2);
    const inner = closed.parts[0].boundaries[0].parts;
    assert.ok(inner.every(part => part.x1 >= 0.5 && part.y1 >= 0.5 && part.x1 <= 9.5 && part.y1 <= 9.5));
});

test('arc-line ribbons use consistently wound overlapping contours so joins do not punch holes', () => {
    const entity = make({ kind: 'wide', points: [{ x: 0, y: 8 }, { x: 6, y: 8 }, { x: 9, y: 8 }],
        widths: [{ start: 0.2, end: 0.8 }, { start: 0.8, end: 0.1 }], bulges: [1, 0] });
    const fill = entity.parts[0];
    assert.equal(fill.fillRule, 'nonzero');
    assert.equal(fill.boundaries.length, 4);
    for (const boundary of fill.boundaries) {
        const area = boundary.parts.reduce((sum, edge) => sum + edge.x1 * edge.y2 - edge.x2 * edge.y1, 0);
        assert.ok(area > 0);
    }
});

test('shared linework vertex and closure edits preserve local transforms, widths and curved segments', async () => {
    const { editDrawingLinework } = await import('./drawingLineworkCommands.js');
    const entity = make({ kind: 'wide', points, widths: [{ start: 0.2, end: 0.4 }, { start: 0.4, end: 0.6 }],
        bulges: [0.2, 0], transform: { a: 0, b: 2, c: -2, d: 0, e: 100, f: -30 } });
    entity.layerId = 'geometry';
    const content = normalizeDrawingContent({ entities: [entity] });
    const moved = editDrawingLinework(content, [entity.id], { action: 'vertex', index: 1, point: { x: 12, y: 0 } }).content;
    assert.deepEqual(moved.entities[0].linework.transform, entity.linework.transform);
    assert.deepEqual(moved.entities[0].linework.points[1], { x: 12, y: 0 });
    assert.deepEqual(moved.entities[0].linework.bulges, entity.linework.bulges);
    const closed = editDrawingLinework(moved, [entity.id], { action: 'close', closed: true }).content;
    assert.equal(closed.entities[0].linework.closed, true);
    assert.deepEqual(closed.entities[0].linework.widths, [...entity.linework.widths, entity.linework.widths.at(-1)]);
    assert.deepEqual(closed.entities[0].linework.bulges, [0.2, 0, 0]);
    assert.deepEqual(editDrawingLinework(closed, [entity.id], { action: 'close', closed: false }).content, moved);
    assert.equal(editDrawingLinework(moved, [entity.id], { action: 'vertex', index: 1, point: points[0] }).error, 'invalid');
    assert.deepEqual(content.entities[0].linework.points, points);
});
