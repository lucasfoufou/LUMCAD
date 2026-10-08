import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { readDrawingDwfxPackage, resolveDrawingPackagePart } from './drawingDwfxPackage.js';
import { createDrawingDwfxPackage } from './drawingPublish.js';
import { readBoundedZip } from './boundedZip.js';
const ns = 'http://schemas.microsoft.com/xps/2005/06';
function fixture() {
    return {
        '_rels/.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="${ns}/fixedrepresentation" Target="/seq.fdseq"/></Relationships>`),
        'seq.fdseq': strToU8(`<FixedDocumentSequence xmlns="${ns}"><DocumentReference Source="docs/a.fdoc"/></FixedDocumentSequence>`),
        'docs/a.fdoc': strToU8(`<FixedDocument xmlns="${ns}"><PageContent Source="../pages/two.fpage"/><PageContent Source="../pages/one.fpage"/></FixedDocument>`),
        'pages/one.fpage': strToU8(`<FixedPage xmlns="${ns}" Width="96" Height="192"/>`),
        'pages/two.fpage': strToU8(`<FixedPage xmlns="${ns}" Width="192" Height="96"/>`),
    };
}
test('DWFx reads referenced page order and XPS physical dimensions without trusting filenames', () => {
    const result = readDrawingDwfxPackage(zipSync(fixture()));
    assert.deepEqual(result.pages.map(page => page.path), ['pages/two.fpage', 'pages/one.fpage']);
    assert.ok(Math.abs(result.pages[0].widthMetres - .0508) < 1e-12);
    assert.ok(Math.abs(result.pages[1].widthMetres - .0254) < 1e-12);
    assert.throws(() => readDrawingDwfxPackage(zipSync(fixture()), { maxPages: 1 }), /dwfxLimit/);
});
test('OPC part resolution confines relative and encoded targets to the package', () => {
    assert.equal(resolveDrawingPackagePart('a/b/page.fpage', '../images/a%20b.png'), 'a/images/a b.png');
    for (const path of ['../../../escape', 'https://host/image.png', '//host/file', 'a%2fb', 'a%5cb', '%00', '/..', 'a#fragment', 'a?query']) {
        assert.throws(() => resolveDrawingPackagePart('a/page.fpage', path), /dwfxPart/);
    }
});
test('DWFx refuses malformed XML, entities, missing resources and invalid page sizes', () => {
    for (const text of ['<!DOCTYPE x [<!ENTITY a SYSTEM "file:///tmp/a">]><FixedPage/>', '<FixedPage', `<FixedPage xmlns="${ns}" Width="NaN" Height="96"/>`]) {
        const files = fixture(); files['pages/two.fpage'] = strToU8(text);
        assert.throws(() => readDrawingDwfxPackage(zipSync(files)), /dwfx/);
    }
    const missing = fixture(); delete missing['pages/two.fpage'];
    assert.throws(() => readDrawingDwfxPackage(zipSync(missing)), /dwfxPart/);
});
test('bounded ZIP checks CRC, declaration agreement, traversal and all resource ceilings', () => {
    const bytes = zipSync({ 'a.txt': strToU8('abc') }, { level: 0 });
    const corrupt = bytes.slice(); corrupt[35] ^= 1;
    assert.throws(() => readBoundedZip(corrupt), /zipInvalid/);
    for (const options of [{ maxBytes: 1 }, { maxEntries: 0 }, { maxEntryBytes: 2 }, { maxTotalBytes: 2 }]) assert.throws(() => readBoundedZip(bytes, options), /zipLimit/);
    assert.throws(() => readBoundedZip(zipSync({ '../escape': strToU8('bad') })), /zipInvalid/);
    const owned = readBoundedZip(bytes).get('a.txt'); owned[0] = 0;
    assert.equal(readBoundedZip(bytes).get('a.txt')[0], 97);
});

test('DWFx package reader accepts published ePlot/XPS packages with ordered physical paper sizes', () => {
    const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
    const bytes = createDrawingDwfxPackage([{ id: 'a', name: 'A4', paper: { width: 210, height: 297 }, png },
        { id: 'b', name: 'Wide', paper: { width: 610, height: 330 }, png }]);
    const result = readDrawingDwfxPackage(bytes);
    assert.equal(result.pages.length, 2);
    assert.ok(Math.abs(result.pages[0].widthMetres - .210) < 1e-8);
    assert.ok(Math.abs(result.pages[1].widthMetres - .610) < 1e-8);
});

test('DWFx accepts UTF-16 XPS XML and rejects external fixed representations', () => {
    const files = fixture();
    files['seq.fdseq'] = Uint8Array.from(Buffer.from('\ufeff<?xml version="1.0" encoding="utf-16"?>' + new TextDecoder().decode(files['seq.fdseq']), 'utf16le'));
    assert.equal(readDrawingDwfxPackage(zipSync(files)).pages.length, 2);
    files['_rels/.rels'] = strToU8(new TextDecoder().decode(files['_rels/.rels']).replace('Target="/seq.fdseq"', 'Target="/seq.fdseq" TargetMode="External"'));
    assert.throws(() => readDrawingDwfxPackage(zipSync(files)), /dwfxPart/);
});
