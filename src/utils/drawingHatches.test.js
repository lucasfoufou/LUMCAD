import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHatchBoundaries, createDrawingHatch, parseHatchPatternInput, refreshDrawingHatches } from './drawingHatches.js';
import { translateEntity } from './drawingPrimitives.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { normalizeDrawingContent, createDefaultDrawingContent } from './drawingDocument.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg, pasteDrawingClipboardPayload } from './drawingClipboard.js';

const rectangle = { id: 'outer', type: 'rectangle', layerId: 'geometry', x: 0, y: 0, width: 10, height: 8 };
const hole = { id: 'hole', type: 'circle', layerId: 'geometry', cx: 3, cy: 3, r: 1 };
const hatch = () => createDrawingHatch([rectangle, hole], 'geometry', { name: 'cross', spacing: 0.3, angle: 30, origin: { x: 1, y: 2 } }, 'fill');

test('hatch creation retains exact closed outer and island curves and associations', () => {
    const created = hatch();
    assert.equal(created.type, 'hatch');
    assert.equal(created.boundaries.length, 2);
    assert.equal(created.boundaries[0].parts.length, 4);
    assert.equal(created.boundaries[1].parts[0].type, 'circle');
    assert.deepEqual(created.sourceIds, ['outer', 'hole']);
    assert.deepEqual(created.pattern.origin, { x: 1, y: 2 });
    assert.equal(buildHatchBoundaries([]), null);
    assert.equal(buildHatchBoundaries([{ id: 'text', type: 'text' }]), null);
});

test('unordered and reversed connected curves form a loop; gaps and branches reject atomically', () => {
    const lines = [
        { type: 'line', x1: 0, y1: 0, x2: 4, y2: 0 },
        { type: 'line', x1: 0, y1: 3, x2: 4, y2: 3 },
        { type: 'line', x1: 0, y1: 3, x2: 0, y2: 0 },
        { type: 'line', x1: 4, y1: 0, x2: 4, y2: 3 },
    ];
    const boundaries = buildHatchBoundaries(lines);
    assert.equal(boundaries.length, 1);
    assert.equal(boundaries[0].parts.length, 4);
    assert.equal(buildHatchBoundaries(lines.slice(0, 3)), null);
    assert.equal(buildHatchBoundaries([...lines, { type: 'line', x1: 4, y1: 0, x2: 7, y2: 1 }]), null);
});

test('associations follow source edits while independent hatch moves detach without snapping back', () => {
    const previous = { entities: [rectangle, hole, hatch()] };
    const movedSource = { ...rectangle, width: 15 };
    const changed = refreshDrawingHatches({ entities: [movedSource, hole, previous.entities[2]] }, previous);
    assert.deepEqual(changed.entities[2].boundaries, buildHatchBoundaries([movedSource, hole]));
    assert.deepEqual(changed.entities[2].sourceIds, ['outer', 'hole']);
    const movedHatch = translateEntity(previous.entities[2], 2, 1);
    const detached = refreshDrawingHatches({ entities: [rectangle, hole, movedHatch] }, previous).entities[2];
    assert.equal(detached.sourceIds, undefined);
    assert.deepEqual(detached.boundaries, movedHatch.boundaries);
    const allMoved = refreshDrawingHatches({ entities: previous.entities.map(entity => translateEntity(entity, 2, 1)) }, previous);
    assert.deepEqual(allMoved.entities[2].sourceIds, ['outer', 'hole']);
    const broken = refreshDrawingHatches({ entities: [rectangle, previous.entities[2]] }, previous).entities[1];
    assert.equal(broken.sourceIds, undefined);
    assert.deepEqual(broken.boundaries, previous.entities[2].boundaries);
});

test('pattern options validate distances, gradient colours and origins', () => {
    assert.equal(parseHatchPatternInput('CROSS 0.2 60').name, 'cross');
    assert.deepEqual(parseHatchPatternInput('ORIGIN 2 -4').origin, { x: 2, y: -4 });
    assert.equal(parseHatchPatternInput('GRADIENT #ff00aa 20').endColor, '#ff00aa');
    assert.equal(parseHatchPatternInput('RADIAL').endColor, '#ffffff');
    for (const input of ['LINES 0', 'CROSS NaN', 'GRADIENT javascript:bad', 'ORIGIN Infinity 0', 'UNKNOWN']) assert.equal(parseHatchPatternInput(input), null);
});

test('archive reload retains hatch definition, sources, patterns and gradient colours', () => {
    const document = createLcadDocument({ name: 'Hatches' });
    document.content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: [rectangle, hole, hatch()] });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content, document.content);
    const gradient = { ...hatch(), pattern: parseHatchPatternInput('GRADIENT #112233 45') };
    document.content = normalizeDrawingContent({ ...document.content, entities: [rectangle, hole, gradient] });
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content, document.content);
});

test('clipboard carries real fill definitions, islands and remapped associations', () => {
    const source = { ...createDefaultDrawingContent(), entities: [rectangle, hole, { ...hatch(), pattern: parseHatchPatternInput('GRADIENT #112233 45') }] };
    const payload = createDrawingClipboardPayload({ content: source }, ['fill']);
    const svg = drawingClipboardPayloadToSvg(payload);
    assert.match(svg, /<linearGradient/);
    assert.match(svg, /stop-color="#112233"/);
    assert.match(svg, /fill-rule="evenodd"/);
    const pasted = pasteDrawingClipboardPayload({ content: createDefaultDrawingContent(), assets: [] }, payload, { point: { x: 20, y: 10 } });
    const content = pasted.content || pasted.document?.content;
    assert.ok(content);
    const pastedHatch = content.entities.find(entity => entity.type === 'hatch');
    assert.equal(pastedHatch.sourceIds.length, 2);
    assert.ok(pastedHatch.sourceIds.every(id => id !== 'outer' && id !== 'hole' && content.entities.some(entity => entity.id === id)));
});

test('picked faces refresh a divider, transform their seed and survive archive reload', () => {
    const divider = { id: 'divider', type: 'line', layerId: 'geometry', x1: 5, y1: -1, x2: 5, y2: 9 };
    const picked = createDrawingHatch([rectangle, divider], 'geometry', { name: 'solid' }, 'pick', { x: 2, y: 2 });
    const previous = { entities: [rectangle, divider, picked] };
    const movedDivider = { ...divider, x1: 6, x2: 6 };
    const updated = refreshDrawingHatches({ entities: [rectangle, movedDivider, picked] }, previous).entities[2];
    assert.deepEqual(updated.sourceIds, ['outer', 'divider']);
    assert.ok(updated.boundaries[0].parts.some(part => part.x1 === 6));
    const translated = refreshDrawingHatches({ entities: previous.entities.map(entity => translateEntity(entity, 20, 10)) }, previous);
    assert.deepEqual(translated.entities[2].boundaryPick, { x: 22, y: 12 });
    assert.deepEqual(translated.entities[2].sourceIds, picked.sourceIds);
    const document = createLcadDocument({ name: 'Picked area' });
    document.content = normalizeDrawingContent({ ...createDefaultDrawingContent(), entities: translated.entities });
    assert.deepEqual(readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document.content, document.content);
    const escaped = refreshDrawingHatches({ entities: [rectangle, { ...divider, x1: 2, x2: 2 }, picked] }, previous).entities[2];
    assert.equal(escaped.sourceIds, undefined);
    assert.equal(escaped.boundaryPick, undefined);
    assert.deepEqual(escaped.boundaries, picked.boundaries);
});
