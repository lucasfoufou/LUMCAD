/** Parse bounded V7 attribute linkages without following external database references. */
export function readDrawingDgnLinkages(bytes, { maxLinkages = 1024 } = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.length % 2) throw new Error('dgnInvalid');
    if (!Number.isSafeInteger(maxLinkages) || maxLinkages < 1 || bytes.length > 131070) throw new Error('dgnLimit');
    const links = []; let offset = 0;
    while (offset < bytes.length) {
        if (links.length >= maxLinkages) throw new Error('dgnLimit');
        if (bytes.length - offset < 4) throw new Error('dgnInvalid');
        const dmrs = bytes[offset] === 0 && [0, 128].includes(bytes[offset + 1]);
        if (!dmrs && !(bytes[offset + 1] & 16)) throw new Error('dgnUnsupported');
        const length = dmrs ? 8 : (bytes[offset] + 1) * 2;
        if (length < 6 || offset + length > bytes.length) throw new Error('dgnInvalid');
        const type = dmrs ? 'dmrs' : bytes[offset + 2] | bytes[offset + 3] << 8;
        links.push({ type, bytes: bytes.slice(offset, offset + length) });
        offset += length;
    }
    return links;
}

export function drawingDgnFillIndex(links) {
    const fills = links.filter(link => link.type === 0x41);
    if (fills.length > 1 || fills.some(link => link.bytes.length < 10)) throw new Error('dgnInvalid');
    return fills.length ? fills[0].bytes[8] : null;
}
