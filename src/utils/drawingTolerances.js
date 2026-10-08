import { normalizeDrawingTableStyle } from './drawingTables.js';
import { rebuildDrawingTableEntity } from './drawingTableGeometry.js';
import { normalizeDrawingAffineFrame } from './drawingAffineFrame.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices, translationAffineMatrix, transformAffinePoint } from './drawingAffine.js';
import { transformEllipseAffine } from './drawingAdvancedEntities.js';
import { normalizeDrawingTextEntity } from './drawingText.js';

export const DRAWING_TOLERANCE_SYMBOLS = Object.freeze(['straightness', 'flatness', 'circularity', 'cylindricity', 'lineProfile', 'surfaceProfile',
    'angularity', 'perpendicularity', 'parallelism', 'position', 'concentricity', 'symmetry', 'runout', 'totalRunout']);
const MATERIALS = ['', 'M', 'L', 'S'];
const numericLabel = value => typeof value === 'string' && value.length <= 32 && /^\+?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?$/i.test(value)
    && Number.isFinite(Number(value.replace(',', '.'))) && Number(value.replace(',', '.')) >= 0;

export function normalizeDrawingTolerance(value) {
    if (!value || !Array.isArray(value.rows) || !value.rows.length || value.rows.length > 4) return null;
    const rows = [];
    for (const source of value.rows) {
        if (!source || !DRAWING_TOLERANCE_SYMBOLS.includes(source.symbol) || !Array.isArray(source.values) || !source.values.length || source.values.length > 2
            || !Array.isArray(source.datums || []) || (source.datums || []).length > 3) return null;
        const values = []; const datums = [];
        for (const entry of source.values) {
            const material = entry?.material || '';
            if (!numericLabel(entry?.value) || !MATERIALS.includes(material)) return null;
            values.push({ value: entry.value, diameter: entry.diameter === true, material });
        }
        for (const datum of source.datums || []) {
            const material = datum?.material || '';
            if (typeof datum?.label !== 'string' || !/^[A-Z][A-Z0-9-]{0,7}$/.test(datum.label) || !MATERIALS.includes(material)) return null;
            datums.push({ label: datum.label, material });
        }
        rows.push({ symbol: source.symbol, values, datums });
    }
    const transform = normalizeDrawingAffineFrame(value.transform || IDENTITY_AFFINE_MATRIX);
    if (!transform) return null;
    const style = normalizeDrawingTableStyle({ ...value.style, headerRows: 0, headerBold: false });
    if (style.rowHeight < style.fontSize * 1.5) style.rowHeight = style.fontSize * 1.5;
    const projectedHeight = value.projectedHeight || '';
    if (projectedHeight && (!numericLabel(projectedHeight) || Number(projectedHeight.replace(',', '.')) <= 0)) return null;
    const datumIdentifier = value.datumIdentifier || '';
    if (datumIdentifier && !/^[A-Z][A-Z0-9-]{0,7}$/.test(datumIdentifier)) return null;
    return { rows, style, transform, projectedHeight, datumIdentifier };
}

/** Exact native line/ellipse glyphs avoid font-dependent GD&T symbol substitution. */
function toleranceGlyph(symbol, box, matrix, appearance, prefix) {
    const parts = [];
    const point = (x, y) => transformAffinePoint({ x: box.x + x * box.size, y: box.y + y * box.size }, matrix);
    const line = (x1, y1, x2, y2) => {
        const a = point(x1, y1); const b = point(x2, y2);
        parts.push({ type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    };
    const ellipse = (cx, cy, rx, ry = rx, start = 0, end = Math.PI * 2) => parts.push(transformEllipseAffine({ type: 'ellipse',
        cx: box.x + cx * box.size, cy: box.y + cy * box.size, rx: rx * box.size, ry: ry * box.size,
        rotation: 0, fullEllipse: end - start >= Math.PI * 2 - 1e-9, startAngle: start, endAngle: end, counterClockwise: true }, matrix));
    const arrow = dx => { line(0.2 + dx, 0.8, 0.7 + dx, 0.2); line(0.7 + dx, 0.2, 0.42 + dx, 0.27); line(0.7 + dx, 0.2, 0.7 + dx, 0.49); };
    if (symbol === 'straightness') line(0.15, 0.5, 0.85, 0.5);
    else if (symbol === 'flatness') { line(0.1, 0.7, 0.35, 0.3); line(0.35, 0.3, 0.9, 0.3); line(0.9, 0.3, 0.65, 0.7); line(0.65, 0.7, 0.1, 0.7); }
    else if (symbol === 'circularity') ellipse(0.5, 0.5, 0.3);
    else if (symbol === 'cylindricity') { ellipse(0.5, 0.5, 0.24); line(0.1, 0.8, 0.4, 0.2); line(0.6, 0.8, 0.9, 0.2); }
    else if (symbol === 'lineProfile' || symbol === 'surfaceProfile') { ellipse(0.5, 0.67, 0.35, 0.36, Math.PI, 2 * Math.PI); if (symbol === 'surfaceProfile') line(0.15, 0.67, 0.85, 0.67); }
    else if (symbol === 'angularity') { line(0.2, 0.75, 0.8, 0.75); line(0.2, 0.75, 0.7, 0.2); }
    else if (symbol === 'perpendicularity') { line(0.15, 0.75, 0.85, 0.75); line(0.5, 0.75, 0.5, 0.15); }
    else if (symbol === 'parallelism') { line(0.15, 0.8, 0.5, 0.2); line(0.5, 0.8, 0.85, 0.2); }
    else if (symbol === 'position') { ellipse(0.5, 0.5, 0.26); line(0.05, 0.5, 0.95, 0.5); line(0.5, 0.05, 0.5, 0.95); }
    else if (symbol === 'concentricity') { ellipse(0.5, 0.5, 0.32); ellipse(0.5, 0.5, 0.16); }
    else if (symbol === 'symmetry') { line(0.1, 0.5, 0.9, 0.5); line(0.2, 0.25, 0.8, 0.25); line(0.2, 0.75, 0.8, 0.75); }
    else if (symbol === 'runout') arrow(0);
    else if (symbol === 'totalRunout') { arrow(-0.12); arrow(0.12); line(0.08, 0.8, 0.32, 0.8); }
    else if (symbol === 'diameter') { ellipse(0.5, 0.5, 0.3); line(0.18, 0.82, 0.82, 0.18); }
    else if (['M', 'L', 'S', 'P'].includes(symbol)) {
        ellipse(0.5, 0.5, 0.36);
        parts.push(normalizeDrawingTextEntity({ type: 'text', x: box.x + box.size * 0.18, y: box.y + box.size * 0.12,
            width: box.size * 0.64, height: box.size * 0.76, fontSize: box.size * 0.5, textMode: 'singleLine', text: symbol,
            horizontalAlign: 'center', verticalAlign: 'middle', affineFrame: matrix }));
    }
    return parts.filter(Boolean).map((part, index) => ({ ...part, ...appearance, id: `${prefix}:${index}` }));
}

export function rebuildDrawingToleranceEntity(entity) {
    const tolerance = normalizeDrawingTolerance(entity?.tolerance);
    if (!tolerance) return null;
    const { style, transform } = tolerance;
    const h = style.rowHeight; const s = h * 0.68;
    const appearance = { layerId: entity.layerId, color: style.color, lineWeight: style.lineWeight, lineType: 'continuous' };
    const parts = [];
    let invalid = false;
    const widthFor = (text, diameter = false, material = '') => Math.max(h, text.length * style.fontSize * 0.72 + style.padding * 2 + (diameter ? s : 0) + (material ? s : 0));
    const addRow = (cells, widths, y, id, decorations) => {
        const matrix = multiplyAffineMatrices(transform, translationAffineMatrix(0, y));
        const row = rebuildDrawingTableEntity({ id, layerId: entity.layerId, table: { cells: [cells], columnWidths: widths, rowHeights: [h], style, transform: matrix } });
        if (!row) { invalid = true; return null; }
        // Frame labels are indivisible values, even at small drawing scales.
        row.parts = row.parts.map(part => part.type === 'text'
            ? normalizeDrawingTextEntity({ ...part, textMode: 'singleLine', wrapMode: 'none', verticalAlign: 'middle' }) : part);
        let x = 0;
        decorations.forEach((decoration, column) => {
            const text = row.parts.find(part => part.id === `${id}:cell:0:${column}`);
            if (decoration.diameter) { text.x += s; text.width -= s; parts.push(...toleranceGlyph('diameter', { x, y: (h - s) / 2, size: s }, matrix, appearance, `${id}:diameter:${column}`)); }
            if (decoration.material) { text.width -= s; parts.push(...toleranceGlyph(decoration.material, { x: x + widths[column] - s, y: (h - s) / 2, size: s }, matrix, appearance, `${id}:material:${column}`)); }
            x += widths[column];
        });
        parts.push(...row.parts);
        return matrix;
    };
    tolerance.rows.forEach((row, index) => {
        const decorations = [{}, ...row.values, ...row.datums];
        const cells = ['', ...row.values.map(value => value.value), ...row.datums.map(datum => datum.label)];
        const widths = [h, ...row.values.map(value => widthFor(value.value, value.diameter, value.material)), ...row.datums.map(datum => widthFor(datum.label, false, datum.material))];
        const id = `${entity.id}:frame:${index}`;
        const matrix = addRow(cells, widths, index * h, id, decorations);
        if (matrix) parts.push(...toleranceGlyph(row.symbol, { x: (h - s) / 2, y: (h - s) / 2, size: s }, matrix, appearance, `${id}:symbol`));
    });
    let y = tolerance.rows.length * h;
    if (tolerance.projectedHeight) {
        addRow([tolerance.projectedHeight], [widthFor(tolerance.projectedHeight, false, 'P')], y, `${entity.id}:projection`, [{ material: 'P' }]); y += h;
    }
    if (tolerance.datumIdentifier) addRow([tolerance.datumIdentifier], [widthFor(tolerance.datumIdentifier)], y, `${entity.id}:datum`, [{}]);
    if (invalid) return null;
    const { points, table, revisionSymbol, linework, splineDefinition, array, boundaries, ...rest } = entity;
    return { ...rest, type: 'polyline', closed: false, parts, tolerance };
}

export function transformDrawingToleranceEntity(entity, matrix) {
    const tolerance = normalizeDrawingTolerance(entity?.tolerance);
    return tolerance ? rebuildDrawingToleranceEntity({ ...entity, tolerance: { ...tolerance, transform: multiplyAffineMatrices(matrix, tolerance.transform) } }) : null;
}
