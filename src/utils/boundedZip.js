import { Inflate } from 'fflate';

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, byte) => {
    let value = byte;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
    return value >>> 0;
});
export const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ crc >>> 8;
    return (crc ^ 0xffffffff) >>> 0;
};

export function inflateBounded(bytes, expected) {
    const chunks = []; let size = 0;
    const inflater = new Inflate(chunk => {
        size += chunk.length;
        if (size > expected) throw new Error('size');
        chunks.push(chunk);
    });
    for (let offset = 0; offset < bytes.length; offset += 1024) inflater.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
    if (size !== expected) throw new Error('size');
    const output = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
}

/** Read a single-disk ZIP, validating local/central agreement before bounded inflation. */
export function readBoundedZip(bytes, { maxBytes = 64 * 1024 * 1024, maxEntries = 10000,
    maxEntryBytes = 32 * 1024 * 1024, maxTotalBytes = 128 * 1024 * 1024 } = {}) {
    const invalid = () => { throw new Error('zipInvalid'); };
    const limit = () => { throw new Error('zipLimit'); };
    if (!(bytes instanceof Uint8Array) || bytes.length < 22) invalid();
    if (bytes.length > maxBytes) limit();
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => view.getUint16(offset, true);
    const u32 = offset => view.getUint32(offset, true);
    let end = bytes.length - 22;
    while (end >= Math.max(0, bytes.length - 65557)
        && !(u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length)) end--;
    if (end < Math.max(0, bytes.length - 65557)) invalid();
    const count = u16(end + 10); const directorySize = u32(end + 12); const directory = u32(end + 16);
    if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535
        || directory + directorySize !== end) invalid();
    if (count > maxEntries) limit();
    const entries = []; const names = new Set(); let total = 0; let offset = directory;
    const decodeName = raw => {
        let name;
        try { name = new TextDecoder('utf-8', { fatal: true }).decode(raw); } catch { invalid(); }
        if (!name || name.startsWith('/') || /[\\\x00-\x1f:]/.test(name)
            || name.split('/').some((part, i, parts) => part === '.' || part === '..' || !part && i !== parts.length - 1)) invalid();
        return name;
    };
    for (let index = 0; index < count; index++) {
        if (offset + 46 > end || u32(offset) !== 0x02014b50) invalid();
        const flags = u16(offset + 8); const method = u16(offset + 10);
        const crc = u32(offset + 16); const compressed = u32(offset + 20); const original = u32(offset + 24);
        const nameLength = u16(offset + 28); const extraLength = u16(offset + 30); const commentLength = u16(offset + 32);
        const local = u32(offset + 42); const next = offset + 46 + nameLength + extraLength + commentLength;
        if (next > end || flags & ~0x080e || ![0, 8].includes(method) || u16(offset + 34)
            || [compressed, original, local].includes(0xffffffff)) invalid();
        const name = decodeName(bytes.subarray(offset + 46, offset + 46 + nameLength));
        if (names.has(name)) invalid();
        names.add(name); total += original;
        if (original > maxEntryBytes || total > maxTotalBytes) limit();
        if (local + 30 > directory || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method) invalid();
        const localNameLength = u16(local + 26); const data = local + 30 + localNameLength + u16(local + 28);
        if (data > directory || localNameLength !== nameLength
            || decodeName(bytes.subarray(local + 30, local + 30 + localNameLength)) !== name) invalid();
        const dataEnd = data + compressed;
        let recordEnd = dataEnd;
        if (dataEnd > directory) invalid();
        if (flags & 8) {
            let descriptor = dataEnd;
            if (descriptor + 4 <= directory && u32(descriptor) === 0x08074b50) descriptor += 4;
            if (descriptor + 12 > directory || u32(descriptor) !== crc || u32(descriptor + 4) !== compressed || u32(descriptor + 8) !== original) invalid();
            recordEnd = descriptor + 12;
        } else if (u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== original) invalid();
        entries.push({ name, crc, compressed, original, method, local, data, dataEnd, recordEnd });
        offset = next;
    }
    if (offset !== end) invalid();
    const ordered = [...entries].sort((a, b) => a.local - b.local);
    let previousEnd = 0;
    for (const entry of ordered) {
        if (entry.local !== previousEnd) invalid();
        previousEnd = entry.recordEnd;
    }
    if (previousEnd !== directory) invalid();
    const files = new Map();
    for (const entry of entries) {
        let decoded;
        try {
            const compressed = bytes.subarray(entry.data, entry.dataEnd);
            decoded = entry.method === 0 ? compressed.slice() : inflateBounded(compressed, entry.original);
        } catch { invalid(); }
        if (decoded.length !== entry.original || crc32(decoded) !== entry.crc) invalid();
        files.set(entry.name, decoded);
    }
    return files;
}
