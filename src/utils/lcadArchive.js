import { recoverLcadLocalZipEntries } from './lcadZipRecovery.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

import { createI18nError } from '../i18n/translator.js';
import {
    LCAD_FORMAT,
    LCAD_FORMAT_VERSION,
    LCAD_MIN_READABLE_FORMAT_VERSION,
    normalizeLcadEnvelope,
    normalizeLcadAssetMimeType,
} from './lcadDocument.js';

export const LCAD_MANIFEST_PATH = 'manifest.json';
export const LCAD_ASSET_DIRECTORY = 'assets/';

// Compact JSON keeps large drawings well below this bound (about 190 bytes per
// typical entity); the bound itself protects readers from oversized archives.
export const LCAD_MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_BYTES = LCAD_MAX_MANIFEST_BYTES;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_ASSET_COUNT = 512;
const ZIP_EPOCH = new Date(1980, 0, 1, 0, 0, 0);
const IMAGE_MIME_TYPES = new Map([
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
    ['image/svg+xml', 'svg'],
    ['application/pdf', 'pdf'],
    ['model/vnd.dwfx+xps', 'dwfx'],
    ['image/vnd.dgn', 'dgn'],
]);

export function createLcadArchive(envelope) {
    const normalized = normalizeLcadEnvelope(envelope);
    const manifest = structuredClone(normalized);
    const archiveEntries = {};
    let totalAssetBytes = 0;

    if (manifest.document.assets.length > MAX_ASSET_COUNT) {
        throw createI18nError('storage.tooManyAssets');
    }

    manifest.document.assets = manifest.document.assets.map((asset, index) => {
        const { bytes, mimeType } = decodeImageDataUrl(asset.link);
        enforceAssetSize(bytes.length, totalAssetBytes);
        totalAssetBytes += bytes.length;
        const path = archiveAssetPath(asset, index, mimeType);
        archiveEntries[path] = [bytes, { level: 0, mtime: ZIP_EPOCH }];
        const { link: _link, ...metadata } = asset;
        return { ...metadata, mimeType, path };
    });

    const manifestBytes = strToU8(`${JSON.stringify(manifest)}\n`);
    if (manifestBytes.length > MAX_MANIFEST_BYTES) {
        throw createI18nError('storage.manifestTooLarge');
    }
    archiveEntries[LCAD_MANIFEST_PATH] = [manifestBytes, { level: 6, mtime: ZIP_EPOCH }];
    return zipSync(archiveEntries, { level: 0, mtime: ZIP_EPOCH });
}

export function readLcadArchive(input) {
    return decodeLcadArchive(input);
}

/** Recovery staging only: preserve the raw manifest so audit/salvage precedes normalization. */
export function readLcadRecoveryCandidate(input) {
    const issues = [];
    const envelope = decodeLcadArchive(input, issues);
    return { envelope, issues };
}

function decodeLcadArchive(input, recoveryIssues = null) {
    const bytes = toUint8Array(input);
    if (!isZipArchive(bytes)) throw createI18nError('storage.invalidArchive');

    let rejectedEntry = null;
    let entryCount = 0;
    let declaredAssetBytes = 0;
    const seenEntryNames = new Set();
    let files;
    let rebuildDirectory = false;
    try {
        files = unzipSync(bytes, {
            filter(entry) {
                entryCount += 1;
                const isManifest = entry.name === LCAD_MANIFEST_PATH;
                const isAsset = isSafeAssetPath(entry.name);
                const maximum = isManifest ? MAX_MANIFEST_BYTES : MAX_ASSET_BYTES;
                if (seenEntryNames.has(entry.name) || (!isManifest && !isAsset)
                    || entryCount > MAX_ASSET_COUNT + 1 || entry.originalSize > maximum) {
                    rejectedEntry ||= entry.name;
                    return false;
                }
                seenEntryNames.add(entry.name);
                if (isAsset) {
                    declaredAssetBytes += entry.originalSize;
                    if (declaredAssetBytes > MAX_TOTAL_ASSET_BYTES) {
                        rejectedEntry ||= entry.name;
                        return false;
                    }
                }
                // Recovery decodes CRC-checked local records below. Avoid a
                // second, unchecked inflation from central-directory metadata.
                return !recoveryIssues;
            },
        });
    } catch (error) {
        if (!recoveryIssues || rejectedEntry) throw createI18nError('storage.invalidArchive', {}, { cause: error });
        rebuildDirectory = true;
    }
    if (rejectedEntry) throw createI18nError('storage.invalidArchiveEntry', { detail: rejectedEntry });
    if (recoveryIssues) {
        const recovered = recoverLcadLocalZipEntries(bytes, { manifestPath: LCAD_MANIFEST_PATH,
            maxManifestBytes: MAX_MANIFEST_BYTES, maxAssetBytes: MAX_ASSET_BYTES,
            maxTotalAssetBytes: MAX_TOTAL_ASSET_BYTES, maxAssetCount: MAX_ASSET_COUNT, isSafeAssetPath });
        files = recovered.files;
        if (rebuildDirectory) seenEntryNames.clear();
        for (const name of recovered.entryNames) seenEntryNames.add(name);
        recoveryIssues.push(...recovered.issues.filter(issue => rebuildDirectory || issue.code !== 'rebuiltZipDirectory'));
    }

    const manifestBytes = files[LCAD_MANIFEST_PATH];
    if (!manifestBytes) throw createI18nError('storage.missingManifest');
    if (manifestBytes.length > MAX_MANIFEST_BYTES) throw createI18nError('storage.manifestTooLarge');
    let manifest;
    try {
        manifest = JSON.parse(strFromU8(manifestBytes));
    } catch (error) {
        throw createI18nError('storage.invalidManifest', {}, { cause: error });
    }
    validateArchiveManifest(manifest);

    const seenPaths = new Set();
    let actualAssetBytes = 0;
    const hydrated = structuredClone(manifest);
    hydrated.document.assets = hydrated.document.assets.flatMap(asset => {
        const path = String(asset?.path || '');
        const mimeType = normalizeImageMimeType(asset?.mimeType);
        if (!isSafeAssetPath(path) || seenPaths.has(path) || !mimeType) {
            throw createI18nError('storage.invalidAsset', { detail: String(asset?.id || path || '?') });
        }
        seenPaths.add(path);
        const assetBytes = files[path];
        if (!assetBytes) {
            if (!recoveryIssues) throw createI18nError('storage.missingAsset', { detail: String(asset?.id || path) });
            recoveryIssues.push({ code: 'missingAssetEntry', assetId: asset.id, path, metadata: { ...asset } });
            return [];
        }
        actualAssetBytes += assetBytes.length;
        if (assetBytes.length > MAX_ASSET_BYTES || actualAssetBytes > MAX_TOTAL_ASSET_BYTES) {
            throw createI18nError('storage.assetTooLarge');
        }
        const { path: _path, ...metadata } = asset;
        return { ...metadata, mimeType, link: encodeImageDataUrl(mimeType, assetBytes) };
    });
    const expectedEntries = new Set([LCAD_MANIFEST_PATH, ...seenPaths]);
    const unknownEntry = [...seenEntryNames].find(path => !expectedEntries.has(path));
    if (unknownEntry) throw createI18nError('storage.invalidArchiveEntry', { detail: unknownEntry });
    return recoveryIssues ? hydrated : normalizeLcadEnvelope(hydrated);
}

export function isZipArchive(input) {
    const bytes = toUint8Array(input);
    return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
        && ((bytes[2] === 0x03 && bytes[3] === 0x04)
            || (bytes[2] === 0x05 && bytes[3] === 0x06)
            || (bytes[2] === 0x07 && bytes[3] === 0x08));
}

function validateArchiveManifest(manifest) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw createI18nError('storage.invalidManifest');
    }
    if (manifest.format !== LCAD_FORMAT) throw createI18nError('errors.notLumcad');
    if (!Number.isInteger(manifest.formatVersion)
        || manifest.formatVersion < LCAD_MIN_READABLE_FORMAT_VERSION
        || manifest.formatVersion > LCAD_FORMAT_VERSION) {
        throw createI18nError('errors.unsupportedFormatVersion', { version: String(manifest.formatVersion) });
    }
    if (!manifest.document || typeof manifest.document !== 'object' || Array.isArray(manifest.document)) {
        throw createI18nError('errors.invalidDocument');
    }
    if (manifest.document.assets === undefined) manifest.document.assets = [];
    else if (!Array.isArray(manifest.document.assets)) {
        throw createI18nError('storage.invalidAsset', { detail: 'assets' });
    }
    if (manifest.document.assets.length > MAX_ASSET_COUNT) {
        throw createI18nError('storage.tooManyAssets');
    }
}

function archiveAssetPath(asset, index, mimeType) {
    const stem = String(asset.id || `asset-${index + 1}`)
        .normalize('NFKD')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^[-.]+|[-.]+$/g, '')
        .slice(0, 96) || `asset-${index + 1}`;
    return `${LCAD_ASSET_DIRECTORY}${String(index + 1).padStart(4, '0')}-${stem}.${IMAGE_MIME_TYPES.get(mimeType)}`;
}

function decodeImageDataUrl(value) {
    const match = /^data:([^;,]+)((?:;[^,]*)?),(.*)$/s.exec(String(value || ''));
    const mimeType = normalizeImageMimeType(match?.[1]);
    if (!match || !mimeType) throw createI18nError('storage.invalidAsset', { detail: '?' });
    const parameters = match[2].split(';').filter(Boolean).map(value => value.toLowerCase());
    try {
        return {
            mimeType,
            bytes: parameters.includes('base64') ? base64ToBytes(match[3]) : percentEncodedToBytes(match[3]),
        };
    } catch (error) {
        throw createI18nError('storage.invalidAsset', { detail: '?' }, { cause: error });
    }
}

function normalizeImageMimeType(value) {
    return normalizeLcadAssetMimeType(value);
}

function enforceAssetSize(size, currentTotal) {
    if (size > MAX_ASSET_BYTES || currentTotal + size > MAX_TOTAL_ASSET_BYTES) {
        throw createI18nError('storage.assetTooLarge');
    }
}

function isSafeAssetPath(value) {
    const path = String(value || '');
    return path.startsWith(LCAD_ASSET_DIRECTORY)
        && path.length > LCAD_ASSET_DIRECTORY.length
        && !path.includes('\\')
        && !path.split('/').includes('..')
        && !path.includes('//');
}

function encodeImageDataUrl(mimeType, bytes) {
    return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function base64ToBytes(value) {
    const binary = globalThis.atob(String(value).replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return globalThis.btoa(binary);
}

function percentEncodedToBytes(value) {
    const result = [];
    const source = String(value);
    const encoder = new TextEncoder();
    let literal = '';
    const flushLiteral = () => {
        if (!literal) return;
        result.push(...encoder.encode(literal));
        literal = '';
    };
    for (let index = 0; index < source.length; index += 1) {
        if (source[index] === '%') {
            if (!/^[0-9a-f]{2}$/i.test(source.slice(index + 1, index + 3))) {
                throw new TypeError('Invalid percent escape in image data URL.');
            }
            flushLiteral();
            result.push(Number.parseInt(source.slice(index + 1, index + 3), 16));
            index += 2;
        } else {
            literal += source[index];
        }
    }
    flushLiteral();
    return Uint8Array.from(result);
}

function toUint8Array(value) {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    throw new TypeError('Expected .lcad archive bytes.');
}
