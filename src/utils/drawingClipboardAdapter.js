import { invoke } from '@tauri-apps/api/core';

import {
    createDrawingClipboardInterchange,
    DRAWING_CLIPBOARD_MIME_TYPE,
    parseDrawingClipboardInterchange,
} from './drawingClipboard.js';

const CLIPBOARD_FORMAT_PRIORITY = [
    DRAWING_CLIPBOARD_MIME_TYPE,
    'image/svg+xml',
    'text/plain',
];

const sharedMemoryClipboard = { formats: null };

export function createDrawingClipboardAdapter({
    navigatorObject = globalThis.navigator,
    ClipboardItemClass = globalThis.ClipboardItem,
    BlobClass = globalThis.Blob,
    memoryClipboard = sharedMemoryClipboard,
    nativeClipboard = createTauriDrawingClipboardBridge({ navigatorObject }),
} = {}) {
    const clipboard = navigatorObject?.clipboard || null;

    return {
        async write(payload) {
            const formats = createDrawingClipboardInterchange(payload);
            if (nativeClipboard) {
                try {
                    const result = await nativeClipboard.write(formats);
                    return {
                        method: 'native',
                        types: result?.types || Object.keys(formats),
                    };
                } catch (error) {
                    throw adapterError(errorCode('write', error), error);
                }
            }
            if (canWriteItems(clipboard, ClipboardItemClass, BlobClass)) {
                const itemFormats = supportedClipboardItemFormats(formats, ClipboardItemClass);
                if (Object.keys(itemFormats).length > 1) {
                    try {
                        const blobs = Object.fromEntries(Object.entries(itemFormats).map(([type, value]) => [
                            type,
                            new BlobClass([value], { type: clipboardBlobType(type) }),
                        ]));
                        await clipboard.write([new ClipboardItemClass(blobs)]);
                        return { method: 'write', types: Object.keys(blobs) };
                    } catch (error) {
                        if (!isUnsupportedFormatError(error) || typeof clipboard?.writeText !== 'function') {
                            throw adapterError(errorCode('write', error), error);
                        }
                    }
                }
            }
            if (typeof clipboard?.writeText === 'function') {
                try {
                    await clipboard.writeText(formats['text/plain']);
                    return { method: 'writeText', types: ['text/plain'] };
                } catch (error) {
                    throw adapterError(errorCode('write', error), error);
                }
            }
            if (canWriteItems(clipboard, ClipboardItemClass, BlobClass)) {
                try {
                    const blobs = { 'text/plain': new BlobClass([formats['text/plain']], { type: 'text/plain' }) };
                    await clipboard.write([new ClipboardItemClass(blobs)]);
                    return { method: 'write', types: ['text/plain'] };
                } catch (error) {
                    throw adapterError(errorCode('write', error), error);
                }
            }
            memoryClipboard.formats = cloneFormats(formats);
            return { method: 'memory', types: Object.keys(formats) };
        },

        async read() {
            if (nativeClipboard) {
                try {
                    return parseAdapterFormats(await nativeClipboard.read());
                } catch (error) {
                    if (error?.drawingClipboardAdapterCode) throw error;
                    throw adapterError(errorCode('read', error), error);
                }
            }
            if (typeof clipboard?.read === 'function') {
                try {
                    const items = await clipboard.read();
                    const formats = await readClipboardItems(items);
                    return parseAdapterFormats(formats);
                } catch (error) {
                    if (canRetryReadAsText(error) && typeof clipboard?.readText === 'function') {
                        return readClipboardText(clipboard);
                    }
                    if (error?.drawingClipboardAdapterCode) throw error;
                    throw adapterError(errorCode('read', error), error);
                }
            }
            if (typeof clipboard?.readText === 'function') {
                return readClipboardText(clipboard);
            }
            if (!memoryClipboard.formats) throw adapterError('clipboard-empty');
            return parseAdapterFormats(cloneFormats(memoryClipboard.formats));
        },
    };
}

export const drawingClipboardAdapter = createDrawingClipboardAdapter();

export function createTauriDrawingClipboardBridge({
    navigatorObject = globalThis.navigator,
    windowObject = globalThis.window,
    invokeCommand = invoke,
} = {}) {
    const platform = `${navigatorObject?.platform || ''} ${navigatorObject?.userAgent || ''}`;
    if (!windowObject?.__TAURI_INTERNALS__ || !/mac/i.test(platform)) return null;
    return {
        write: formats => invokeCommand('write_drawing_clipboard', { formats }),
        read: () => invokeCommand('read_drawing_clipboard'),
    };
}

export function normalizeClipboardValue(value) {
    if (typeof value === 'string') return Promise.resolve(value);
    if (value && typeof value.text === 'function') return Promise.resolve(value.text()).then(String);
    if (value instanceof ArrayBuffer) return Promise.resolve(new TextDecoder().decode(value));
    if (ArrayBuffer.isView(value)) {
        return Promise.resolve(new TextDecoder().decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
    }
    return Promise.reject(adapterError('invalid-clipboard-value'));
}

async function readClipboardItems(items) {
    if (!Array.isArray(items) || !items.length) throw adapterError('clipboard-empty');
    for (const expectedType of CLIPBOARD_FORMAT_PRIORITY) {
        for (const item of items) {
            const availableType = findClipboardType(item?.types, expectedType);
            if (!availableType || typeof item?.getType !== 'function') continue;
            const value = await item.getType(availableType);
            return { [expectedType]: await normalizeClipboardValue(value) };
        }
    }
    throw adapterError('unsupported-content');
}

async function readClipboardText(clipboard) {
    try {
        const text = await clipboard.readText();
        if (!String(text || '').trim()) throw adapterError('clipboard-empty');
        return parseAdapterFormats({ 'text/plain': String(text) });
    } catch (error) {
        if (error?.drawingClipboardAdapterCode) throw error;
        throw adapterError(errorCode('read', error), error);
    }
}

function findClipboardType(types, expectedType) {
    return [...(types || [])].find(type => {
        const normalized = normalizeClipboardType(type);
        return normalized === expectedType || normalized === `web ${expectedType}`;
    }) || null;
}

function normalizeClipboardType(value) {
    const type = String(value || '').trim().toLowerCase();
    if (type.startsWith('web ')) return `web ${type.slice(4).split(';')[0].trim()}`;
    return type.split(';')[0].trim();
}

function parseAdapterFormats(formats) {
    try {
        return parseDrawingClipboardInterchange(formats);
    } catch (error) {
        if (error?.drawingClipboardAdapterCode) throw error;
        throw adapterError(error?.drawingClipboardCode === 'empty-clipboard'
            ? 'clipboard-empty'
            : 'invalid-content', error);
    }
}

function canWriteItems(clipboard, ClipboardItemClass, BlobClass) {
    return typeof clipboard?.write === 'function'
        && typeof ClipboardItemClass === 'function'
        && typeof BlobClass === 'function';
}

function supportedClipboardItemFormats(formats, ClipboardItemClass) {
    if (typeof ClipboardItemClass?.supports !== 'function') {
        return { 'text/plain': formats['text/plain'] };
    }
    const supported = {};
    const customType = `web ${DRAWING_CLIPBOARD_MIME_TYPE}`;
    if (ClipboardItemClass.supports(customType)) supported[customType] = formats[DRAWING_CLIPBOARD_MIME_TYPE];
    else if (ClipboardItemClass.supports(DRAWING_CLIPBOARD_MIME_TYPE)) {
        supported[DRAWING_CLIPBOARD_MIME_TYPE] = formats[DRAWING_CLIPBOARD_MIME_TYPE];
    }
    if (ClipboardItemClass.supports('image/svg+xml')) supported['image/svg+xml'] = formats['image/svg+xml'];
    if (ClipboardItemClass.supports('text/plain')) supported['text/plain'] = formats['text/plain'];
    return supported;
}

function clipboardBlobType(type) {
    return String(type).startsWith('web ') ? String(type).slice(4) : type;
}

function isUnsupportedFormatError(error) {
    return ['NotSupportedError', 'DataError', 'TypeError'].includes(error?.name)
        || /(?:not supported|unsupported).*(?:format|type|mime)/i.test(String(error?.message || ''));
}

function canRetryReadAsText(error) {
    return ['clipboard-empty', 'unsupported-content'].includes(error?.drawingClipboardAdapterCode)
        || ['NotSupportedError', 'DataError'].includes(error?.name);
}

function errorCode(action, error) {
    if (['NotAllowedError', 'SecurityError'].includes(error?.name)) return `${action}-permission-denied`;
    if (error?.name === 'AbortError') return `${action}-aborted`;
    return `${action}-failed`;
}

function adapterError(code, cause = null) {
    const error = new Error(`Drawing clipboard adapter error: ${code}`, cause ? { cause } : undefined);
    error.drawingClipboardAdapterCode = code;
    if (cause?.drawingClipboardCode) error.drawingClipboardCode = cause.drawingClipboardCode;
    return error;
}

function cloneFormats(formats) {
    return Object.fromEntries(Object.entries(formats || {}).map(([type, value]) => [type, String(value)]));
}
