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
    assert.match(descriptor, /role="2d graphics extension"/);
    assert.match(descriptor, /graphics2dextensionresource/);
    assert.match(descriptor, /role="raster reference"/);
    const graphicScale = /<ePlot:GraphicResource[^>]+transform="([^"]+)"/.exec(descriptor)[1].split(' ').map(Number);
    assert.equal(graphicScale[0], graphicScale[5]);
    assert.ok(Math.abs(graphicScale[0] * 25_400 - 1) < 1e-12);
    assert.doesNotMatch(descriptor, /parentObjectId=/);
    const descriptorRelationshipsPath = inspection.files.find(path => path.endsWith('/_rels/descriptor.xml.rels'));
    const descriptorRelationships = strFromU8(files[descriptorRelationshipsPath]);
    assert.match(descriptorRelationships, /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/requiredresource/);
    assert.match(descriptorRelationships, /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/graphics2dextensionresource/);
    assert.match(descriptorRelationships, /schemas[.]autodesk[.]com\/dwfx\/2007\/relationships\/rasterreferenceresource/);
    const fixedPageRelationshipsPath = inspection.files.find(path => path.endsWith('/_rels/FixedPage.fpage.rels'));
    const fixedPageRelationships = strFromU8(files[fixedPageRelationshipsPath]);
    assert.match(fixedPageRelationships, /schemas[.]microsoft[.]com\/xps\/2005\/06\/required-resource/);
    const descriptorTargets = [...descriptorRelationships.matchAll(/Target="([^"]+page[.]png)"/g)].map(match => match[1]);
    const fixedPageTarget = /Target="([^"]+page[.]png)"/.exec(fixedPageRelationships)?.[1];
    assert.deepEqual(descriptorTargets, [fixedPageTarget, fixedPageTarget]);
    const fixedPagePath = inspection.files.find(path => path.endsWith('/FixedPage.fpage'));
    const fixedPage = strFromU8(files[fixedPagePath]);
    const pageScale = /<Canvas Name="dwfresource_1" RenderTransform="([^"]+)"/.exec(fixedPage)[1].split(',').map(Number);
    assert.equal(pageScale[0], pageScale[3]);
    assert.ok(Math.abs(pageScale[0] * 25_400 - 96) < 1e-12);
    assert.match(fixedPage, /<Path Name="LUMCAD_1_1" Fill="[{]StaticResource LUMCAD_IMAGE[}]" Data="M0,0L210000,0 210000,297000 0,297000Z"/);
    const dictionary = strFromU8(files[inspection.files.find(path => path.endsWith('/dictionary.xml'))]);
    assert.match(fixedPage, /ResourceDictionary Source="dictionary[.]xml"/);
    assert.match(dictionary, /ImageSource="page[.]png"/);
    assert.match(dictionary, /Viewbox="0,0,1,1"/);
    const extensionPath = inspection.files.find(path => path.endsWith('/graphics.w2x.xml'));
    const extension = strFromU8(files[extensionPath]);
    assert.match(extension, /<W2X VersionMajor="7" VersionMinor="0" NamePrefix="LUMCAD_1_"/);
    assert.doesNotMatch(extension, /<Viewport|<View /);
    assert.match(extension, /<PNG_Group4_Image refName="LUMCAD_1_1" Format="12"/);
    assert.match(extension, /Width="1" Height="1" Area="0,0,210000,297000"/);
    assert.match(extension, /<Units[^>]+Transform="25400,0,0,0,0,25400,/);
    const imageRef = /<PNG_Group4_Image[^>]+Ref="([^"]+)"/.exec(extension)?.[1];
    assert.equal(imageRef, 'page.png');
    assert.equal(fixedPageTarget, `/${extensionPath.replace('graphics.w2x.xml', imageRef)}`);
    assert.doesNotMatch(descriptor, /raster overlay/);
    for (const path of inspection.files.filter(name => !name.endsWith('.png'))) {
        const xml = strFromU8(files[path]);
        for (const match of xml.matchAll(/(?:Target|Source|href|ImageSource|Ref)="(\/[^"?]+)(?:[?][^"]*)?"/g)) {
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

test('every DWFx sheet declares the paper units required by Autodesk cloud extraction', () => {
    const pages = [
        { name: 'Portrait', paper: { width: 210, height: 297 }, png: PIXEL_PNG },
        { name: 'Landscape', paper: { width: 297, height: 210 }, png: PIXEL_PNG },
    ];
    const files = unzipSync(createDrawingDwfxPackage(pages));
    const descriptors = Object.keys(files).filter(path => path.endsWith('/descriptor.xml'));
    assert.equal(descriptors.length, pages.length);
    for (const [index, path] of descriptors.entries()) {
        const descriptor = strFromU8(files[path]);
        const properties = /<ePlot:Properties>([\s\S]*?)<\/ePlot:Properties>/.exec(descriptor)?.[1];
        assert.ok(properties, 'A locally readable XPS sheet can still fail Autodesk extraction without unit properties.');
        const units = Object.fromEntries([...properties.matchAll(/name="([^"]+)" value="([^"]+)"/g)]
            .map(([, name, value]) => [name, value]));
        assert.equal(units._UnitLinear, 'inch');
        assert.equal(units._UnitArea, 'square_inch');
        assert.equal(units._UnitVolume, 'cubic_inch');
        assert.equal(units._UnitAngular, 'degree');
        const extension = strFromU8(files[path.replace('descriptor.xml', 'graphics.w2x.xml')]);
        assert.match(extension, /<Units[^>]+Label="inches"/);
        const logicalScale = /<Units[^>]+Transform="([^"]+)"/.exec(extension)[1].split(',').map(Number);
        const imageArea = /<PNG_Group4_Image[^>]+Area="([^"]+)"/.exec(extension)[1].split(',').map(Number);
        assert.equal(logicalScale[0], logicalScale[5]);
        assert.ok(Math.abs(imageArea[2] / logicalScale[0] * 25.4 - pages[index].paper.width) < 0.001);
        assert.ok(Math.abs(imageArea[3] / logicalScale[5] * 25.4 - pages[index].paper.height) < 0.001);
    }
});

test('DWFx image hints, logical units and XPS placement describe the same rectangular page', () => {
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAF0lEQVR4nGP4z8DAAMIM////B7GA8D8ATsYI+GrYM84AAAAASUVORK5CYII=', 'base64'));
    const files = unzipSync(createDrawingDwfxPackage([{ name: 'Unequal axes', paper: { width: 200, height: 100 }, png }]));
    const xml = suffix => strFromU8(files[Object.keys(files).find(path => path.endsWith(suffix))]);
    const page = xml('/FixedPage.fpage'); const extension = xml('/graphics.w2x.xml'); const descriptor = xml('/descriptor.xml');
    const placement = /<Canvas[^>]+RenderTransform="([^"]+)"/.exec(page)[1].split(',').map(Number);
    const units = /<Units[^>]+Transform="([^"]+)"/.exec(extension)[1].split(',').map(Number);
    const graphic = /<ePlot:GraphicResource[^>]+transform="([^"]+)"/.exec(descriptor)[1].split(' ').map(Number);
    assert.ok(Math.abs(placement[0] * 200_000 - 200 / 25.4 * 96) < 1e-5);
    assert.ok(Math.abs(placement[3] * 100_000 - 100 / 25.4 * 96) < 1e-5);
    assert.ok(Math.abs(units[0] * graphic[0] - 1) < 1e-5);
    assert.ok(Math.abs(units[5] * graphic[5] - 1) < 1e-5);
    assert.ok(Math.abs(placement[0] - graphic[0] * 96) < 1e-4);
    assert.ok(Math.abs(placement[3] - graphic[5] * 96) < 1e-4);
    assert.equal(placement[0], placement[3]);
    assert.equal(graphic[0], graphic[5]);
    const dictionary = xml('/dictionary.xml');
    const brush = /<ImageBrush[^>]+Transform="([^"]+)"/.exec(dictionary)[1].split(',').map(Number);
    // Pixel aspect ratio is deliberately different from paper aspect ratio.
    // Stretch the brush, never the page's WHIP coordinate system.
    assert.ok(Math.abs(brush[0] * 2 * placement[0] - 200 / 25.4 * 96) < 1e-5);
    assert.ok(Math.abs(brush[3] * 3 * placement[3] - 100 / 25.4 * 96) < 1e-5);
    assert.match(extension, /PNG_Group4_Image[^>]+Width="2" Height="3" Area="0,0,200000,100000"/);
    const name = /<PNG_Group4_Image refName="([^"]+)"/.exec(extension)[1];
    assert.ok(page.includes(`<Path Name="${name}"`));
    assert.match(descriptor, /<ePlot:Resource role="raster reference"/);
    assert.doesNotMatch(descriptor, /<ePlot:ImageResource/);
});

test('DWFx streaming graphics remain a standalone XAML fragment with accurate UTF-8 resource sizes', () => {
    const files = unzipSync(createDrawingDwfxPackage([{ name: 'Étage — été', paper: { width: 210, height: 297 }, png: PIXEL_PNG }]));
    const part = suffix => files[Object.keys(files).find(path => path.endsWith(suffix))];
    const page = strFromU8(part('/FixedPage.fpage'));
    const descriptor = strFromU8(part('/descriptor.xml'));
    const fragment = /<Canvas Name="dwfresource_1"[^>]*>([\s\S]*)<\/Canvas><\/FixedPage>/.exec(page)[1];
    assert.match(fragment, /^<Canvas xmlns="http:\/\/schemas[.]microsoft[.]com\/xps\/2005\/06" RenderTransform="1,0,0,1,0,0">/);
    assert.equal(Number(/<ePlot:GraphicResource[^>]+size="([0-9]+)"/.exec(descriptor)[1]), new TextEncoder().encode(fragment).length);
    assert.equal(Number(/<ePlot:Resource role="2d graphics extension"[^>]+size="([0-9]+)"/.exec(descriptor)[1]), part('/graphics.w2x.xml').length);
    assert.equal((fragment.match(/<Canvas(?: |>|\/)/g) || []).length, 1);
    assert.doesNotMatch(fragment, /<Canvas[^>]+Name=/);
});

test('DWFx image fills resolve through sheet-local dictionaries and WHIP-compatible path syntax', () => {
    const files = unzipSync(createDrawingDwfxPackage([
        { name: 'First', paper: { width: 210, height: 297 }, png: PIXEL_PNG },
        { name: 'Second', paper: { width: 297, height: 210 }, png: PIXEL_PNG },
    ]));
    const types = strFromU8(files['[Content_Types].xml']);
    for (const path of Object.keys(files).filter(name => name.endsWith('/FixedPage.fpage'))) {
        const directory = path.slice(0, path.lastIndexOf('/'));
        const page = strFromU8(files[path]);
        const dictionaryPath = `${directory}/dictionary.xml`;
        const dictionary = strFromU8(files[dictionaryPath]);
        const descriptor = strFromU8(files[`${directory}/descriptor.xml`]);
        const relationships = strFromU8(files[`${directory}/_rels/descriptor.xml.rels`]);
        const key = /Fill="\{StaticResource ([^}]+)\}"/.exec(page)?.[1];
        assert.ok(key);
        assert.ok(dictionary.includes(`x:Key="${key}"`));
        assert.ok(types.includes(`PartName="/${dictionaryPath}" ContentType="application/vnd.ms-package.xps-resourcedictionary+xml"`));
        assert.match(relationships, /relationships\/graphics2ddictionaryresource/);
        assert.ok(relationships.includes(`Target="/${dictionaryPath}"`));
        assert.equal(Number(/role="2d graphics dictionary"[^>]+size="([0-9]+)"/.exec(descriptor)[1]), files[dictionaryPath].length);
        assert.doesNotMatch(page, /<ImageBrush|<Path.Fill/);
        for (const [, data] of page.matchAll(/Data="([^"]+)"/g)) {
            // Autodesk's WHIP parser interprets whitespace before a new command
            // as another coordinate pair, unlike general-purpose XPS readers.
            assert.doesNotMatch(data, /\s+[MLZmlz]/);
        }
    }
});
