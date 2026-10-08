import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadBrowserBlob, getBrowserDownload, dismissBrowserDownload } from './browserDownload.js';

test('retry links retain their payload until dismissal and release replaced payloads', async () => {
    const original = globalThis.document;
    globalThis.document = { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } };
    try {
        downloadBrowserBlob(new Blob(['first export']), 'first.csv');
        const first = getBrowserDownload();
        assert.equal(await (await fetch(first.url)).text(), 'first export');
        downloadBrowserBlob(new Blob(['second export']), 'second.json');
        const second = getBrowserDownload();
        assert.notEqual(second.url, first.url);
        await assert.rejects(fetch(first.url));
        assert.equal(await (await fetch(second.url)).text(), 'second export');
        dismissBrowserDownload();
        assert.equal(getBrowserDownload(), null);
        await assert.rejects(fetch(second.url));
        dismissBrowserDownload();
    } finally {
        dismissBrowserDownload();
        if (original === undefined) delete globalThis.document;
        else globalThis.document = original;
    }
});
