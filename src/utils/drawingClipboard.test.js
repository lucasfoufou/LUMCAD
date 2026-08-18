import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference } from './drawingBlocks.js';
import {
    createDrawingClipboardInterchange,
    createDrawingClipboardPayload,
    DRAWING_CLIPBOARD_LIMITS,
    parseDrawingClipboardInterchange,
    parseDrawingClipboardText,
    pasteDrawingClipboardPayload,
    serializeDrawingClipboardPayload,
    validateDrawingClipboardPayload,
} from './drawingClipboard.js';
import { createDefaultDrawingContent, normalizeDrawingContent } from './drawingDocument.js';

test('clipboard payload captures selected dependency closure, layers, assets and blocks', () => {
    const content = createDefaultDrawingContent();
    content.layers.push(testLayer('solar', 'SOLAR', '#225588'));
    const definition = createAnonymousDrawingBlock([
        { id: 'block-line', type: 'line', layerId: 'solar', x1: 0, y1: 0, x2: 1, y2: 0 },
    ], { id: 'block-a' });
    const reference = createAnonymousDrawingBlockReference(definition, {
        id: 'reference', insertionPoint: { x: 8, y: 9 }, layerId: 'solar',
    });
    content.blocks = [definition];
    content.entities = [
        { id: 'line', type: 'line', layerId: 'solar', x1: 1, y1: 2, x2: 5, y2: 2 },
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'line', offset: 0.6 },
        { id: 'image', type: 'image', layerId: 'references', assetId: 'asset-a', x: 0, y: 0, width: 2, height: 1 },
        reference,
    ];
    const assets = [{
        id: 'asset-a', name: 'reference.svg', mimeType: 'image/svg+xml', width: 2, height: 1,
        link: 'data:image/svg+xml;base64,PHN2Zy8+',
    }];

    const sourcePayload = createDrawingClipboardPayload({ id: 'drawing-a', content, assets }, ['line', 'image', 'reference'], {
        basePoint: { x: 1, y: 2 },
    });
    assert.deepEqual(sourcePayload.selectionIds, ['line', 'image', 'reference']);
    assert.deepEqual(sourcePayload.entities.map(entity => entity.id), ['line', 'dimension', 'image', 'reference']);
    assert.deepEqual(new Set(sourcePayload.layers.map(layer => layer.id)), new Set(['solar', 'dimensions', 'references']));
    assert.equal(sourcePayload.assets[0].id, 'asset-a');
    assert.equal(sourcePayload.blocks[0].id, 'block-a');
    assert.deepEqual(sourcePayload.basePoint, { x: 1, y: 2 });

    const dimensionOnly = createDrawingClipboardPayload({ content, assets }, ['dimension']);
    assert.deepEqual(dimensionOnly.entities.map(entity => entity.id), ['line', 'dimension']);
    assert.deepEqual(dimensionOnly.selectionIds, ['dimension']);
});

test('clipboard JSON and embedded SVG round-trip losslessly while simple SVG imports primitives', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 2, cy: 2, r: 1 },
    ];
    const payload = createDrawingClipboardPayload({ content, assets: [] }, ['line', 'circle'], { basePoint: { x: 0, y: 0 } });
    const json = serializeDrawingClipboardPayload(payload);
    assert.deepEqual(parseDrawingClipboardText(json), payload);
    const formats = createDrawingClipboardInterchange(payload);
    assert.deepEqual(parseDrawingClipboardText(formats['image/svg+xml']), payload);
    assert.deepEqual(parseDrawingClipboardInterchange(new Map(Object.entries(formats))), payload);
    assert.equal(formats['text/plain'], formats['image/svg+xml']);
    assert.match(formats['text/plain'], /^<\?xml version="1\.0" encoding="UTF-8"\?>/);

    const imported = parseDrawingClipboardText('<svg xmlns="http://www.w3.org/2000/svg"><line x1="1" y1="2" x2="3" y2="4"/><circle cx="5" cy="6" r="2"/><polygon points="0,0 2,0 2,2"/></svg>');
    assert.deepEqual(imported.entities.map(entity => entity.type), ['line', 'circle', 'polyline']);
    assert.equal(imported.entities[2].closed, true);
});

test('SVG interchange exports exact ellipses, elliptical arcs, splines, hatch boundaries and dimensions', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        {
            id: 'ellipse', type: 'ellipse', layerId: 'geometry', cx: 3, cy: 2, rx: 2, ry: 1,
            rotation: 25, startAngle: 0, endAngle: 0, counterClockwise: true, fullEllipse: true,
        },
        {
            id: 'ellipse-arc', type: 'ellipse', layerId: 'geometry', cx: 8, cy: 2, rx: 2, ry: 1,
            rotation: 15, startAngle: 0, endAngle: Math.PI * 1.25, counterClockwise: true, fullEllipse: false,
        },
        { id: 'spline', type: 'spline', layerId: 'geometry', controlPoints: [
            { x: 0, y: 5 }, { x: 1, y: 7 }, { x: 3, y: 3 }, { x: 4, y: 5 },
        ] },
        { id: 'hatch', type: 'hatch', layerId: 'geometry', boundaries: [[
            { x: 5, y: 5 }, { x: 7, y: 5 }, { x: 6, y: 7 },
        ]] },
        { id: 'dimension-source', type: 'line', layerId: 'geometry', x1: 0, y1: 9, x2: 4, y2: 9 },
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'dimension-source', offset: 1 },
    ];
    const payload = createDrawingClipboardPayload({ content, assets: [] }, [
        'ellipse', 'ellipse-arc', 'spline', 'hatch', 'dimension-source',
    ]);
    const svg = createDrawingClipboardInterchange(payload)['image/svg+xml'];
    assert.match(svg, /<ellipse\b[^>]*rx="2"[^>]*ry="1"/);
    assert.match(svg, /<path d="M [^"]+ A 2 1 15 1 1/);
    assert.match(svg, / C 1 7 3 3 4 5/);
    assert.match(svg, /M 5 5 L 7 5 L 6 7 L 5 5 Z/);
    assert.match(svg, /4 m<\/text>/);
    assert.deepEqual(parseDrawingClipboardText(svg), payload);
});

test('external SVG imports bounded absolute and relative path commands with affine transforms', () => {
    const imported = parseDrawingClipboardText(`
        <svg xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(10 20)">
                <ellipse cx="2" cy="3" rx="2" ry="1" transform="rotate(30 2 3)"/>
                <path transform="scale(2)" d="M 0 0 l 2 0 h 1 v 2 C 3 3 4 4 5 2 a 2 1 30 0 1 4 0 z"/>
            </g>
            <path transform="matrix(1 0 0 1 -2 4)" d="m 1 1 L 3 1 V 3 H 1 Z"/>
        </svg>
    `);
    assert.equal(imported.entities.length, 3);
    const ellipse = imported.entities[0];
    assert.equal(ellipse.type, 'ellipse');
    assert.ok(Math.abs(ellipse.cx - 12) < 1e-9 && Math.abs(ellipse.cy - 23) < 1e-9);
    assert.ok(Math.abs(ellipse.rotation - 30) < 1e-9);

    const mixed = imported.entities[1];
    assert.equal(mixed.type, 'polyline');
    assert.equal(mixed.closed, true);
    assert.deepEqual(mixed.parts.map(part => part.type), ['line', 'line', 'line', 'spline', 'ellipse', 'line']);
    assert.deepEqual(
        { x1: mixed.parts[0].x1, y1: mixed.parts[0].y1, x2: mixed.parts[0].x2, y2: mixed.parts[0].y2 },
        { x1: 10, y1: 20, x2: 14, y2: 20 },
    );
    assert.deepEqual(mixed.parts[3].controlPoints.at(-1), { x: 20, y: 24 });
    assert.equal(mixed.parts[4].type, 'ellipse');

    const closed = imported.entities[2];
    assert.equal(closed.type, 'polyline');
    assert.equal(closed.closed, true);
    assert.deepEqual({ x1: closed.parts[0].x1, y1: closed.parts[0].y1 }, { x1: -1, y1: 5 });
});

test('external SVG accepts the XML prolog and namespaced Affinity export envelope', () => {
    const imported = parseDrawingClipboardText(`
        <?xml version="1.0" encoding="UTF-8" standalone="no"?>
        <!DOCTYPE svg>
        <svg width="100%" height="100%" viewBox="0 0 40 30" version="1.1"
            xmlns="http://www.w3.org/2000/svg" xmlns:serif="http://www.serif.com/">
            <g serif:id="Layer 1" transform="matrix(2,0,0,2,5,7)">
                <path d="M0,0L3,0L3,4Z" style="fill:none;fill-rule:evenodd;stroke:#000;"/>
            </g>
        </svg>
    `);
    assert.equal(imported.entities.length, 1);
    assert.deepEqual(imported.entities[0].parts.map(part => [part.x1, part.y1, part.x2, part.y2]), [
        [5, 7, 11, 7], [11, 7, 11, 15], [11, 15, 5, 7],
    ]);
    assert.throws(
        () => parseDrawingClipboardText('<html><svg><line x1="0" y1="0" x2="1" y2="1"/></svg></html>'),
        error => error.drawingClipboardCode === 'unsupported-text',
    );
});

test('external SVG path parsing rejects malformed, unsupported and unbounded input atomically', () => {
    const cases = [
        ['<svg><line x1="0" y1="0" x2="1" y2="1"/><path d="M 0 0 C 1 2"/></svg>', 'invalid-svg-path'],
        ['<svg><path d="M 0 0 Q 1 2 3 4"/></svg>', 'unsupported-svg-path'],
        ['<svg><path d="M 0 0 L 10000000000000 1"/></svg>', 'unbounded-svg'],
        ['<svg><path d="M 0 0 A 2 1 0 2 1 4 0"/></svg>', 'invalid-svg-path'],
        ['<svg><path transform="skewX(20)" d="M 0 0 L 1 1"/></svg>', 'unsupported-svg-transform'],
        ['<svg><polyline points="0,0 broken,2"/></svg>', 'invalid-svg-geometry'],
    ];
    cases.forEach(([svg, code]) => {
        assert.throws(() => parseDrawingClipboardText(svg), error => error.drawingClipboardCode === code);
    });
});

test('ordinary and original paste remap IDs, associations, layers and assets', () => {
    const source = createDefaultDrawingContent();
    source.layers.push(testLayer('solar', 'SOLAR', '#225588'));
    source.entities = [
        { id: 'line', type: 'line', layerId: 'solar', x1: 10, y1: 20, x2: 14, y2: 20 },
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'line', offset: 0.6 },
        { id: 'image', type: 'image', layerId: 'references', assetId: 'asset', x: 10, y: 21, width: 2, height: 1 },
    ];
    const sourceAssets = [{
        id: 'asset', name: 'reference.svg', mimeType: 'image/svg+xml', width: 2, height: 1,
        link: 'data:image/svg+xml;base64,PHN2Zy8+',
    }];
    const payload = createDrawingClipboardPayload({ content: source, assets: sourceAssets }, ['line', 'image'], {
        basePoint: { x: 10, y: 20 },
    });

    const target = createDefaultDrawingContent();
    target.layers.push(testLayer('different-id', 'SOLAR', '#ff0000'));
    const inserted = pasteDrawingClipboardPayload({ content: target, assets: [] }, payload, {
        mode: 'insert', insertionPoint: { x: 2, y: 3 },
    });
    const pastedLine = inserted.entities.find(entity => entity.type === 'line');
    const pastedDimension = inserted.entities.find(entity => entity.type === 'linearDimension');
    const pastedImage = inserted.entities.find(entity => entity.type === 'image');
    assert.deepEqual({ x1: pastedLine.x1, y1: pastedLine.y1, x2: pastedLine.x2, y2: pastedLine.y2 }, {
        x1: 2, y1: 3, x2: 6, y2: 3,
    });
    assert.equal(pastedLine.layerId, 'different-id');
    assert.equal(pastedDimension.sourceId, pastedLine.id);
    assert.equal(pastedImage.assetId, inserted.assets[0].id);
    assert.deepEqual(inserted.delta, { x: -8, y: -17 });
    assert.deepEqual(inserted.selectedIds.sort(), [pastedImage.id, pastedLine.id].sort());

    const original = pasteDrawingClipboardPayload({ content: target, assets: [] }, payload, { mode: 'original' });
    const originalLine = original.entities.find(entity => entity.type === 'line');
    assert.deepEqual({ x1: originalLine.x1, y1: originalLine.y1, x2: originalLine.x2, y2: originalLine.y2 }, {
        x1: 10, y1: 20, x2: 14, y2: 20,
    });
    assert.deepEqual(original.delta, { x: 0, y: 0 });
});

test('paste as block creates one anonymous reference with lossless child dependencies', () => {
    const source = createDefaultDrawingContent();
    source.entities = [
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 10, cy: 10, r: 2 },
        { id: 'radius', type: 'radialDimension', layerId: 'dimensions', sourceId: 'circle', angle: 0 },
    ];
    const payload = createDrawingClipboardPayload({ content: source, assets: [] }, ['circle'], {
        basePoint: { x: 10, y: 10 },
    });
    const target = createDefaultDrawingContent();
    const result = pasteDrawingClipboardPayload({ content: target, assets: [] }, payload, {
        mode: 'block', insertionPoint: { x: 3, y: 4 },
    });
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].type, 'blockReference');
    assert.equal(result.content.blocks.length, 1);
    const definition = result.content.blocks[0];
    const localCircle = definition.entities.find(entity => entity.type === 'circle');
    const localDimension = definition.entities.find(entity => entity.type === 'radialDimension');
    assert.deepEqual({ cx: localCircle.cx, cy: localCircle.cy }, { cx: 0, cy: 0 });
    assert.equal(localDimension.sourceId, localCircle.id);
    assert.deepEqual(result.entities[0].transform, { a: 1, b: 0, c: 0, d: 1, e: 3, f: 4 });

    const normalized = normalizeDrawingContent(JSON.parse(JSON.stringify(result.content)));
    assert.equal(normalized.entities[0].blockId, normalized.blocks[0].id);
});

test('clipboard validation rejects dangling, cyclic, oversized and unsupported payloads', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 1, y2: 0 }];
    const payload = createDrawingClipboardPayload({ content, assets: [] }, ['line']);
    assert.throws(() => validateDrawingClipboardPayload({ ...payload, version: 99 }), error => error.drawingClipboardCode === 'unsupported-version');
    assert.throws(() => validateDrawingClipboardPayload({
        ...payload,
        entities: [{ ...payload.entities[0], sourceId: 'missing' }],
    }), error => error.drawingClipboardCode === 'missing-source');
    const cyclic = { ...payload };
    cyclic.loop = cyclic;
    assert.throws(() => validateDrawingClipboardPayload(cyclic), error => error.drawingClipboardCode === 'cyclic-payload');
    assert.throws(() => validateDrawingClipboardPayload({
        ...payload,
        entities: [{ ...payload.entities[0], x1: Number.NaN }],
    }), error => error.drawingClipboardCode === 'non-finite-number');
    assert.throws(() => validateDrawingClipboardPayload(payload, {
        ...DRAWING_CLIPBOARD_LIMITS,
        entities: 0,
    }), error => error.drawingClipboardCode === 'too-many-entities');
    assert.throws(() => parseDrawingClipboardText('not geometry'), error => error.drawingClipboardCode === 'unsupported-text');
});

function testLayer(id, name, color) {
    return { id, name, color, lineWeight: 1, lineType: 'continuous', transparency: 0, visible: true, locked: false };
}
