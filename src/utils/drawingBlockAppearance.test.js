import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDrawingContent, getEntityAppearance } from './drawingDocument.js';
import { materializeDrawingBlockReference, resolveDrawingBlockChild } from './drawingBlocks.js';
import { drawingSnapEntities } from './drawingBlockSnapping.js';
import { createDrawingClipboardPayload, drawingClipboardPayloadToSvg } from './drawingClipboard.js';
import { explodeDrawingEntities } from './drawingCompoundOperations.js';

function fixture() {
    const content = createDefaultDrawingContent();
    content.layers.push({ ...content.layers[0], id: 'red', name: 'Red', color: '#ff0000' });
    const transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const child = { id: 'edge', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 };
    content.blocks = [{ id: 'inner', name: 'Inner', entities: [child, { ...child, id: 'explicit', layerId: 'dimensions', y1: 2, y2: 2 }] },
        { id: 'outer', name: 'Outer', entities: [{ id: 'nested', type: 'blockReference', blockId: 'inner', layerId: 'geometry', transform }] }];
    content.entities = [{ id: 'instance', type: 'blockReference', layerId: 'red', blockId: 'outer', transform, color: '#00ff00' }];
    return content;
}

test('layer zero resolves through nested inserts while explicit layers and colors survive', () => {
    const content = fixture();
    const root = content.entities[0];
    const children = materializeDrawingBlockReference(root, content.blocks, { recursive: true });
    assert.deepEqual(children.map(child => child.layerId), ['red', 'dimensions']);
    assert.equal(getEntityAppearance(content, children[0]).color, '#ff0000');
    assert.equal(content.blocks[0].entities[0].layerId, 'geometry');
    const colored = resolveDrawingBlockChild({ ...content.blocks[0].entities[0], color: '#0000ff' }, root);
    assert.equal(getEntityAppearance(content, colored).color, '#0000ff');
    const exploded = explodeDrawingEntities(content, [root.id], { recursiveBlocks: true });
    assert.equal(exploded.changed, true);
    assert.equal(getEntityAppearance(exploded.content, exploded.entities[0]).color, '#ff0000');
});

test('snapping visibility uses the resolved layer instead of hidden layer zero', () => {
    const content = fixture();
    content.layers.find(layer => layer.id === 'geometry').visible = false;
    assert.equal(drawingSnapEntities(content).length, 2);
    content.layers.find(layer => layer.id === 'dimensions').visible = false;
    assert.equal(drawingSnapEntities(content).length, 1);
    content.layers.find(layer => layer.id === 'red').visible = false;
    assert.equal(drawingSnapEntities(content).length, 0);
});

test('clipboard SVG reflects nested layer inheritance and hides explicit hidden children', () => {
    const content = fixture();
    content.layers.find(layer => layer.id === 'dimensions').visible = false;
    const payload = createDrawingClipboardPayload({ content, assets: [] }, ['instance']);
    const svg = drawingClipboardPayloadToSvg(payload);
    const rendered = svg.slice(svg.indexOf('</metadata>') + '</metadata>'.length);
    assert.match(rendered, /stroke="#ff0000"/);
    assert.equal((rendered.match(/<line /g) || []).length, 1);
});
