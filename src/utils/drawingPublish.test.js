import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';

import {
    createDrawingDwfxPackage,
    getDrawingSvgRelativeMatrix,
    getAutomaticDrawingPublishPath,
    getDrawingImageTargetSize,
    getDrawingRasterSize,
    inspectDrawingDwfxPackage,
    normalizePublishQuality,
    resolveDrawingNonScalingStroke,
    safeDrawingPublishFilename,
} from './drawingPublish.js';

const PIXEL_PNG = new Uint8Array(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lb/LAAAAAElFTkSuQmCC',
    'base64',
));

test('publish filenames and unattended paths preserve safe platform paths', () => {
    assert.equal(safeDrawingPublishFilename('Roof / plan', 'pdf'), 'Roof - plan.pdf');
    assert.equal(safeDrawingPublishFilename('Roof.dwfx', 'dwfx'), 'Roof.dwfx');
    assert.equal(getAutomaticDrawingPublishPath('/plans/été.lcad', 'pdf'), '/plans/été.pdf');
    assert.equal(getAutomaticDrawingPublishPath('C:\\Plans\\Roof.LCAD', 'dwfx'), 'C:\\Plans\\Roof.dwfx');
    assert.equal(getAutomaticDrawingPublishPath('/plans/roof.dwg', 'pdf'), null);
    assert.throws(() => safeDrawingPublishFilename('Roof', 'dwf'), /Unsupported/);
});

test('raster sizing respects requested DPI and hard canvas budgets', () => {
    assert.deepEqual(getDrawingRasterSize({ format: 'A4', orientation: 'landscape' }, 300), {
        dpi: 300,
        height: 2480,
        requestedDpi: 300,
        width: 3508,
    });
    const a0 = getDrawingRasterSize({ format: 'A0', orientation: 'landscape' }, 1200);
    assert.ok(a0.dpi < 1200);
    assert.ok(a0.width <= 16_384);
    assert.ok(a0.height <= 16_384);
    assert.ok(a0.width * a0.height <= 64_000_000 + a0.width + a0.height);
});

test('publish quality clamps unsafe values and defaults to vector output', () => {
    assert.deepEqual(normalizePublishQuality(null), {
        mode: 'vector', rasterDpi: 300, imageDpi: 300, jpegQuality: 0.9,
    });
    assert.deepEqual(normalizePublishQuality({
        mode: 'raster', rasterDpi: 10_000, imageDpi: 1, jpegQuality: 5,
    }), {
        mode: 'raster', rasterDpi: 1200, imageDpi: 72, jpegQuality: 1,
    });
});

test('embedded image DPI downsamples but never upscales source bitmaps', () => {
    assert.deepEqual(getDrawingImageTargetSize({
        heightMm: 12.7,
        sourceHeight: 2_000,
        sourceWidth: 4_000,
        widthMm: 25.4,
    }, 300), { height: 150, width: 300 });
    assert.deepEqual(getDrawingImageTargetSize({
        heightMm: 50,
        sourceHeight: 40,
        sourceWidth: 80,
        widthMm: 100,
    }, 1_200), { height: 40, width: 80 });
});

test('non-scaling SVG strokes are converted from screen pixels to paper millimetres', () => {
    assert.deepEqual(resolveDrawingNonScalingStroke({
        dashArray: '6px, 4px',
        dashOffset: '2px',
        strokeWidth: '1px',
        transformScale: 4,
    }), {
        dashArray: '0.396875 0.264583',
        dashOffset: '0.132292',
        strokeWidth: '0.066146',
    });
    assert.equal(resolveDrawingNonScalingStroke({ strokeWidth: 1, transformScale: 0 }), null);
});

test('nested SVG lineweights use screen matrices so viewport viewBox scaling is preserved', () => {
    const calls = [];
    const matrix = (name, relative) => ({
        inverse() {
            calls.push(`inverse:${name}`);
            return {
                multiply(other) {
                    calls.push(`multiply:${other.name}`);
                    return relative;
                },
            };
        },
        name,
    });
    const relative = { a: 0.006, b: 0, c: 0, d: 0.006, e: 12, f: 18 };
    const element = {
        getCTM: () => matrix('element-ctm', { a: 1, d: 1 }),
        getScreenCTM: () => matrix('element-screen'),
    };
    const root = {
        getCTM: () => matrix('root-ctm'),
        getScreenCTM: () => matrix('root-screen', relative),
    };
    assert.equal(getDrawingSvgRelativeMatrix(element, root), relative);
    assert.deepEqual(calls, ['inverse:root-screen', 'multiply:element-screen']);
    assert.equal(resolveDrawingNonScalingStroke({
        strokeWidth: '10px',
        transformScale: 0.006,
    }).strokeWidth, '440.972222');
    assert.equal(resolveDrawingNonScalingStroke({
        strokeWidth: '10px',
        transformScale: 1,
    }).strokeWidth, '2.645833');
});

test('DWFx output is a deterministic multi-sheet OPC/XPS and Autodesk ePlot package', () => {
    const pages = [
        { id: 'a', name: 'A4 portrait', paper: { width: 210, height: 297 }, png: PIXEL_PNG },
        { id: 'b', name: 'Custom & wide', paper: { width: 610, height: 330 }, png: PIXEL_PNG },
    ];
    const first = createDrawingDwfxPackage(pages, { title: 'Roof & façade' });
    const second = createDrawingDwfxPackage(pages, { title: 'Roof & façade' });
    assert.deepEqual(first, second);
    const inspection = inspectDrawingDwfxPackage(first);
    assert.equal(inspection.pageCount, 2);
    assert.ok(inspection.files.includes('DWFDocumentSequence.dwfseq'));
    assert.ok(inspection.files.includes('_rels/DWFDocumentSequence.dwfseq.rels'));
    assert.ok(inspection.files.includes(`dwf/documents/4C554D43-4144-4000-8000-000000000001/manifest.xml`));
    assert.equal(inspection.files.filter(path => path.endsWith('/descriptor.xml')).length, 2);
    assert.equal(inspection.files.filter(path => path.endsWith('/page.png')).length, 2);
    const files = unzipSync(first);
    assert.match(strFromU8(files['[Content_Types].xml']), /application\/vnd[.]adsk-package[.]dwfx-dwfdocumentsequence[+]xml/);
    assert.match(strFromU8(files['_rels/.rels']), /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/documentsequence/);
    assert.match(strFromU8(files['DWFDocumentSequence.dwfseq']), /ManifestReference/);
    const manifestPath = inspection.files.find(path => path.endsWith('/manifest.xml'));
    assert.match(strFromU8(files[manifestPath]), /application\/vnd[.]adsk-package[.]dwfx-fixedpage[+]xml/);
    assert.match(strFromU8(files[manifestPath]), /com[.]autodesk[.]dwf[.]ePlot/);
    const descriptorPath = inspection.files.find(path => path.endsWith('/descriptor.xml'));
    const descriptor = strFromU8(files[descriptorPath]);
    assert.match(descriptor, /DWF-ePlot:1[.]2/);
    assert.match(descriptor, /objectId="[A-Za-z0-9+/]{22}"/);
    assert.match(descriptor, /transform="0[.]010416667 0 0 0 0 0[.]010416667 0 0 0 0 1 0 0 0 0 1"/);
    assert.match(descriptor, /role="2d graphics extension"/);
    assert.match(descriptor, /graphics2dextensionresource/);
    assert.match(descriptor, /role="raster overlay"/);
    assert.match(descriptor, /originalExtents="0 0 1 1"/);
    assert.match(descriptor, /colorDepth="32"/);
    assert.match(descriptor, /transform="8[.]267717 0 0 0 0 11[.]692913 0 0 0 0 1 0 0 0 0 1"/);
    assert.doesNotMatch(descriptor, /parentObjectId=/);
    const descriptorRelationshipsPath = inspection.files.find(path => path.endsWith('/_rels/descriptor.xml.rels'));
    const descriptorRelationships = strFromU8(files[descriptorRelationshipsPath]);
    assert.match(descriptorRelationships, /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/requiredresource/);
    assert.match(descriptorRelationships, /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/graphics2dextensionresource/);
    assert.match(descriptorRelationships, /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/rasteroverlayresource/);
    const fixedPageRelationshipsPath = inspection.files.find(path => path.endsWith('/_rels/FixedPage.fpage.rels'));
    const fixedPageRelationships = strFromU8(files[fixedPageRelationshipsPath]);
    assert.match(fixedPageRelationships, /schemas[.]microsoft[.]com\/xps\/2005\/06\/required-resource/);
    const descriptorTargets = [...descriptorRelationships.matchAll(/Target="([^"]+page[.]png)"/g)].map(match => match[1]);
    const fixedPageTarget = /Target="([^"]+page[.]png)"/.exec(fixedPageRelationships)?.[1];
    assert.deepEqual(descriptorTargets, [fixedPageTarget, fixedPageTarget]);
    const fixedPagePath = inspection.files.find(path => path.endsWith('/FixedPage.fpage'));
    const fixedPage = strFromU8(files[fixedPagePath]);
    assert.match(fixedPage, /<Canvas Name="dwfresource_1" RenderTransform="1,0,0,1,0,0"/);
    assert.match(fixedPage, /<Canvas Name="LUMCAD_1_1"><Path Name="LUMCAD_1_2"[^>]+RenderTransform="793[.]700787,0,0,1122[.]519685,0,0"/);
    assert.match(fixedPage, /ImageSource="page[.]png"/);
    assert.match(fixedPage, /Viewbox="0,0,1,1"/);
    const extensionPath = inspection.files.find(path => path.endsWith('/graphics.w2x.xml'));
    const extension = strFromU8(files[extensionPath]);
    assert.match(extension, /<W2X VersionMajor="7" VersionMinor="0" NamePrefix="LUMCAD_1_"/);
    assert.match(extension, /<View refName="LUMCAD_1_1"/);
    assert.match(extension, /<RenditionSync refName="LUMCAD_1_2"/);
    for (const path of inspection.files.filter(name => !name.endsWith('.png'))) {
        const xml = strFromU8(files[path]);
        for (const match of xml.matchAll(/(?:Target|Source|href|ImageSource)="(\/[^"?]+)(?:[?][^"]*)?"/g)) {
            assert.ok(files[match[1].slice(1)], `${path} references missing OPC part ${match[1]}`);
        }
    }
});

test('DWFx packaging rejects invalid paper and fake images before writing', () => {
    assert.throws(() => createDrawingDwfxPackage([], {}), /at least one page/);
    assert.throws(() => createDrawingDwfxPackage([{
        paper: { width: 0, height: 297 }, png: PIXEL_PNG,
    }]), /paper/);
    assert.throws(() => createDrawingDwfxPackage([{
        paper: { width: 210, height: 297 }, png: Uint8Array.of(1, 2, 3),
    }]), /not a PNG/);
    assert.throws(() => createDrawingDwfxPackage([{
        paper: { width: 210, height: 297 }, png: Uint8Array.from([
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
    }]), /PNG header/);
});
