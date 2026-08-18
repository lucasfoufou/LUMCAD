import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createRectangularArray,
    explodeDrawingEntities,
    joinDrawingEntities,
} from './drawingCompoundOperations.js';
import {
    clampDrawingTransparency,
    createDefaultDrawingContent,
    getEntityTransparency,
    normalizeDrawingContent,
} from './drawingDocument.js';
import { offsetEntity } from './drawingGeometry.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';

test('.lcad ZIP round-trips layer inheritance and an explicit opaque object override', () => {
    const document = createLcadDocument({ name: 'Transparency archive' });
    document.content.layers[0].transparency = 45;
    document.content.entities = [
        { id: 'by-layer', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'opaque', type: 'line', layerId: 'geometry', transparency: 0, x1: 0, y1: 1, x2: 1, y2: 1 },
    ];

    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document)));
    assert.equal(restored.document.content.layers[0].transparency, 45);
    assert.equal(Object.hasOwn(restored.document.content.entities[0], 'transparency'), false);
    assert.equal(restored.document.content.entities[1].transparency, 0);
});

test('image transparency resolves ByLayer separately from raster opacity', () => {
    const content = createDefaultDrawingContent();
    content.layers[2].transparency = 60;
    const image = {
        id: 'reference', type: 'image', layerId: 'references', assetId: 'asset',
        x: 0, y: 0, width: 2, height: 1, opacity: 0.4,
    };
    content.entities = [image];

    assert.equal(getEntityTransparency(content, image), 60);
    assert.equal(image.opacity, 0.4);
    const opaqueOverride = { ...image, transparency: 0 };
    assert.equal(getEntityTransparency(content, opaqueOverride), 0);
    assert.equal(opaqueOverride.opacity, 0.4);
});

test('JOIN and EXPLODE preserve an explicit zero transparency override', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'first', type: 'line', layerId: 'geometry', transparency: 0, x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'second', type: 'line', layerId: 'geometry', x1: 2, y1: 0, x2: 2, y2: 2 },
    ];

    const joined = joinDrawingEntities(content, ['first', 'second']);
    assert.equal(joined.entity.transparency, 0);

    const exploded = explodeDrawingEntities(joined.content, joined.selectedIds);
    assert.ok(exploded.entities.every(entity => entity.transparency === 0));
});

test('EXPLODE preserves the rendered top-level transparency of an ARRAY container', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'opaque', type: 'line', layerId: 'geometry', transparency: 0, x1: 0, y1: 0, x2: 1, y2: 0 },
        { id: 'faded', type: 'line', layerId: 'geometry', transparency: 80, x1: 0, y1: 1, x2: 1, y2: 1 },
    ];
    const array = createRectangularArray(
        content,
        ['opaque', 'faded'],
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        1,
        1,
    );
    assert.equal(array.entity.transparency, 0);

    const exploded = explodeDrawingEntities(array.content, array.selectedIds);
    assert.ok(exploded.entities.every(entity => entity.transparency === 0));
});

test('ARRAY and OFFSET preserve explicit zero transparency without materializing ByLayer', () => {
    const content = createDefaultDrawingContent();
    const source = {
        id: 'source', type: 'line', layerId: 'geometry', transparency: 0,
        x1: 0, y1: 0, x2: 1, y2: 0,
    };
    content.entities = [source];

    assert.equal(offsetEntity(source, 1).transparency, 0);
    const array = createRectangularArray(
        content,
        ['source'],
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        2,
        2,
    );
    assert.equal(array.entity.transparency, 0);
    assert.ok(array.entity.parts.every(part => part.transparency === 0));

    const byLayerContent = createDefaultDrawingContent();
    byLayerContent.entities = [{ ...source, id: 'by-layer' }];
    delete byLayerContent.entities[0].transparency;
    const byLayerArray = createRectangularArray(
        byLayerContent,
        ['by-layer'],
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
        2,
        2,
    );
    assert.equal(Object.hasOwn(byLayerArray.entity, 'transparency'), false);
    assert.ok(byLayerArray.entity.parts.every(part => !Object.hasOwn(part, 'transparency')));
});

test('transparency input clamps values and nested polyline parts normalize without ids or layers', () => {
    assert.equal(clampDrawingTransparency(-10), 0);
    assert.equal(clampDrawingTransparency(44.6), 45);
    assert.equal(clampDrawingTransparency(100), 90);

    const content = createDefaultDrawingContent();
    content.entities = [{
        id: 'nested',
        type: 'polyline',
        layerId: 'geometry',
        parts: [
            { type: 'line', x1: 0, y1: 0, x2: 1, y2: 0, transparency: 0 },
            { type: 'line', x1: 0, y1: 1, x2: 1, y2: 1, transparency: 44.6 },
            { type: 'line', x1: 0, y1: 2, x2: 1, y2: 2, transparency: 100 },
            {
                type: 'polyline',
                parts: [{ type: 'line', x1: 0, y1: 3, x2: 1, y2: 3, transparency: 90 }],
            },
        ],
    }];

    const parts = normalizeDrawingContent(content).entities[0].parts;
    assert.equal(parts[0].transparency, 0);
    assert.equal(parts[1].transparency, 45);
    assert.equal(Object.hasOwn(parts[2], 'transparency'), false);
    assert.equal(parts[3].parts[0].transparency, 90);
    assert.ok(parts.every(part => !Object.hasOwn(part, 'id') && !Object.hasOwn(part, 'layerId')));
});
