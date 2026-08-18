import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDrawingClipboardAdapter,
    createTauriDrawingClipboardBridge,
    normalizeClipboardValue,
} from './drawingClipboardAdapter.js';
import {
    createDrawingClipboardPayload,
    DRAWING_CLIPBOARD_MIME_TYPE,
} from './drawingClipboard.js';
import { createDefaultDrawingContent } from './drawingDocument.js';

test('clipboard adapter writes and reads all ClipboardItem flavours in priority order', async () => {
    const payload = testPayload();
    let written = [];
    const clipboard = {
        async write(items) { written = items; },
        async read() { return written; },
    };
    const adapter = createDrawingClipboardAdapter({
        navigatorObject: { clipboard },
        ClipboardItemClass: FakeClipboardItem,
        BlobClass: Blob,
    });

    const result = await adapter.write(payload);
    assert.equal(result.method, 'write');
    assert.deepEqual(new Set(written[0].types), new Set([
        `web ${DRAWING_CLIPBOARD_MIME_TYPE}`,
        'image/svg+xml',
        'text/plain',
    ]));
    assert.deepEqual(await adapter.read(), payload);
});

test('clipboard adapter deterministically uses text APIs when ClipboardItem is unavailable', async () => {
    let systemText = '';
    let itemWriteCalled = false;
    const adapter = createDrawingClipboardAdapter({
        navigatorObject: { clipboard: {
            async write() { itemWriteCalled = true; },
            async writeText(value) { systemText = value; },
            async readText() { return systemText; },
        } },
        ClipboardItemClass: null,
    });

    const payload = testPayload();
    assert.equal((await adapter.write(payload)).method, 'writeText');
    assert.equal(itemWriteCalled, false);
    assert.match(systemText, /^<\?xml[^>]*>\s*<svg\b/);
    assert.deepEqual(await adapter.read(), payload);
});

test('clipboard adapter falls back atomically to SVG text when WebKit rejects item formats', async () => {
    const attemptedTypes = [];
    let systemText = '';
    const unsupported = Object.assign(new Error('MIME type is not supported'), { name: 'NotSupportedError' });
    const adapter = createDrawingClipboardAdapter({
        navigatorObject: { clipboard: {
            async write(items) {
                attemptedTypes.push(...items[0].types);
                throw unsupported;
            },
            async writeText(value) { systemText = value; },
            async readText() { return systemText; },
        } },
        ClipboardItemClass: FakeClipboardItem,
        BlobClass: Blob,
    });

    const payload = testPayload();
    assert.equal((await adapter.write(payload)).method, 'writeText');
    assert.ok(attemptedTypes.includes('image/svg+xml'));
    assert.match(systemText, /<metadata id="lumcad-clipboard">/);
    assert.deepEqual(await adapter.read(), payload);
});

test('clipboard adapter uses isolated memory only when no OS API is available', async () => {
    const memoryClipboard = { formats: null };
    const adapter = createDrawingClipboardAdapter({ navigatorObject: {}, memoryClipboard });
    const payload = testPayload();
    assert.equal((await adapter.write(payload)).method, 'memory');
    assert.deepEqual(await adapter.read(), payload);

    const empty = createDrawingClipboardAdapter({ navigatorObject: {}, memoryClipboard: { formats: null } });
    await assert.rejects(empty.read(), error => error.drawingClipboardAdapterCode === 'clipboard-empty');
});

test('permission failures surface explicit codes and never use memory fallback', async () => {
    const denied = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
    const memoryClipboard = { formats: { 'text/plain': 'stale' } };
    const adapter = createDrawingClipboardAdapter({
        navigatorObject: { clipboard: {
            async writeText() { throw denied; },
            async readText() { throw denied; },
        } },
        ClipboardItemClass: null,
        memoryClipboard,
    });

    await assert.rejects(adapter.write(testPayload()), error => error.drawingClipboardAdapterCode === 'write-permission-denied');
    await assert.rejects(adapter.read(), error => error.drawingClipboardAdapterCode === 'read-permission-denied');
    assert.deepEqual(memoryClipboard.formats, { 'text/plain': 'stale' });
});

test('clipboard reads normalize web MIME aliases, Blob text and typed byte values', async () => {
    const payload = testPayload();
    const fallback = createDrawingClipboardAdapter({ navigatorObject: { clipboard: {
        async read() {
            return [{
                types: [`web ${DRAWING_CLIPBOARD_MIME_TYPE}`],
                async getType() { return new Blob([JSON.stringify(payload)]); },
            }];
        },
    } } });
    assert.deepEqual(await fallback.read(), payload);
    const bytes = new TextEncoder().encode('LUMCAD');
    assert.equal(await normalizeClipboardValue(bytes), 'LUMCAD');
    await assert.rejects(normalizeClipboardValue({}), error => error.drawingClipboardAdapterCode === 'invalid-clipboard-value');
});

test('clipboard read retries Affinity SVG plain text when item formats are not exposed by WebKit', async () => {
    let readTextCalls = 0;
    const affinitySvg = [
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
        '<svg width="100%" height="100%" viewBox="0 0 20 10" version="1.1" xmlns="http://www.w3.org/2000/svg">',
        '<g transform="matrix(1,0,0,1,2,3)"><path d="M0,0 L10,0 L10,5 Z" style="fill:none;stroke:#000;"/></g>',
        '</svg>',
    ].join('');
    const adapter = createDrawingClipboardAdapter({ navigatorObject: { clipboard: {
        async read() { return [{ types: ['application/pdf'], async getType() { return null; } }]; },
        async readText() { readTextCalls += 1; return affinitySvg; },
    } } });

    const payload = await adapter.read();
    assert.equal(readTextCalls, 1);
    assert.equal(payload.entities.length, 1);
    assert.equal(payload.entities[0].type, 'polyline');
    assert.deepEqual(
        payload.entities[0].parts.map(part => [part.x1, part.y1, part.x2, part.y2]),
        [[2, 3, 12, 3], [12, 3, 12, 8], [12, 8, 2, 3]],
    );
});

test('Tauri macOS bridge transports all native formats and is ignored elsewhere', async () => {
    const calls = [];
    const invokeCommand = async (command, arguments_) => {
        calls.push([command, arguments_]);
        if (command === 'read_drawing_clipboard') {
            return { 'text/plain': '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"><line x1="0" y1="0" x2="1" y2="0"/></svg>' };
        }
        return { types: ['com.lumcad.drawing-clipboard', 'public.svg-image', 'image/svg+xml', 'public.utf8-plain-text'] };
    };
    const bridge = createTauriDrawingClipboardBridge({
        navigatorObject: { platform: 'MacIntel' },
        windowObject: { __TAURI_INTERNALS__: {} },
        invokeCommand,
    });
    const adapter = createDrawingClipboardAdapter({ nativeClipboard: bridge, navigatorObject: {} });
    const write = await adapter.write(testPayload());
    assert.equal(write.method, 'native');
    assert.deepEqual(write.types, [
        'com.lumcad.drawing-clipboard', 'public.svg-image', 'image/svg+xml', 'public.utf8-plain-text',
    ]);
    const nativeFormats = calls[0][1].formats;
    assert.match(nativeFormats['image/svg+xml'], /^<\?xml/);
    assert.equal(nativeFormats['text/plain'], nativeFormats['image/svg+xml']);
    assert.equal((await adapter.read()).entities[0].type, 'line');
    assert.equal(createTauriDrawingClipboardBridge({
        navigatorObject: { platform: 'Linux' },
        windowObject: { __TAURI_INTERNALS__: {} },
        invokeCommand,
    }), null);
});

class FakeClipboardItem {
    static supports(type) {
        return [
            `web ${DRAWING_CLIPBOARD_MIME_TYPE}`,
            'image/svg+xml',
            'text/plain',
        ].includes(type);
    }

    constructor(data) {
        this.data = data;
        this.types = Object.keys(data);
    }

    getType(type) {
        return Promise.resolve(this.data[type]);
    }
}

function testPayload() {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 1, y1: 2, x2: 3, y2: 4 }];
    return createDrawingClipboardPayload({ id: 'drawing', content, assets: [] }, ['line']);
}
