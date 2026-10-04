import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImageSource, parseImageSourceInput, replaceImageSource } from './drawingImageSource.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import { normalizeDrawingContent } from './drawingDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

const source = { mode: 'linked', path: '/tmp/reference with spaces.png' };

test('source parser accepts explicit absolute paths and rejects ambiguous actions', () => {
    assert.deepEqual(parseImageSourceInput('RELINK "/tmp/reference with spaces.png"'), { action: 'relink', path: source.path });
    assert.deepEqual(parseImageSourceInput('RELOAD'), { action: 'reload', path: null });
    assert.deepEqual(parseImageSourceInput('LINK'), { action: 'link', path: null });
    assert.ok(normalizeImageSource({ mode: 'linked', path: 'C:\\Images\\plan.png' }));
    for (const input of ['RELOAD file.png', 'LINK ../plan.png', 'EMBED 1', 'LINK https://example.com/a.png', 'LINK /tmp/a\u0000.png']) assert.equal(parseImageSourceInput(input), null);
    assert.equal(normalizeImageSource({ mode: 'linked', path: '/'+ 'a'.repeat(4096) }), null);
});

test('source replacement is immutable and retains placement, clipping and adjustments', () => {
    const image = { id: 'image', type: 'image', assetId: 'old', imageSource: source, x: 2, y: 5, width: 8, height: 3, rotation: 25,
        opacity: 0.4, imageClip: { enabled: false, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }, imageAdjustments: { brightness: 120 } };
    const next = replaceImageSource(image, 'new', { ...source, path: '/tmp/new.png' });
    assert.deepEqual(next, { ...image, assetId: 'new', imageSource: { ...source, path: '/tmp/new.png' } });
    assert.equal(image.assetId, 'old');
    const embedded = replaceImageSource(next, 'new', null);
    assert.equal(embedded.imageSource, undefined);
    assert.equal(next.imageSource.path, '/tmp/new.png');
    assert.equal(embedded.imageClip, image.imageClip);
});

test('linked paths and cached bytes survive archive reload without reading the source', () => {
    const document = createLcadDocument({ name: 'Linked image' });
    document.assets = [{ id: 'asset', name: 'reference.png', mimeType: 'image/png', width: 1, height: 1, link: 'data:image/png;base64,AA==' }];
    document.content = normalizeDrawingContent({ ...document.content, entities: [{ id: 'image', type: 'image', layerId: 'references', assetId: 'asset', imageSource: source, x: 0, y: 0, width: 4, height: 4 }] });
    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.deepEqual(restored.content.entities[0].imageSource, source);
    assert.equal(restored.assets[0].link, document.assets[0].link);
    const invalid = normalizeDrawingContent({ ...document.content, entities: [{ ...document.content.entities[0], imageSource: { ...source, path: 'relative.png' } }] });
    assert.equal(invalid.entities[0].imageSource, undefined);
});
