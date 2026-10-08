// ISFF/V7 stores 32-bit integers as high-word/low-word, with little-endian words.
// Its floating-point fields use VAX D format, not IEEE-754.
function available(view, offset, size) {
    if (!(view instanceof DataView) || !Number.isSafeInteger(offset) || offset < 0 || offset + size > view.byteLength) {
        throw new Error('dgnInvalid');
    }
}

export function drawingDgnInt32(view, offset) {
    available(view, offset, 4);
    return (view.getUint16(offset, true) << 16) | view.getUint16(offset + 2, true);
}

export function drawingDgnVaxDouble(view, offset) {
    available(view, offset, 8);
    const first = view.getUint16(offset, true);
    const exponent = (first >>> 7) & 255;
    const negative = Boolean(first & 0x8000);
    if (!exponent) {
        if (negative) throw new Error('dgnInvalid'); // VAX reserved operand.
        return 0;
    }
    const fraction = (first & 127) / 128 + view.getUint16(offset + 2, true) / 2 ** 23
        + view.getUint16(offset + 4, true) / 2 ** 39 + view.getUint16(offset + 6, true) / 2 ** 55;
    return (negative ? -1 : 1) * (1 + fraction) * 2 ** (exponent - 129);
}

/** Write exact signed integer coordinates without silently wrapping their range. */
export function writeDrawingDgnInt32(view, offset, value) {
    available(view, offset, 4);
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new Error('dgnRange');
    view.setUint16(offset, value >>> 16, true);
    view.setUint16(offset + 2, value & 65535, true);
}

/** IEEE binary64 has three fewer fraction bits than VAX D: supported values encode exactly. */
export function writeDrawingDgnVaxDouble(view, offset, value) {
    available(view, offset, 8);
    if (!Number.isFinite(value)) throw new Error('dgnRange');
    if (value === 0) {
        view.setBigUint64(offset, 0n);
        return;
    }
    const ieee = new DataView(new ArrayBuffer(8));
    ieee.setFloat64(0, value);
    const bits = ieee.getBigUint64(0);
    const exponent = Number((bits >> 52n) & 2047n) - 1023 + 129;
    if (exponent < 1 || exponent > 255) throw new Error('dgnRange');
    const fraction = (bits & ((1n << 52n) - 1n)) << 3n;
    const sign = Number(bits >> 63n) << 15;
    view.setUint16(offset, sign | exponent << 7 | Number(fraction >> 48n), true);
    view.setUint16(offset + 2, Number((fraction >> 32n) & 65535n), true);
    view.setUint16(offset + 4, Number((fraction >> 16n) & 65535n), true);
    view.setUint16(offset + 6, Number(fraction & 65535n), true);
}
