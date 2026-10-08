import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { extractEntityPaths, getCurveStart, getCurveEnd, reversePath } from './drawingCurveKernel.js';
import { drawingDgnJunctionTolerance, reconcileDrawingDgnJunctions } from './drawingDgnJunctions.js';

// Complex word/count semantics: GDAL dgnlib.h, dgnwrite.cpp and recursive ElementToFeature.
/** Consume bounded V7 chains/shapes, checking every group's word length and direct-member count. */
export function readDrawingDgnComplex(records, index, header) {
    return readGroup(records, index, header, 0, { records: 0 });
}

function readGroup(records, index, header, depth, budget) {
    if (depth >= 20 || ++budget.records > 4096) throw new Error('dgnLimit');
    const record = records[index]; const parent = readDrawingDgnElementGeometry(record, header);
    if (parent?.geometry.type !== 'dgnComplex') throw new Error('dgnInvalid');
    const { count, totalBytes, closed } = parent.geometry;
    if (count > 4096) throw new Error('dgnLimit');
    if (index + count >= records.length) throw new Error('dgnInvalid');
    const children = []; const parts = []; const partSources = [];
    let bytes = record.bytes.length; let points = 0; let consumed = 0; let adjusted = false;
    const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    for (let childIndex = 0; childIndex < count; childIndex++) {
        const member = records[index + consumed + 1];
        if (!member || !member.complex || member.deleted) throw new Error('dgnInvalid');
        let child = readDrawingDgnElementGeometry(member, header);
        if (child.properties & 0x8000 || child.level !== parent.level) throw new Error('dgnUnsupported');
        let path; let sources; let memberCount = 1; let memberBytes = member.bytes.length;
        if (child.geometry.type === 'dgnComplex') {
            const nested = readGroup(records, index + consumed + 1, header, depth + 1, budget);
            if (nested.parent.geometry.closed) throw new Error('dgnUnsupported');
            children.push(child);
            const sourceOffset = children.length;
            children.push(...nested.children);
            sources = nested.partSources.map(source => source + sourceOffset);
            path = { type: 'path', parts: nested.parent.geometry.parts, closed: false };
            memberCount += nested.consumed; memberBytes = child.geometry.totalBytes;
            points += nested.points;
            adjusted ||= nested.adjusted;
        } else {
            if (++budget.records > 4096) throw new Error('dgnLimit');
            if (!['line', 'polyline', 'ellipse'].includes(child.geometry.type)) throw new Error('dgnUnsupported');
            const paths = extractEntityPaths(child.geometry);
            if (paths.length !== 1 || (paths[0].closed && !(closed && count === 1))) throw new Error('dgnUnsupported');
            path = paths[0]; children.push(child);
            sources = path.parts.map(() => children.length - 1);
            points += child.geometry.points?.length ?? 2;
        }
        bytes += memberBytes; consumed += memberCount;
        if (bytes > totalBytes) throw new Error('dgnInvalid');
        if (parts.length) {
            const end = getCurveEnd(parts.at(-1));
            if (distance(end, getCurveStart(path.parts[0])) > drawingDgnJunctionTolerance(parts.at(-1), path.parts[0], header.uorPerMaster)
                && distance(end, getCurveEnd(path.parts.at(-1))) <= drawingDgnJunctionTolerance(parts.at(-1), path.parts.at(-1), header.uorPerMaster)) {
                path = reversePath(path); sources.reverse();
            }
        }
        parts.push(...path.parts); partSources.push(...sources);
        if (parts.length > 4096) throw new Error('dgnLimit');
    }
    if (bytes !== totalBytes) throw new Error('dgnInvalid');
    const joined = reconcileDrawingDgnJunctions(parts, partSources, closed, header.uorPerMaster);
    return { parent: { ...parent, complex: false, geometry: { type: 'polyline', parts: joined.path.parts, closed } },
        children, partSources: joined.partSources, points: points + joined.addedPoints, consumed, adjusted: adjusted || joined.adjusted };
}
