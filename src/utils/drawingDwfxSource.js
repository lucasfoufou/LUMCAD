import { drawingBinarySourceCodec } from './drawingBinarySource.js';

export const DWFX_SOURCE_MIME = 'model/vnd.dwfx+xps';
export const MAX_DWFX_SOURCE_BYTES = 25 * 1024 * 1024;

const codec = drawingBinarySourceCodec({ mimeType: DWFX_SOURCE_MIME, maxBytes: MAX_DWFX_SOURCE_BYTES,
    sourceError: 'dwfxSource', limitError: 'dwfxLimit', validate: bytes => {
        if (bytes.length < 4 || ![80, 75, 3, 4].every((value, index) => bytes[index] === value)) throw new Error('dwfxSource');
    },
});

/** Archive transport only. The package/page reader validates the contents before attachment. */
export const drawingDwfxDataUrl = codec.dataUrl;
export const drawingDwfxBytes = codec.bytes;
