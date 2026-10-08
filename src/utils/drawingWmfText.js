// Microsoft MS-WMF Font Object and META_TEXTOUT/EXTTEXTOUT character-set rules.
const CHARSETS = new Map([
    [0, 'windows-1252'], [128, 'shift_jis'], [129, 'euc-kr'], [134, 'gbk'], [136, 'big5'],
    [161, 'windows-1253'], [162, 'windows-1254'], [163, 'windows-1258'], [177, 'windows-1255'],
    [178, 'windows-1256'], [186, 'windows-1257'], [204, 'windows-1251'], [222, 'windows-874'], [238, 'windows-1250'],
]);
const ENCODERS = new Map();

/** Encode a single-byte GDI character set without replacing unrepresentable characters. */
export function encodeDrawingWmfText(text, charset = 0) {
    if (typeof text !== 'string' || text.length > 32767) throw new Error('wmfLimit');
    if (![0, 161, 162, 163, 177, 178, 186, 204, 222, 238].includes(charset)) throw new Error('wmfUnsupportedCharset');
    if (!ENCODERS.has(charset)) {
        const decoder = new TextDecoder(CHARSETS.get(charset), { fatal: true }); const table = new Map();
        for (let value = 0; value < 256; value++) {
            try {
                const character = decoder.decode(Uint8Array.of(value));
                if (character !== '\ufffd' && !table.has(character)) table.set(character, value);
            } catch { /* Undefined code-page bytes have no encoder entry. */ }
        }
        ENCODERS.set(charset, table);
    }
    const table = ENCODERS.get(charset); const bytes = [];
    for (const character of text) {
        const value = table.get(character);
        if (value === undefined) throw new Error('wmfUnsupportedCharset');
        bytes.push(value);
    }
    return Uint8Array.from(bytes);
}

/** Encode an explicit logical font; font substitution remains a viewer responsibility. */
export function writeDrawingWmfFont(font) {
    const { height, width = 0, escapement = 0, orientation = escapement, weight = 400,
        charset = 0, name = 'Arial', pitchAndFamily = 0 } = font;
    if (![height, width, escapement, orientation].every(value => Number.isInteger(value) && value >= -32768 && value <= 32767)
        || !Number.isInteger(weight) || weight < 0 || weight > 1000 || !CHARSETS.has(charset)
        || !Number.isInteger(pitchAndFamily) || pitchAndFamily < 0 || pitchAndFamily > 255
        || typeof name !== 'string' || name.length > 31 || /[^\x20-\x7e\xa0-\xff]/.test(name)) throw new Error('wmfInvalidText');
    const bytes = new Uint8Array(50); const view = new DataView(bytes.buffer);
    [height, width, escapement, orientation, weight].forEach((value, i) => view.setInt16(i * 2, value, true));
    bytes[10] = Number(Boolean(font.italic)); bytes[11] = Number(Boolean(font.underline)); bytes[12] = Number(Boolean(font.strikeout));
    bytes[13] = charset; bytes[17] = pitchAndFamily;
    for (let i = 0; i < name.length; i++) bytes[18 + i] = name.charCodeAt(i);
    return bytes;
}

/** Encode EXTTEXTOUT with explicit per-character advances, without platform-dependent shaping. */
export function writeDrawingWmfExtTextOut({ text, x, y, charset = 0, advances = null }) {
    if (![x, y].every(value => Number.isInteger(value) && value >= -32768 && value <= 32767)) throw new Error('wmfPlacement');
    const encoded = encodeDrawingWmfText(text, charset);
    if (advances && (advances.length !== encoded.length || !advances.every(value => Number.isInteger(value) && value >= -32768 && value <= 32767))) throw new Error('wmfInvalidText');
    const end = 8 + encoded.length + encoded.length % 2;
    const bytes = new Uint8Array(end + (advances ? encoded.length * 2 : 0)); const view = new DataView(bytes.buffer);
    view.setInt16(0, y, true); view.setInt16(2, x, true); view.setInt16(4, encoded.length, true); bytes.set(encoded, 8);
    advances?.forEach((value, index) => view.setInt16(end + index * 2, value, true));
    return bytes;
}

export function decodeDrawingWmfText(bytes, charset) {
    if (!(bytes instanceof Uint8Array)) throw new Error('wmfInvalid');
    // DEFAULT, SYMBOL, OEM and JOHAB need locale/font-specific mapping; never guess.
    const encoding = CHARSETS.get(charset);
    if (!encoding) throw new Error('wmfUnsupportedCharset');
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error('wmfInvalidText'); }
}

export function readDrawingWmfFont(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 50) throw new Error('wmfInvalid');
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const i16 = offset => data.getInt16(offset, true);
    const weight = i16(8);
    if (weight < 0 || weight > 1000 || [10, 11, 12].some(offset => bytes[offset] > 1)) throw new Error('wmfInvalid');
    const face = bytes.subarray(18, 50); const end = face.indexOf(0);
    if (end < 0) throw new Error('wmfInvalid');
    // ISO-8859-1 face names are distinct from the text's selected code page.
    const name = String.fromCharCode(...face.subarray(0, end));
    if (/[\x00-\x1f\x7f]/.test(name)) throw new Error('wmfInvalid');
    return { kind: 'font', height: i16(0), width: i16(2), escapement: i16(4), orientation: i16(6),
        weight, italic: Boolean(bytes[10]), underline: Boolean(bytes[11]), strikeout: Boolean(bytes[12]),
        charset: bytes[13], outPrecision: bytes[14], clipPrecision: bytes[15], quality: bytes[16], pitchAndFamily: bytes[17], name };
}

export function readDrawingWmfTextOut(bytes, font, { maxCharacters = 1000000 } = {}) {
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) throw new Error('wmfLimit');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 6) throw new Error('wmfInvalid');
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = data.getUint16(0, true); const padded = length + length % 2;
    if (bytes.byteLength !== padded + 6) throw new Error('wmfInvalid');
    if (length > maxCharacters) throw new Error('wmfLimit');
    const text = decodeDrawingWmfText(bytes.subarray(2, 2 + length), font.charset);
    return { text, x: data.getInt16(4 + padded, true), y: data.getInt16(2 + padded, true) };
}

/** Decode parameters only; rectangle, spacing and direction still need rendering. */
export function readDrawingWmfExtTextOut(bytes, font, { maxCharacters = 1000000 } = {}) {
    if (!Number.isSafeInteger(maxCharacters) || maxCharacters < 0) throw new Error('wmfLimit');
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) throw new Error('wmfInvalid');
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = data.getInt16(4, true); const options = data.getUint16(6, true);
    if (length < 0) throw new Error('wmfInvalid');
    if (length > maxCharacters) throw new Error('wmfLimit');
    // Glyph indices and locale-dependent shaping must not be decoded as ordinary text.
    if (options & ~0x0086) throw new Error('wmfUnsupportedTextOptions');
    const hasRectangle = Boolean(options & 6);
    const offset = hasRectangle ? 16 : 8;
    const end = offset + length + length % 2;
    if (bytes.byteLength < end) throw new Error('wmfInvalid');
    const rectangle = hasRectangle ? {
        left: data.getInt16(8, true), top: data.getInt16(10, true),
        right: data.getInt16(12, true), bottom: data.getInt16(14, true),
    } : null;
    const text = decodeDrawingWmfText(bytes.subarray(offset, offset + length), font.charset);
    let advances = null;
    if (bytes.byteLength > end) {
        if (bytes.byteLength !== end + length * 2) throw new Error('wmfInvalid');
        // ExtTextOutA supplies an advance per encoded byte; sum lead/trail bytes for DBCS.
        const decoder = new TextDecoder(CHARSETS.get(font.charset), { fatal: true });
        advances = []; let advance = 0;
        for (let index = 0; index < length; index++) {
            advance += data.getInt16(end + index * 2, true);
            const character = decoder.decode(bytes.subarray(offset + index, offset + index + 1), { stream: true });
            if (character) {
                if ([...character].length !== 1) throw new Error('wmfUnsupportedTextSpacing');
                advances.push(advance); advance = 0;
            }
        }
        if (decoder.decode() || advances.length !== [...text].length) throw new Error('wmfUnsupportedTextSpacing');
    }
    return { text, x: data.getInt16(2, true), y: data.getInt16(0, true), rectangle, advances,
        opaque: Boolean(options & 2), clipped: Boolean(options & 4), rightToLeft: Boolean(options & 0x80) };
}
