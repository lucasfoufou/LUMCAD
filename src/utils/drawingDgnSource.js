import { drawingBinarySourceCodec } from './drawingBinarySource.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';

export const DGN_SOURCE_MIME = 'image/vnd.dgn';
export const MAX_DGN_SOURCE_BYTES = 25 * 1024 * 1024;

const codec = drawingBinarySourceCodec({ mimeType: DGN_SOURCE_MIME, maxBytes: MAX_DGN_SOURCE_BYTES,
    sourceError: 'dgnInvalid', limitError: 'dgnLimit',
    validate: bytes => readDrawingDgnRecords(bytes, { maxBytes: MAX_DGN_SOURCE_BYTES }),
});

// Transport validates the V7 container. Geometry is checked separately before attachment.
export const drawingDgnDataUrl = codec.dataUrl;
export const drawingDgnBytes = codec.bytes;
