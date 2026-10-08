import { extractEntityPaths } from './drawingCurveKernel.js';
import { writeDrawingDgnGeometry } from './drawingDgnWriterGeometry.js';
import { drawingDgnInt32, writeDrawingDgnInt32 } from './drawingDgnNumbers.js';
import { writeDrawingDgnFill } from './drawingDgnWriterFill.js';
import { writeDrawingDgnText } from './drawingDgnWriterText.js';

/** Emit primitive records or a bounded complex chain/shape, retaining native curves. */
export function writeDrawingDgnElements(geometry, options = {}) {
    if (geometry?.type === 'dgnText') return [writeDrawingDgnText(geometry, options)];
    // Readers such as GDAL treat an ellipse record as linework even with a fill link.
    // A closed complex-shape parent preserves the exact ellipse and its fill semantics.
    const filledEllipse = options.fillColor != null && fullEllipse(geometry);
    const largePolyline = geometry?.type === 'polyline' && !geometry.parts && Array.isArray(geometry.points)
        && geometry.points.length + (geometry.closed ? 1 : 0) > 101;
    if (!geometry?.parts && !largePolyline && !filledEllipse) return [writeDrawingDgnGeometry(geometry, options)];
    const paths = extractEntityPaths(geometry);
    if (paths.length !== 1 || !paths[0].parts.length) throw new Error('dgnUnsupported');
    const path = paths[0]; let members;
    if (largePolyline) {
        const points = geometry.points.map(point => ({ ...point }));
        if (path.closed && (points[0].x !== points.at(-1).x || points[0].y !== points.at(-1).y)) points.push({ ...points[0] });
        members = [];
        for (let index = 0; index < points.length - 1; index += 100) {
            members.push({ type: 'polyline', points: points.slice(index, index + 101), closed: false });
        }
    } else members = path.parts;
    if (members.length === 1 && !(options.fillColor != null && fullEllipse(members[0]))) return [writeDrawingDgnGeometry(members[0], options)];
    if (members.length > 4095) throw new Error('dgnLimit');
    const children = members.map(member => writeDrawingDgnGeometry(member, { ...options, complex: true, fillColor: null }));
    const words = (48 + children.reduce((sum, bytes) => sum + bytes.length, 0) - 38) / 2;
    if (words > 65535) throw new Error('dgnLimit');
    const parent = new Uint8Array(48); parent.set(children[0].subarray(0, 36));
    const view = new DataView(parent.buffer);
    parent[1] = path.closed ? 14 : 12;
    view.setUint16(2, 22, true); view.setUint16(30, 8, true);
    view.setUint16(36, words, true); view.setUint16(38, children.length, true);
    // Union the encoded child ranges, including their coordinate/angular quantization.
    for (let axis = 0; axis < 3; axis++) {
        let low = Infinity; let high = -Infinity;
        for (const child of children) {
            const data = new DataView(child.buffer, child.byteOffset, child.byteLength);
            low = Math.min(low, drawingDgnInt32(data, 4 + axis * 4) ^ 0x80000000);
            high = Math.max(high, drawingDgnInt32(data, 16 + axis * 4) ^ 0x80000000);
        }
        writeDrawingDgnInt32(view, 4 + axis * 4, low); parent[5 + axis * 4] ^= 128;
        writeDrawingDgnInt32(view, 16 + axis * 4, high); parent[17 + axis * 4] ^= 128;
    }
    return [writeDrawingDgnFill(parent, options.fillColor), ...children];
}

function fullEllipse(geometry) {
    return geometry?.type === 'circle' || (geometry?.type === 'arc' && geometry.fullCircle)
        || (geometry?.type === 'ellipse' && geometry.fullEllipse);
}
