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
import { DEFAULT_DRAWING_PLOT_SETTINGS } from './drawingPlot.js';

test('creates and normalizes a versioned LUMCAD document', () => {
    const document = createLcadDocument({ name: 'Toiture nord' });
    const envelope = createLcadEnvelope(document, new Date('2026-08-10T10:00:00.000Z'));
    const normalized = normalizeLcadEnvelope(envelope);

    assert.equal(normalized.format, 'lumcad');
    assert.equal(normalized.formatVersion, 2);
    assert.equal(normalized.document.name, 'Toiture nord');
    assert.equal(normalized.document.content.unit, 'm');
    assert.equal(normalized.document.layouts.length, 1);
    assert.equal(normalized.document.layouts[0].format, 'A0');
    assert.equal(normalized.document.layouts[0].orientation, 'landscape');
    assert.deepEqual(normalized.document.layouts[0].plotSettings, DEFAULT_DRAWING_PLOT_SETTINGS);
    assert.equal(normalized.document.updatedAt, '2026-08-10T10:00:00.000Z');
});

test('rejects foreign and future file formats', () => {
    assert.throws(() => normalizeLcadEnvelope({ format: 'other', formatVersion: 1, document: {} }), /LUMCAD/);
    assert.throws(() => normalizeLcadEnvelope({ format: 'lumcad', formatVersion: 3, document: {} }), /version 3/i);
});

test('migrates version 1 and older version 2 plot profiles to the current defaults', () => {
    const legacyDocument = createLcadDocument({ name: 'Legacy drawing' });
    delete legacyDocument.layouts[0].plotSettings;
    legacyDocument.pageSetups = [{
        id: 'legacy-page-setup',
        name: 'Legacy setup',
        format: 'A4',
        orientation: 'landscape',
        customPaperSize: { width: 420, height: 297 },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
    }];
    const normalized = normalizeLcadEnvelope({
        format: 'lumcad',
        formatVersion: 1,
        document: legacyDocument,
    });
    assert.equal(normalized.formatVersion, 2);
    assert.equal(normalized.document.name, 'Legacy drawing');
    assert.deepEqual(normalized.document.layouts[0].plotSettings, DEFAULT_DRAWING_PLOT_SETTINGS);
    assert.deepEqual(normalized.document.pageSetups[0].plotSettings, DEFAULT_DRAWING_PLOT_SETTINGS);

    const normalizedVersion2 = normalizeLcadEnvelope({
        format: 'lumcad',
        formatVersion: 2,
        document: legacyDocument,
    });
    assert.equal(normalizedVersion2.formatVersion, 2);
    assert.deepEqual(normalizedVersion2.document.layouts[0].plotSettings, DEFAULT_DRAWING_PLOT_SETTINGS);
    assert.deepEqual(normalizedVersion2.document.pageSetups[0].plotSettings, DEFAULT_DRAWING_PLOT_SETTINGS);
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
            plotSettings: {
                area: { mode: 'extents' },
                scale: { mode: 'fixed', denominator: 50 },
                style: { colorMode: 'grayscale', plotLineweights: false },
                quality: { mode: 'raster', rasterDpi: 600, imageDpi: 300, jpegQuality: 0.75 },
            },
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
    assert.equal(normalized.document.layouts[0].plotSettings.scale.denominator, 50);
    assert.equal(normalized.document.layouts[0].plotSettings.style.colorMode, 'grayscale');
    assert.deepEqual(normalized.document.layouts[0].viewports[0], {
        id: 'viewport-roof',
        name: '',
        hiddenLayerIds: ['references'],
        locked: false,
        viewRotation: 0,
        clipBoundary: null,
        visualSettings: { style: 'normal', showLineweights: true },
        annotationSettings: { showText: true, showDimensions: true, dimensionTextSizeMm: 3 },
        layerOverrides: [],
        x: 20,
        y: 25,
        width: 210,
        height: 140,
        modelViewBox: { x: -5, y: -2, width: 30, height: 20 },
    });
});

test('preserves layer and ByLayer object transparency in the document envelope', () => {
    const document = createLcadDocument({ name: 'Transparency' });
    document.content.layers[0].transparency = 45;
    document.content.entities = [{
        id: 'opaque-line', type: 'line', layerId: 'geometry',
        x1: 0, y1: 0, x2: 1, y2: 1, transparency: 0,
    }];

    const normalized = normalizeLcadEnvelope(createLcadEnvelope(document));
    assert.equal(normalized.document.content.layers[0].transparency, 45);
    assert.equal(normalized.document.content.entities[0].transparency, 0);
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
