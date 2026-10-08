import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { DWFX_SOURCE_MIME, drawingDwfxDataUrl, drawingDwfxBytes } from './drawingDwfxSource.js';
import { createLcadDocument, createLcadEnvelope, normalizeLcadImageMimeType } from './lcadDocument.js';
import { createLcadArchive, readLcadArchive } from './lcadArchive.js';

test('DWFx source bytes survive normalized browser archives as a separate binary resource', () => {
    const bytes = zipSync({ 'source.xml': strToU8('<source/>') });
    const link = drawingDwfxDataUrl(bytes);
    const document = createLcadDocument({ name: 'DWFx source' });
    document.assets = [{ id: 'dwfx-source', name: 'plan.dwfx', width: 1, height: 1, mimeType: DWFX_SOURCE_MIME, link }];
    const archive = createLcadArchive(createLcadEnvelope(document));
    const files = unzipSync(archive); const path = Object.keys(files).find(name => name.endsWith('.dwfx'));
    assert.ok(path); assert.deepEqual(files[path], bytes);
    const loaded = readLcadArchive(archive).document.assets[0];
    assert.equal(loaded.mimeType, DWFX_SOURCE_MIME); assert.equal(loaded.id, 'dwfx-source');
    assert.deepEqual(drawingDwfxBytes(loaded.link), bytes);
    assert.equal(normalizeLcadImageMimeType(DWFX_SOURCE_MIME), null);
});

test('DWFx byte transport refuses invalid MIME, invalid base64 and non-package sources', () => {
    for (const link of ['data:image/png;base64,UEsDBA==', 'data:model/vnd.dwfx+xps;base64,!!!!', 'data:model/vnd.dwfx+xps;base64,YWJj']) {
        assert.throws(() => drawingDwfxBytes(link), /dwfxSource/);
    }
    assert.throws(() => drawingDwfxDataUrl(new Uint8Array([1,2,3,4])), /dwfxSource/);
});
