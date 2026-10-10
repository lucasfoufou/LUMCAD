// Binary input files for E2E import/attach workflows, built in Node so every
// test reads a real file through the browser file chooser.
import { deflateSync } from 'node:zlib';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { createLcadDocument, createLcadEnvelope } from '../../src/utils/lcadDocument.js';
import { createLcadArchive, LCAD_MANIFEST_PATH } from '../../src/utils/lcadArchive.js';
import { writeDrawingDgnFile } from '../../src/utils/drawingDgnWriterFile.js';
import { dgnFile } from '../../src/utils/fixtures/dgn.js';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** A real RGBA PNG: left half red, right half blue. */
export function pngBytes(width = 8, height = 8) {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
    header.set([8, 6, 0, 0, 0], 8);
    const rows = [];
    for (let y = 0; y < height; y++) {
        rows.push(0);
        for (let x = 0; x < width; x++) rows.push(...(x < width / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    }
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
        pngChunk('IDAT', deflateSync(Buffer.from(rows))), pngChunk('IEND', Buffer.alloc(0))]);
}
export const pngDataUrl = (width, height) => `data:image/png;base64,${pngBytes(width, height).toString('base64')}`;

/**
 * A one-page 100 x 50 mm vector PDF with two optional-content layers:
 * "Walls" holds an 80 mm horizontal line, "Notes" holds the text LUMCAD.
 */
export function pdfBytes() {
    const mm = value => (value * 72 / 25.4).toFixed(3);
    const stream = `1 w /OC /oc1 BDC ${mm(10)} ${mm(10)} m ${mm(90)} ${mm(10)} l S EMC\n`
        + `/OC /oc2 BDC BT /F1 14 Tf ${mm(10)} ${mm(35)} Td (LUMCAD) Tj ET EMC\n`;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /ON [5 0 R 6 0 R] /Order [5 0 R 6 0 R] >> >> >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${mm(100)} ${mm(50)}] /Resources << /Properties << /oc1 5 0 R /oc2 6 0 R >> /Font << /F1 7 0 R >> >> /Contents 4 0 R >>`,
        `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}endstream`,
        '<< /Type /OCG /Name (Walls) >>',
        '<< /Type /OCG /Name (Notes) >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let body = '%PDF-1.6\n';
    const offsets = objects.map((object, index) => {
        const offset = Buffer.byteLength(body, 'latin1');
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = Buffer.byteLength(body, 'latin1');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

/** A V7 DGN (master unit m) with a 6 m line on level 4 and a closed 2 m square on level 7. */
export function dgnBytes() {
    return Buffer.from(writeDrawingDgnFile([
        { geometry: { type: 'line', x1: 0, y1: 0, x2: 6, y2: 0 }, appearance: { level: 4 } },
        { geometry: { type: 'polyline', closed: true, points: [{ x: 10, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 2 }, { x: 10, y: 2 }] }, appearance: { level: 7 } },
    ], { seed: dgnFile() }));
}

/** A classic SHP font with a space and an H, 10 units high. */
export const SHP_FONT = '*0,4,fixture\n10,2,0,0\n*32,0,space\n2,8,5,0,0\n*72,0,H\n5,8,0,10,6,2,8,6,0,1,8,0,10,2,8,0,-5,1,8,-6,0,2,8,8,-5,0\n';

/** The three strokes of a 10 m H glyph drawn by SHP_FONT, as PDF-imported lines. */
export function shxStrokes(prefix, x) {
    return [[0, 0, 0, -10], [6, 0, 6, -10], [0, -5, 6, -5]].map(([x1, y1, x2, y2], index) => ({
        id: `${prefix}${index}`, type: 'line', x1: x + x1, y1, x2: x + x2, y2, color: '#123456',
    }));
}

/** A .lcad whose image asset bytes are missing; recovery keeps the line and quarantines the image. */
export function damagedLcadBytes() {
    const document = createLcadDocument({ name: 'Damaged' });
    document.assets = [{ id: 'lost', name: 'lost.png', width: 8, height: 8, mimeType: 'image/png', link: pngDataUrl(8, 8) }];
    document.content.entities = [
        { id: 'survivor', type: 'line', layerId: 'geometry', x1: 0, y1: 1, x2: 4, y2: 2 },
        { id: 'picture', type: 'image', layerId: 'geometry', assetId: 'lost', x: 1, y: 2, width: 3, height: 4 },
    ];
    const files = unzipSync(createLcadArchive(createLcadEnvelope(document)));
    const manifest = JSON.parse(strFromU8(files[LCAD_MANIFEST_PATH]));
    delete files[manifest.document.assets[0].path];
    return Buffer.from(zipSync(files));
}

/** Serialises a blank drawing transformed by `build` to .lcad bytes. */
export function lcadBytes(build, name = 'source') {
    return Buffer.from(createLcadArchive(createLcadEnvelope(build(createLcadDocument({ name })))));
}
