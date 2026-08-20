import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import {
    LCAD_MANIFEST_PATH,
    createLcadArchive,
    isZipArchive,
    readLcadArchive,
} from './lcadArchive.js';
import { createLcadDocument, createLcadEnvelope } from './lcadDocument.js';
import {
    createDrawingLayout,
    createDrawingPageSetup,
    createDrawingViewport,
} from './drawingLayouts.js';

const IMAGE_BYTES = Uint8Array.from([0, 1, 2, 3, 254, 255]);
const IMAGE_DATA_URL = 'data:image/png;base64,AAECA/7/';

test('.lcad is a standard ZIP with a manifest and separate image assets', () => {
    const envelope = createLcadEnvelope({
        ...createLcadDocument({ name: 'Archive plan' }),
        assets: [{
            id: 'asset/roof 1',
            name: 'roof.png',
            mimeType: 'image/png',
            width: 640,
            height: 480,
            link: IMAGE_DATA_URL,
        }],
    }, new Date('2026-08-12T10:00:00.000Z'));

    const archive = createLcadArchive(envelope);
    assert.equal(isZipArchive(archive), true);
    const files = unzipSync(archive);
    const manifest = JSON.parse(strFromU8(files[LCAD_MANIFEST_PATH]));
    const asset = manifest.document.assets[0];

    assert.equal(manifest.formatVersion, 2);
    assert.equal(asset.link, undefined);
    assert.equal(asset.path, 'assets/0001-asset-roof-1.png');
    assert.deepEqual(files[asset.path], IMAGE_BYTES);
});

test('.lcad ZIP assets are restored as in-memory data URLs', () => {
    const source = createLcadEnvelope({
        ...createLcadDocument({ name: 'Round trip' }),
        assets: [{
            id: 'image-1',
            name: 'reference.png',
            mimeType: 'image/png',
            width: 10,
            height: 5,
            link: IMAGE_DATA_URL,
        }],
    });

    const restored = readLcadArchive(createLcadArchive(source));
    assert.equal(restored.document.name, 'Round trip');
    assert.equal(restored.document.assets[0].link, IMAGE_DATA_URL);
    assert.equal(restored.document.assets[0].path, undefined);
});

test('.lcad ZIP round-trips layouts and viewports', () => {
    const document = createLcadDocument({ name: 'Layout archive' });
    document.layouts = [createDrawingLayout({
        id: 'layout-a2',
        name: 'Roof plan',
        format: 'A2',
        plotSettings: {
            area: { mode: 'extents' },
            scale: { mode: 'fixed', denominator: 100 },
            style: { colorMode: 'monochrome', plotLineweights: false },
            quality: { mode: 'vector', imageDpi: 600 },
        },
        viewports: [createDrawingViewport({
            id: 'viewport-main',
            rect: { x: 12, y: 18, width: 300, height: 200 },
            modelViewBox: { x: 1, y: 2, width: 24, height: 16 },
        })],
    })];

    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document)));
    assert.equal(restored.document.layouts[0].format, 'A2');
    assert.equal(restored.document.layouts[0].plotSettings.scale.denominator, 100);
    assert.equal(restored.document.layouts[0].plotSettings.style.colorMode, 'monochrome');
    assert.equal(restored.document.layouts[0].viewports[0].id, 'viewport-main');
    assert.deepEqual(restored.document.layouts[0].viewports[0].modelViewBox, {
        x: 1,
        y: 2,
        width: 24,
        height: 16,
    });
});

test('version 2 archives preserve rich text, every dimension family, page setups, and viewport overrides', () => {
    const document = createLcadDocument({ name: 'Production annotations' });
    document.content.textStyles = [
        ...document.content.textStyles,
        {
            id: 'text-style-notes',
            name: 'Notes',
            fontFamily: 'technical',
            fontSize: 0.45,
            fontWeight: 700,
            fontStyle: 'italic',
            underline: false,
            strikethrough: false,
            lineHeight: 1.35,
        },
    ];
    document.content.activeTextStyleId = 'text-style-notes';
    document.content.entities = [
        { id: 'line-a', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 4, y2: 0 },
        { id: 'line-b', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 0, y2: 3 },
        { id: 'circle-a', type: 'circle', layerId: 'geometry', cx: 8, cy: 4, r: 2 },
        {
            id: 'arc-a', type: 'arc', layerId: 'geometry', cx: 12, cy: 4, r: 2,
            startAngle: 0, endAngle: Math.PI / 2, counterClockwise: true,
        },
        {
            id: 'note-a', type: 'text', layerId: 'geometry', x: 1, y: 5, width: 6, height: 2,
            text: 'Roof note', textMode: 'multiline', wrapMode: 'character', textStyleId: 'text-style-notes',
            runs: [
                { text: 'Roof ', marks: { bold: true, color: '#336699' } },
                { text: 'note', marks: { underline: true, fontFamily: 'serif' } },
            ],
        },
        {
            id: 'dim-linear', type: 'linearDimension', layerId: 'geometry', sourceId: 'line-a',
            measurementMode: 'rotated', dimensionAngle: Math.PI / 6, offset: 0.8,
            dimensionFormat: {
                precision: 3,
                prefix: 'L=',
                tolerance: { mode: 'deviation', upper: 0.002, lower: 0.001, precision: 3 },
                alternateUnits: { enabled: true, unit: 'mm', precision: 1 },
                inspection: { enabled: true, label: 'A', rate: '100%' },
            },
        },
        {
            id: 'dim-radial', type: 'radialDimension', layerId: 'geometry', sourceId: 'circle-a',
            mode: 'joggedRadius', angle: 0.4, jogCenter: { x: 6, y: 4 }, jogPoint: { x: 8, y: 5 },
        },
        {
            id: 'dim-angular', type: 'angularDimension', layerId: 'geometry',
            sourceIds: ['line-a', 'line-b'], sourcePickPoints: [{ x: 4, y: 0 }, { x: 0, y: 3 }], radius: 1.5,
        },
        { id: 'dim-arc', type: 'arcLengthDimension', layerId: 'geometry', sourceId: 'arc-a', offset: 0.5 },
        {
            id: 'dim-ordinate', type: 'ordinateDimension', layerId: 'geometry', sourceId: 'circle-a',
            axis: 'y', origin: { x: 0, y: 0 }, leaderPoint: { x: 9, y: 7 },
        },
        { id: 'mark-center', type: 'centerMark', layerId: 'geometry', sourceId: 'circle-a', size: 0.4, extension: 0.2 },
    ];
    document.pageSetups = [createDrawingPageSetup({
        id: 'setup-custom',
        name: 'Custom production',
        format: 'CUSTOM',
        customPaperSize: { width: 610, height: 330 },
        margins: { top: 8, right: 9, bottom: 10, left: 11 },
        plotSettings: {
            area: { mode: 'window', window: { x: 1, y: 2, width: 20, height: 10 } },
            scale: { mode: 'fixed', denominator: 200, centered: false, offsetMm: { x: 4, y: 5 } },
            style: { colorMode: 'grayscale', plotLineweights: false },
            quality: { mode: 'raster', rasterDpi: 600, imageDpi: 450, jpegQuality: 0.8 },
        },
    })];
    document.layouts = [createDrawingLayout({
        id: 'layout-production',
        name: 'Production',
        format: 'CUSTOM',
        customPaperSize: { width: 610, height: 330 },
        margins: { top: 8, right: 9, bottom: 10, left: 11 },
        plotSettings: {
            area: { mode: 'layout' },
            scale: { mode: 'fit', centered: true },
            style: { colorMode: 'asDisplayed', plotLineweights: true },
            quality: { mode: 'vector', rasterDpi: 300, imageDpi: 600, jpegQuality: 0.9 },
        },
        pageSetupId: 'setup-custom',
        paperEntities: [
            {
                id: 'paper-note', type: 'text', layerId: 'geometry', x: 20, y: 20, width: 80, height: 12,
                text: 'Issue for construction', textMode: 'singleLine', wrapMode: 'none', fontSize: 4,
            },
            { id: 'paper-line', type: 'line', layerId: 'geometry', x1: 20, y1: 35, x2: 100, y2: 35 },
        ],
        viewports: [createDrawingViewport({
            id: 'viewport-production',
            name: 'Roof',
            rect: { x: 25, y: 30, width: 280, height: 180 },
            modelViewBox: { x: -2, y: -1, width: 28, height: 18 },
            hiddenLayerIds: ['references'],
            locked: true,
            viewRotation: 15,
            clipBoundary: {
                type: 'polygon',
                points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.85, y: 1 }, { x: 0.1, y: 0.8 }],
            },
            visualSettings: { style: 'monochrome', showLineweights: false },
            annotationSettings: { showText: false, showDimensions: true, dimensionTextSizeMm: 4.5 },
            layerOverrides: [{ layerId: 'geometry', color: '#ff0000', lineType: 'dashed', lineWeight: 3 }],
        })],
    })];

    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document))).document;
    assert.equal(restored.content.activeTextStyleId, 'text-style-notes');
    assert.equal(restored.content.textStyles.find(style => style.id === 'text-style-notes').fontFamily, 'technical');
    assert.deepEqual(restored.content.entities.find(entity => entity.id === 'note-a').runs, [
        { text: 'Roof ', marks: { bold: true, color: '#336699' } },
        { text: 'note', marks: { underline: true, fontFamily: 'serif' } },
    ]);
    assert.deepEqual(
        restored.content.entities.filter(entity => entity.id.startsWith('dim-') || entity.id === 'mark-center')
            .map(entity => entity.type),
        ['linearDimension', 'radialDimension', 'angularDimension', 'arcLengthDimension', 'ordinateDimension', 'centerMark'],
    );
    const linear = restored.content.entities.find(entity => entity.id === 'dim-linear');
    assert.equal(linear.dimensionFormat.tolerance.mode, 'deviation');
    assert.equal(linear.dimensionFormat.alternateUnits.unit, 'mm');
    assert.equal(linear.dimensionFormat.inspection.label, 'A');
    assert.deepEqual(restored.content.entities.find(entity => entity.id === 'dim-angular').sourceIds, ['line-a', 'line-b']);
    assert.equal(restored.pageSetups[0].id, 'setup-custom');
    assert.equal(restored.pageSetups[0].plotSettings.area.mode, 'window');
    assert.equal(restored.pageSetups[0].plotSettings.quality.rasterDpi, 600);
    assert.equal(restored.layouts[0].plotSettings.area.mode, 'layout');
    assert.equal(restored.layouts[0].plotSettings.quality.imageDpi, 600);
    assert.equal(restored.layouts[0].paperEntities[0].text, 'Issue for construction');
    const viewport = restored.layouts[0].viewports[0];
    assert.equal(viewport.locked, true);
    assert.equal(viewport.viewRotation, 15);
    assert.equal(viewport.clipBoundary.points.length, 4);
    assert.deepEqual(viewport.visualSettings, { style: 'monochrome', showLineweights: false });
    assert.equal(viewport.annotationSettings.dimensionTextSizeMm, 4.5);
    assert.deepEqual(viewport.layerOverrides, [{
        layerId: 'geometry', color: '#ff0000', lineType: 'dashed', lineWeight: 3,
    }]);
});

test('percent-encoded Unicode SVG assets keep their exact UTF-8 content', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>LUMÉOL</text></svg>';
    const source = createLcadEnvelope({
        ...createLcadDocument({ name: 'SVG reference' }),
        assets: [{
            id: 'logo',
            name: 'logo.svg',
            mimeType: 'image/svg+xml',
            width: 100,
            height: 40,
            link: `data:image/svg+xml,${encodeURIComponent(svg)}`,
        }],
    });

    const restored = readLcadArchive(createLcadArchive(source));
    const encoded = restored.document.assets[0].link.split(',')[1];
    assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), svg);
});

test('unreferenced files in an .lcad ZIP are rejected', () => {
    const envelope = createLcadEnvelope(createLcadDocument({ name: 'Unexpected asset' }));
    const archive = zipSync({
        [LCAD_MANIFEST_PATH]: strToU8(JSON.stringify(envelope)),
        'assets/orphan.png': IMAGE_BYTES,
    });

    assert.throws(
        () => readLcadArchive(archive),
        error => error.translationKey === 'storage.invalidArchiveEntry',
    );
});

test('a malformed asset list in the manifest is rejected', () => {
    const envelope = createLcadEnvelope(createLcadDocument({ name: 'Malformed assets' }));
    envelope.document.assets = {};
    const archive = zipSync({
        [LCAD_MANIFEST_PATH]: strToU8(JSON.stringify(envelope)),
    });

    assert.throws(
        () => readLcadArchive(archive),
        error => error.translationKey === 'storage.invalidAsset',
    );
});

test('non-ZIP .lcad data is rejected', () => {
    assert.throws(
        () => readLcadArchive(new TextEncoder().encode('{"format":"lumcad"}')),
        error => error.translationKey === 'storage.invalidArchive',
    );
});

test('invalid archive bytes fail with a localized storage error', () => {
    assert.throws(
        () => readLcadArchive(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00])),
        error => error.translationKey === 'storage.invalidArchive',
    );
});
