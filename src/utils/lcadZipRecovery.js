import { crc32, inflateBounded } from './boundedZip.js';
import { strFromU8 } from 'fflate';
import { createI18nError } from '../i18n/translator.js';

/** Recover sequential local ZIP records when the central directory is unreadable. */
export function recoverLcadLocalZipEntries(bytes, { manifestPath, maxManifestBytes, maxAssetBytes, maxTotalAssetBytes, maxAssetCount, isSafeAssetPath }) {
    const invalid = detail => createI18nError('storage.invalidArchiveEntry', { detail });
    if (bytes.length > maxManifestBytes + maxTotalAssetBytes + 1024 * 1024) throw invalid('archive size');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const files = Object.create(null); const seen = new Set(); const issues = [];
    let offset = 0; let declaredAssets = 0;
    while (offset < bytes.length) {
        if (offset + 4 > bytes.length) { issues.push({ code: 'truncatedZipTail', offset }); break; }
        const signature = view.getUint32(offset, true);
        if (signature === 0x02014b50 || signature === 0x06054b50) break;
        if (signature !== 0x04034b50 || offset + 30 > bytes.length) throw invalid(`header at ${offset}`);
        const flags = view.getUint16(offset + 6, true); const method = view.getUint16(offset + 8, true);
        const crc = view.getUint32(offset + 14, true); const compressed = view.getUint32(offset + 18, true); const original = view.getUint32(offset + 22, true);
        const nameSize = view.getUint16(offset + 26, true); const extraSize = view.getUint16(offset + 28, true);
        const dataStart = offset + 30 + nameSize + extraSize;
        if (dataStart > bytes.length || !nameSize || flags & 9 || ![0, 8].includes(method)) throw invalid(`unsupported local record at ${offset}`);
        const name = strFromU8(bytes.subarray(offset + 30, offset + 30 + nameSize));
        const manifest = name === manifestPath;
        if ((!manifest && !isSafeAssetPath(name)) || seen.has(name) || seen.size >= maxAssetCount + 1) throw invalid(name);
        seen.add(name);
        if (original > (manifest ? maxManifestBytes : maxAssetBytes) || compressed > maxAssetBytes + 65536) throw invalid(name);
        if (!manifest) { declaredAssets += original; if (declaredAssets > maxTotalAssetBytes) throw invalid(name); }
        const dataEnd = dataStart + compressed;
        if (dataEnd > bytes.length) { issues.push({ code: 'truncatedZipEntry', path: name }); break; }
        try {
            const compressedBytes = bytes.subarray(dataStart, dataEnd);
            const payload = method === 0 ? compressedBytes : inflateBounded(compressedBytes, original);
            if (payload.length !== original || crc32(payload) !== crc) throw new Error('integrity');
            files[name] = payload;
        } catch {
            if (manifest) throw createI18nError('storage.invalidManifest');
            issues.push({ code: 'corruptAssetEntry', path: name });
        }
        offset = dataEnd;
    }
    if (!files[manifestPath]) throw createI18nError('storage.missingManifest');
    return { files, entryNames: [...seen], issues: [{ code: 'rebuiltZipDirectory', entries: Object.keys(files).length }, ...issues] };
}
