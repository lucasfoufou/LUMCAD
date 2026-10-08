import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { readDrawingDgnComplex } from './drawingDgnComplex.js';

/** Decode a cell's bounded record hierarchy without changing its member coordinates. */
export function readDrawingDgnCell(records, index, header) {
    return readCell(records, index, header, 0, { count: 0 });
}

function readCell(records, index, header, depth, budget) {
    if (depth >= 20 || ++budget.count > 4096) throw new Error('dgnLimit');
    const record = records[index]; const cell = readDrawingDgnElementGeometry(record, header);
    if (cell?.geometry.type !== 'dgnCell') throw new Error('dgnInvalid');
    const children = []; let consumed = 0; let bytes = record.bytes.length;
    while (bytes < cell.geometry.totalBytes) {
        const member = records[index + consumed + 1];
        if (!member || !member.complex || member.deleted) throw new Error('dgnInvalid');
        if (member.type === 2) {
            const child = readCell(records, index + consumed + 1, header, depth + 1, budget);
            bytes += child.cell.geometry.totalBytes; consumed += child.consumed + 1; children.push(child);
        } else if ([12, 14].includes(member.type)) {
            const primitive = readDrawingDgnElementGeometry(member, header);
            const complex = readDrawingDgnComplex(records, index + consumed + 1, header);
            budget.count += complex.consumed + 1;
            if (budget.count > 4096) throw new Error('dgnLimit');
            bytes += primitive.geometry.totalBytes; consumed += complex.consumed + 1;
            children.push({ complex });
        } else {
            if (++budget.count > 4096) throw new Error('dgnLimit');
            const primitive = readDrawingDgnElementGeometry(member, header);
            bytes += member.bytes.length; consumed++;
            children.push({ primitive });
        }
        if (bytes > cell.geometry.totalBytes) throw new Error('dgnInvalid');
    }
    if (!children.length) throw new Error('dgnInvalid');
    return { cell, children, consumed };
}
