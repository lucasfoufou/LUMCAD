import test from 'node:test';
import assert from 'node:assert/strict';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { setDrawingBasePoint } from './drawingBasePoint.js';
import { createDrawingBlockLibrary, importDrawingBlockLibrary } from './drawingBlockLibrary.js';
import { createDrawingBlockWorkflow } from './drawingBlockWorkflow.js';

function source() {
    const document = createLcadDocument({ name: 'Symbol' });
    document.content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 10, y1: 20, x2: 14, y2: 20 }];
    document.content = setDrawingBasePoint(document.content, { x: 10, y: 20 });
    return document;
}

test('document base point round trips without moving entities; invalid points cannot commit', () => {
    const document = source();
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.metadata.basePoint, { x: 10, y: 20 });
    assert.deepEqual(restored.content.entities, document.content.entities);
    for (const point of [null, { x: Infinity, y: 0 }, { x: 1e13, y: 0 }]) assert.equal(setDrawingBasePoint(document.content, point), null);
    let operation;
    let commits = 0;
    const history = { content: document.content, commit: content => { history.content = content; commits++; } };
    const workflow = createDrawingBlockWorkflow({ history, selectedIds: [], setInteractiveOperation: value => { operation = value; }, setActiveTool() {}, setSelectedIds() {}, setMessage() {}, t: key => key });
    workflow.base('');
    assert.equal(commits, 0);
    workflow.point(operation, { x: -2, y: 3 });
    assert.equal(commits, 1);
    assert.equal(operation, null);
    workflow.base('NaN 2');
    assert.equal(commits, 1);
    workflow.base('4 5');
    assert.equal(commits, 2);
    assert.deepEqual(history.content.metadata.basePoint, { x: 4, y: 5 });
});

test('library export localizes geometry around BASE and import preserves the target model', () => {
    const document = source();
    const original = JSON.stringify(document);
    const library = createDrawingBlockLibrary(document);
    assert.equal(JSON.stringify(document), original);
    assert.equal(library.content.blocks[0].entities[0].x1, 0);
    assert.equal(library.content.blocks[0].entities[0].y1, 0);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(library))).document;
    const target = source();
    const imported = importDrawingBlockLibrary(target, restored);
    assert.deepEqual(imported.content.entities, target.content.entities);
    assert.equal(imported.entryBlockIds.length, 1);
    assert.ok(imported.content.blocks.some(block => block.id === imported.entryBlockIds[0]));
});

test('nested definitions retain dependencies and assets across conflicting imports', async () => {
    const { defineNamedDrawingBlock } = await import('./drawingNamedBlocks.js');
    const document = source();
    document.assets = [{ id: 'asset', width: 1, height: 1, name: 'pixel.svg', mimeType: 'image/svg+xml', link: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiLz4=' }];
    document.content.entities.push({ id: 'image', type: 'image', layerId: 'geometry', assetId: 'asset', x: 10, y: 20, width: 2, height: 2 });
    document.content = defineNamedDrawingBlock(document.content, ['line', 'image'], { name: 'Inner', basePoint: { x: 10, y: 20 } }).content;
    document.content = defineNamedDrawingBlock(document.content, [document.content.entities[0].id], { name: 'Outer', basePoint: { x: 0, y: 0 } }).content;
    const library = createDrawingBlockLibrary(document, { selector: 'Outer' });
    assert.equal(library.content.blocks.length, 2);
    assert.equal(library.assets.length, 1);
    const target = source();
    target.content = defineNamedDrawingBlock(target.content, ['line'], { name: 'Inner', basePoint: { x: 0, y: 0 } }).content;
    const original = JSON.stringify(target);
    const result = importDrawingBlockLibrary(target, library);
    assert.equal(JSON.stringify(target), original);
    assert.deepEqual(result.content.blocks.map(block => block.name).sort(), ['Inner', 'Inner (2)', 'Outer']);
    const outer = result.content.blocks.find(block => block.id === result.entryBlockIds[0]);
    const inner = result.content.blocks.find(block => block.id === outer.entities[0].blockId);
    assert.equal(inner.name, 'Inner (2)');
    assert.equal(inner.entities.find(entity => entity.type === 'image').assetId, result.assets[0].id);
    const again = importDrawingBlockLibrary({ ...target, ...result }, library);
    assert.equal(new Set(again.content.blocks.map(block => block.name.toLowerCase())).size, again.content.blocks.length);
    assert.equal(again.assets.length, result.assets.length);
    assert.deepEqual(again.content.blocks.slice(0, result.content.blocks.length), result.content.blocks);
});

test('library import rejects cycles and invalid entry markers atomically', () => {
    const library = createDrawingBlockLibrary(source());
    const target = source();
    const original = JSON.stringify(target);
    library.content.metadata.blockLibrary.entryBlockIds = ['missing'];
    assert.throws(() => importDrawingBlockLibrary(target, library));
    library.content.metadata.blockLibrary.entryBlockIds = [library.content.blocks[0].id];
    library.content.blocks[0].entities = [{ id: 'cycle', type: 'blockReference', blockId: library.content.blocks[0].id, layerId: 'geometry', transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } }];
    assert.throws(() => importDrawingBlockLibrary(target, library));
    assert.equal(JSON.stringify(target), original);
});

test('conflicting text style IDs are remapped without changing destination styles', () => {
    const document = source();
    const style = { ...document.content.textStyles[0], fontFamily: 'serif' };
    document.content.textStyles = [style];
    document.content.entities = [{ id: 'label', type: 'text', layerId: 'geometry', text: 'Library', textStyleId: style.id, x: 10, y: 20, width: 4, height: 2 }];
    const target = source();
    const originalStyle = { ...target.content.textStyles[0] };
    const result = importDrawingBlockLibrary(target, createDrawingBlockLibrary(document));
    const child = result.content.blocks.find(block => block.id === result.entryBlockIds[0]).entities[0];
    assert.notEqual(child.textStyleId, originalStyle.id);
    assert.equal(result.content.textStyles.find(style => style.id === child.textStyleId).fontFamily, 'serif');
    assert.deepEqual(result.content.textStyles.find(style => style.id === originalStyle.id), originalStyle);
});

test('block libraries preserve dimension styles through archive export and conflicting import', async () => {
    const { normalizeDimensionStyles, applyDimensionStyle } = await import('./drawingDimensionStyles.js');
    const document = source();
    document.content.dimensionStyles = normalizeDimensionStyles([{ id: 'plan', name: 'Plan', textSize: 0.9 }]);
    document.content.entities.push(applyDimensionStyle({ id: 'dim', type: 'linearDimension', layerId: 'dimensions', sourceId: 'line', offset: 1 }, document.content.dimensionStyles[1]));
    const library = createDrawingBlockLibrary(document);
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(library))).document;
    const target = source();
    target.content.dimensionStyles = normalizeDimensionStyles([{ id: 'plan', name: 'Plan', textSize: 0.2 }]);
    const result = importDrawingBlockLibrary(target, restored);
    const dimension = result.content.blocks.flatMap(block => block.entities).find(entity => entity.type === 'linearDimension');
    const style = result.content.dimensionStyles.find(item => item.id === dimension.dimensionStyleId);
    assert.equal(style.name, 'Plan (2)');
    assert.equal(style.textSize, 0.9);
    assert.equal(dimension.textSize, 0.9);
    assert.equal(target.content.dimensionStyles[1].textSize, 0.2);
});
