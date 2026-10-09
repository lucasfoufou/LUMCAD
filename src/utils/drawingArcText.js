import { arcSweep, arcPoint } from './drawingCurves.js';
import { IDENTITY_AFFINE_MATRIX, multiplyAffineMatrices } from './drawingAffine.js';
import { normalizeDrawingAffineFrame, unframeDrawingPoint } from './drawingAffineFrame.js';
import { normalizeDrawingTextStyle, normalizeDrawingTextEntity, segmentDrawingText, layoutDrawingTextRuns } from './drawingText.js';

const MAX_TEXT_LENGTH = 512;
const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9;

export function normalizeDrawingArcText(value) {
    if (!value || value.version !== 1 || typeof value.text !== 'string' || !value.text.trim()
        || value.text.length > MAX_TEXT_LENGTH || /[\r\n\u0000-\u001f]/.test(value.text)) return null;
    if (value.style?.fontSize !== undefined && (!finite(value.style.fontSize) || value.style.fontSize < 0.01 || value.style.fontSize > 1e6)) return null;
    const arc = value.arc;
    if (!arc || !['cx', 'cy', 'r', 'startAngle', 'endAngle'].every(key => finite(arc[key])) || arc.r <= 1e-9) return null;
    const source = { type: 'arc', cx: arc.cx, cy: arc.cy, r: arc.r, startAngle: arc.startAngle,
        endAngle: arc.endAngle, counterClockwise: arc.counterClockwise !== false, fullCircle: Boolean(arc.fullCircle) };
    if (Math.abs(arcSweep(source)) <= 1e-9) return null;
    const offset = value.offset ?? 0; const spacing = value.spacing ?? 0;
    if (!finite(offset) || !finite(spacing) || spacing < 0 || source.r + offset <= 1e-9) return null;
    const align = value.align ?? 'center';
    if (!['start', 'center', 'end'].includes(align)) return null;
    const transform = normalizeDrawingAffineFrame(value.transform || IDENTITY_AFFINE_MATRIX);
    if (!transform) return null;
    return { version: 1, text: value.text, arc: source, offset, spacing, align, reverse: Boolean(value.reverse),
        style: normalizeDrawingTextStyle(value.style), transform,
        status: ['missing', 'invalid', 'overflow'].includes(value.status) ? value.status : 'current' };
}

/** Layout native text graphemes on a circular baseline, retaining exact affine placement. */
export function rebuildDrawingArcTextEntity(entity) {
    const definition = normalizeDrawingArcText(entity?.arcText);
    if (!definition) return null;
    const glyphs = segmentDrawingText(definition.text);
    if (glyphs.length > 256) return null;
    const { arc, style, transform } = definition;
    const radius = arc.r + definition.offset;
    const sweep = arcSweep(arc); const direction = Math.sign(sweep) * (definition.reverse ? -1 : 1);
    const start = arc.startAngle + (definition.reverse ? sweep : 0);
    const widths = glyphs.map(text => layoutDrawingTextRuns([{ text, marks: {} }], Infinity, style, { textMode: 'singleLine' })[0].width);
    const total = widths.reduce((sum, width) => sum + width, 0) + definition.spacing * (glyphs.length - 1);
    const available = Math.abs(sweep) * radius;
    if (!Number.isFinite(total) || total > available + 1e-9) return null;
    let cursor = definition.align === 'end' ? available - total : definition.align === 'center' ? (available - total) / 2 : 0;
    const parts = glyphs.map((text, index) => {
        const width = widths[index];
        const angle = start + direction * (cursor + width / 2) / radius;
        const tangent = angle + direction * Math.PI / 2;
        const baseline = { x: arc.cx + radius * Math.cos(angle), y: arc.cy + radius * Math.sin(angle) };
        const frame = { a: Math.cos(tangent), b: Math.sin(tangent), c: -Math.sin(tangent), d: Math.cos(tangent), e: baseline.x, f: baseline.y };
        const padding = style.fontSize * 0.16;
        cursor += width + definition.spacing;
        return normalizeDrawingTextEntity({ ...style, id: `${entity.id}:glyph:${index}`, layerId: entity.layerId,
            type: 'text', text, textMode: 'singleLine', horizontalAlign: 'center', verticalAlign: 'top',
            x: -width / 2 - padding, y: -style.fontSize - padding, width: width + 2 * padding, height: style.fontSize * 1.5,
            fitWidth: true, affineFrame: multiplyAffineMatrices(transform, frame) });
    });
    const { points, table, tolerance, revisionSymbol, linework, splineDefinition, array, boundaries, ...rest } = entity;
    return { ...rest, type: 'polyline', closed: false, parts, arcText: definition };
}

export function transformDrawingArcTextEntity(entity, matrix) {
    const definition = normalizeDrawingArcText(entity?.arcText);
    return definition ? rebuildDrawingArcTextEntity({ ...entity, arcText: { ...definition,
        transform: multiplyAffineMatrices(matrix, definition.transform) } }) : null;
}

function identity(matrix) {
    return Object.keys(IDENTITY_AFFINE_MATRIX).every(key => Math.abs(matrix[key] - IDENTITY_AFFINE_MATRIX[key]) < 1e-10);
}

function localArc(source, matrix) {
    const sx = Math.hypot(matrix.a, matrix.b); const sy = Math.hypot(matrix.c, matrix.d);
    if (Math.abs(sx - sy) > sx * 1e-9 || Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > sx * sy * 1e-9) return null;
    const center = unframeDrawingPoint({ x: source.cx, y: source.cy }, matrix);
    const start = unframeDrawingPoint(arcPoint(source, source.startAngle), matrix);
    const end = unframeDrawingPoint(arcPoint(source, source.endAngle), matrix);
    return { ...source, cx: center.x, cy: center.y, r: source.r / sx,
        startAngle: Math.atan2(start.y - center.y, start.x - center.x),
        endAngle: Math.atan2(end.y - center.y, end.x - center.x),
        counterClockwise: matrix.a * matrix.d - matrix.b * matrix.c < 0 ? !source.counterClockwise : source.counterClockwise };
}

function equivalentArc(left, right) {
    return [0, 0.37, 1].every(fraction => {
        const a = arcPoint(left, left.startAngle + arcSweep(left) * fraction);
        const b = arcPoint(right, right.startAngle + arcSweep(right) * fraction);
        return Math.hypot(a.x - b.x, a.y - b.y) <= Math.max(1, right.r) * 1e-8;
    });
}

/** Refresh linked labels in the source edit's history step. Independent label transforms detach. */
export function refreshDrawingArcTexts(content, previous = content) {
    const refresh = (entities, previousEntities = []) => {
        if (!entities.some(entity => entity.arcText && entity.sourceId)) return entities;
        const previousById = new Map(previousEntities.map(entity => [entity.id, entity]));
        const byId = new Map(entities.map(entity => [entity.id, entity]));
        let changed = false;
        const next = entities.map(entity => {
            if (!entity.arcText || !entity.sourceId) return entity;
            // Untouched label and source: the previous commit already refreshed this pair.
            if (previousEntities !== entities && previousById.get(entity.id) === entity
                && byId.get(entity.sourceId) === previousById.get(entity.sourceId)) return entity;
            const definition = normalizeDrawingArcText(entity.arcText);
            if (!definition) return entity;
            const source = byId.get(entity.sourceId);
            const worldCandidate = source?.type === 'arc' && normalizeDrawingArcText({ ...definition, arc: source });
            const arc = worldCandidate && (identity(definition.transform) ? worldCandidate.arc : localArc(worldCandidate.arc, definition.transform));
            const candidate = arc && normalizeDrawingArcText({ ...definition, arc });
            const before = previousById.get(entity.id)?.arcText;
            const transformed = !before || JSON.stringify(before.transform) !== JSON.stringify(definition.transform);
            let result;
            if (!identity(definition.transform) && transformed && (!candidate || !equivalentArc(definition.arc, candidate.arc))) {
                const { sourceId, ...detached } = entity;
                result = { ...detached, arcText: { ...definition, status: 'current' } };
            } else if (!candidate) result = { ...entity, arcText: { ...definition, status: source ? 'invalid' : 'missing' } };
            else if (!equivalentArc(definition.arc, candidate.arc) || definition.status !== 'current') {
                result = rebuildDrawingArcTextEntity({ ...entity, arcText: { ...candidate, status: 'current' } })
                    || { ...entity, arcText: { ...definition, status: 'overflow' } };
            }
            if (!result || JSON.stringify(result) === JSON.stringify(entity)) return entity;
            changed = true; return result;
        });
        return changed ? next : entities;
    };
    const entities = refresh(content.entities, previous.entities);
    let blocksChanged = false;
    const blocks = (content.blocks || []).map(block => {
        const entities = refresh(block.entities || [], previous.blocks?.find(item => item.id === block.id)?.entities);
        if (entities === block.entities) return block;
        blocksChanged = true; return { ...block, entities };
    });
    return entities === content.entities && !blocksChanged ? content : { ...content, entities, ...(blocksChanged ? { blocks } : {}) };
}
