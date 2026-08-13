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
import { createDrawingLayout, createDrawingViewport } from './drawingLayouts.js';

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

    assert.equal(manifest.formatVersion, 1);
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
        viewports: [createDrawingViewport({
            id: 'viewport-main',
            rect: { x: 12, y: 18, width: 300, height: 200 },
            modelViewBox: { x: 1, y: 2, width: 24, height: 16 },
        })],
    })];

    const restored = readLcadArchive(createLcadArchive(createLcadEnvelope(document)));
    assert.equal(restored.document.layouts[0].format, 'A2');
    assert.equal(restored.document.layouts[0].viewports[0].id, 'viewport-main');
    assert.deepEqual(restored.document.layouts[0].viewports[0].modelViewBox, {
        x: 1,
        y: 2,
        width: 24,
        height: 16,
    });
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
