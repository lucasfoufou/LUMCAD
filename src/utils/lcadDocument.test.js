import test from 'node:test';
import assert from 'node:assert/strict';

import {
    createLcadDocument,
    createLcadEnvelope,
    normalizeLcadImageMimeType,
    normalizeLcadEnvelope,
    safeLcadFilename,
} from './lcadDocument.js';
import { createDrawingLayout, createDrawingViewport } from './drawingLayouts.js';

test('creates and normalizes a versioned LUMCAD document', () => {
    const document = createLcadDocument({ name: 'Toiture nord' });
    const envelope = createLcadEnvelope(document, new Date('2026-08-10T10:00:00.000Z'));
    const normalized = normalizeLcadEnvelope(envelope);

    assert.equal(normalized.format, 'lumcad');
    assert.equal(normalized.formatVersion, 1);
    assert.equal(normalized.document.name, 'Toiture nord');
    assert.equal(normalized.document.content.unit, 'm');
    assert.equal(normalized.document.layouts.length, 1);
    assert.equal(normalized.document.layouts[0].format, 'A0');
    assert.equal(normalized.document.layouts[0].orientation, 'landscape');
    assert.equal(normalized.document.updatedAt, '2026-08-10T10:00:00.000Z');
});

test('rejects foreign and future file formats', () => {
    assert.throws(() => normalizeLcadEnvelope({ format: 'other', formatVersion: 1, document: {} }), /LUMCAD/);
    assert.throws(() => normalizeLcadEnvelope({ format: 'lumcad', formatVersion: 2, document: {} }), /version 2/i);
});

test('keeps portable embedded images and drops external references', () => {
    const envelope = createLcadEnvelope({
        ...createLcadDocument(),
        assets: [
            { id: 'portable', name: 'roof.png', width: 10, height: 5, link: 'data:image/png;base64,AAAA' },
            { id: 'remote', name: 'remote.png', width: 10, height: 5, link: 'https://example.com/image.png' },
        ],
    });

    assert.deepEqual(envelope.document.assets.map(asset => asset.id), ['portable']);
});

test('preserves layouts and their model viewports in the document envelope', () => {
    const document = createLcadDocument({ name: 'Layouts' });
    document.layouts = [
        createDrawingLayout({
            id: 'layout-a3',
            name: 'Overview',
            format: 'A3',
            viewports: [createDrawingViewport({
                id: 'viewport-roof',
                rect: { x: 20, y: 25, width: 210, height: 140 },
                modelViewBox: { x: -5, y: -2, width: 30, height: 20 },
                hiddenLayerIds: ['references'],
            })],
        }),
        createDrawingLayout({ id: 'layout-a4', name: 'Detail', format: 'A4' }),
    ];

    const normalized = normalizeLcadEnvelope(createLcadEnvelope(document));
    assert.deepEqual(normalized.document.layouts.map(layout => [layout.id, layout.name, layout.format]), [
        ['layout-a3', 'Overview', 'A3'],
        ['layout-a4', 'Detail', 'A4'],
    ]);
    assert.deepEqual(normalized.document.layouts[0].viewports[0], {
        id: 'viewport-roof',
        name: '',
        hiddenLayerIds: ['references'],
        x: 20,
        y: 25,
        width: 210,
        height: 140,
        modelViewBox: { x: -5, y: -2, width: 30, height: 20 },
    });
});

test('normalizes supported image MIME types and rejects unsupported assets', () => {
    assert.equal(normalizeLcadImageMimeType(' IMAGE/JPG '), 'image/jpeg');
    assert.equal(normalizeLcadImageMimeType('image/tiff'), null);

    const envelope = createLcadEnvelope({
        ...createLcadDocument(),
        assets: [
            { id: 'jpeg', name: 'photo.jpg', width: 10, height: 5, link: 'data:image/jpg;base64,AAAA' },
            { id: 'tiff', name: 'scan.tiff', width: 10, height: 5, link: 'data:image/tiff;base64,AAAA' },
        ],
    });
    assert.deepEqual(envelope.document.assets.map(asset => asset.mimeType), ['image/jpeg']);
});

test('builds safe .lcad filenames', () => {
    assert.equal(safeLcadFilename('Plan toiture.lcad'), 'Plan toiture.lcad');
    assert.equal(safeLcadFilename('Plan: toiture / A'), 'Plan- toiture - A.lcad');
    assert.equal(safeLcadFilename('...'), 'Untitled.lcad');
});
