import { validateDrawingBlockGraph } from './drawingBlockEditing.js';
import { getEntityBounds } from './drawingGeometry.js';
import { createDrawingId, canEditEntity } from './drawingDocument.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { createAnonymousDrawingBlock, createAnonymousDrawingBlockReference, refreshDrawingBlockBounds, transformAffinePoint, transformDrawingEntityAffine, translationAffineMatrix } from './drawingBlocks.js';

export const DRAWING_LEADER_PRESENTATION = Symbol('leaderAnnotationPresentation');

export const DEFAULT_LEADER_STYLE = Object.freeze({ textSize: 0.35, arrowSize: 0.2, landingLength: 0.75, arrowType: 'closed' });

export function normalizeDrawingLeaderStyle(input = {}, presentation = false) {
    const style = { ...DEFAULT_LEADER_STYLE };
    for (const key of ['textSize', 'arrowSize', 'landingLength']) {
        const value = input?.[key];
        if (typeof value === 'number' && Number.isFinite(value)) style[key] = Math.max(key === 'textSize' ? presentation ? 1e-12 : 0.01 : 0, Math.min(presentation ? 1e12 : 10000, value));
    }
    if (['closed', 'open', 'none'].includes(input?.arrowType)) style.arrowType = input.arrowType;
    return style;
}

export function normalizeDrawingLeaderStyles(input) {
    const names = new Set();
    return (Array.isArray(input) ? input : []).slice(0, 128).flatMap(style => {
        const name = typeof style?.name === 'string' ? style.name.trim() : '';
        if (!name || name.length > 128 || names.has(name.toLowerCase())) return [];
        names.add(name.toLowerCase());
        return [{ name, ...normalizeDrawingLeaderStyle(style) }];
    });
}

export function normalizeDrawingLeader(input, presentation = false) {
    if (!input || input.version !== 1 || !Array.isArray(input.branches) || !input.branches.length || input.branches.length > 32) return null;
    if (input.branches.some(branch => !Array.isArray(branch) || branch.length < 2 || branch.length > 128
        || branch.some(point => !finitePoint(point)) || Math.hypot(branch[1].x - branch[0].x, branch[1].y - branch[0].y) < 1e-9)) return null;
    if (input.branches.reduce((sum, branch) => sum + branch.length, 0) > 1024) return null;
    return { version: 1, branches: input.branches.map(branch => branch.map(({ x, y }) => ({ x, y }))),
        style: normalizeDrawingLeaderStyle(input.style, presentation) };
}

function finitePoint(point) {
    return [point?.x, point?.y].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9);
}

export function drawingLeaderLocalPoint(reference, point) {
    const m = reference.transform;
    const determinant = m.a * m.d - m.b * m.c;
    if (!finitePoint(point) || Math.abs(determinant) < 1e-12) return null;
    const x = point.x - m.e; const y = point.y - m.f;
    return { x: (m.d * x - m.c * y) / determinant, y: (-m.b * x + m.a * y) / determinant };
}

export function drawingLeaderGrips(reference) {
    const leader = normalizeDrawingLeader(reference.leader);
    if (!leader) return [];
    return [{ id: 'leader-content', ...transformAffinePoint({ x: 0, y: 0 }, reference.transform) },
        ...leader.branches.flatMap((branch, branchIndex) => branch.map((point, index) => ({
            id: `leader-${branchIndex}-${index}`, ...transformAffinePoint(point, reference.transform),
        })))];
}

export function drawingLeaderGeometry(leader, annotation) {
    const { style } = leader;
    const landing = { x: -style.landingLength, y: 0 };
    const parts = [];
    const line = (a, b) => buildDrawingEntity('line', a, b, 'geometry');
    for (const branch of leader.branches) {
        const points = [...branch, landing];
        for (let i = 1; i < points.length; i += 1) parts.push(line(points[i - 1], points[i]));
        if (style.arrowType === 'none' || !style.arrowSize) continue;
        const tip = branch[0]; const next = branch[1];
        const length = Math.hypot(next.x - tip.x, next.y - tip.y);
        const dx = (next.x - tip.x) / length * style.arrowSize; const dy = (next.y - tip.y) / length * style.arrowSize;
        const left = { x: tip.x + dx - dy * 0.35, y: tip.y + dy + dx * 0.35 };
        const right = { x: tip.x + dx + dy * 0.35, y: tip.y + dy - dx * 0.35 };
        if (style.arrowType === 'open') parts.push(line(tip, left), line(tip, right));
        else parts.push({ id: createDrawingId('hatch'), type: 'hatch', layerId: 'geometry',
            boundaries: [{ type: 'polyline', closed: true, points: [tip, left, right] }], pattern: { type: 'solid' } });
    }
    if (style.landingLength) parts.push(line(landing, { x: 0, y: 0 }));
    parts.push(annotation);
    return parts;
}

export function drawingLeaderTextAnnotation(text, style, id = null) {
    const width = Math.max(1, ...text.split('\n').map(line => line.length * style.textSize * 0.7));
    return buildDrawingEntity('text', { x: 0, y: -style.textSize * 0.6 },
        { x: width, y: style.textSize * Math.max(1, text.split('\n').length) * 1.4 }, 'geometry', id,
        { options: { text, textMode: 'multiline', wrapMode: 'none', fontSize: style.textSize } });
}

export function createDrawingLeader(content, branches, anchor, { text = '', blockId = null, style = DEFAULT_LEADER_STYLE } = {}) {
    if (!finitePoint(anchor) || (content.blocks || []).length >= 1024 || !canEditEntity(content, { layerId: content.activeLayerId })
        || typeof text !== 'string' || text.length > 8192 || !Array.isArray(branches) || branches.some(branch => !Array.isArray(branch) || branch.some(point => !finitePoint(point)))) return { error: 'invalid' };
    const leader = normalizeDrawingLeader({ version: 1, branches: branches.map(branch => branch.map(point => ({ x: point.x - anchor.x, y: point.y - anchor.y }))), style });
    if (!leader) return { error: 'invalid' };
    const block = blockId && content.blocks.find(item => item.id === blockId);
    if (blockId && !block) return { error: 'content' };
    const annotation = block ? createAnonymousDrawingBlockReference(block) : drawingLeaderTextAnnotation(text, leader.style);
    const definition = createAnonymousDrawingBlock(drawingLeaderGeometry(leader, annotation));
    const reference = { ...createAnonymousDrawingBlockReference(definition, { insertionPoint: anchor, layerId: content.activeLayerId }), leader };
    const blocks = [...content.blocks, definition];
    if (blocks.reduce((sum, block) => sum + block.entities.length, 0) > 100000 || validateDrawingBlockGraph(blocks)) return { error: 'invalid' };
    const next = refreshDrawingBlockBounds({ ...content, blocks, entities: [...content.entities, reference] });
    return { content: next, selectedIds: [reference.id] };
}

/** Copy-on-write definitions keep duplicated leaders independently editable. */
export function updateDrawingLeader(content, referenceId, patch) {
    const reference = content.entities.find(entity => entity.id === referenceId && entity.type === 'blockReference');
    const definition = reference && content.blocks.find(block => block.id === reference.blockId);
    if (!definition || !reference.leader || !canEditEntity(content, reference)) return { error: 'selection' };
    const leader = normalizeDrawingLeader({ ...reference.leader, ...patch,
        style: { ...reference.leader.style, ...patch.style } }, Boolean(reference[DRAWING_LEADER_PRESENTATION]));
    if (!leader) return { error: 'invalid' };
    let annotation = definition.entities.at(-1);
    if (!annotation || !['text', 'blockReference'].includes(annotation.type)) return { error: 'content' };
    if (patch.blockId) {
        const block = content.blocks.find(item => item.id === patch.blockId);
        if (!block || block.id === definition.id) return { error: 'content' };
        annotation = createAnonymousDrawingBlockReference(block);
    } else if (Object.hasOwn(patch, 'text') || annotation.type === 'text') {
        const text = Object.hasOwn(patch, 'text') ? patch.text : annotation.text;
        if (typeof text !== 'string' || text.length > 8192) return { error: 'invalid' };
        annotation = drawingLeaderTextAnnotation(text, leader.style, annotation.id);
    }
    const shared = content.entities.some(entity => entity.id !== referenceId && entity.blockId === reference.blockId)
        || content.blocks.some(block => block.entities.some(entity => entity.blockId === reference.blockId));
    if (shared && content.blocks.length >= 1024) return { error: 'invalid' };
    const nextDefinition = createAnonymousDrawingBlock(drawingLeaderGeometry(leader, annotation), shared ? {} : { id: definition.id, name: definition.name });
    const nextReference = { ...reference, blockId: nextDefinition.id, leader, ...(patch.transform ? { transform: patch.transform } : {}) };
    const blocks = shared ? [...content.blocks, nextDefinition] : content.blocks.map(block => block.id === definition.id ? nextDefinition : block);
    if (blocks.reduce((sum, block) => sum + block.entities.length, 0) > 100000 || validateDrawingBlockGraph(blocks)) return { error: 'invalid' };
    const next = refreshDrawingBlockBounds({ ...content, blocks,
        entities: content.entities.map(entity => entity.id === referenceId ? nextReference : entity) });
    return { content: next, selectedIds: [referenceId] };
}

export function editDrawingLeaderGrip(content, referenceId, gripId, point) {
    const reference = content.entities.find(entity => entity.id === referenceId);
    if (!reference?.leader) return { error: 'selection' };
    const local = drawingLeaderLocalPoint(reference, point);
    if (!local) return { error: 'invalid' };
    if (gripId === 'leader-content') {
        const branches = reference.leader.branches.map(branch => branch.map(p => ({ x: p.x - local.x, y: p.y - local.y })));
        return updateDrawingLeader(content, referenceId, { branches, transform: { ...reference.transform, e: point.x, f: point.y } });
    }
    const match = /^leader-(\d+)-(\d+)$/.exec(gripId);
    if (!match) return { error: 'invalid' };
    const branchIndex = Number(match[1]); const pointIndex = Number(match[2]);
    if (!reference.leader.branches[branchIndex]?.[pointIndex]) return { error: 'invalid' };
    const branches = reference.leader.branches.map((branch, i) => branch.map((p, j) => i === branchIndex && j === pointIndex ? local : p));
    return updateDrawingLeader(content, referenceId, { branches });
}

export function alignDrawingLeaders(content, ids, axis = 'X', gap = null) {
    const references = ids.map(id => content.entities.find(entity => entity.id === id));
    if (references.length < 2 || references.some(entity => !entity?.leader || !canEditEntity(content, entity))
        || !['X', 'Y'].includes(axis) || gap !== null && (!Number.isFinite(gap) || gap < 0)) return { error: 'selection' };
    const base = transformAffinePoint({ x: 0, y: 0 }, references[0].transform);
    let next = content;
    for (let i = 1; i < references.length; i += 1) {
        const anchor = transformAffinePoint({ x: 0, y: 0 }, references[i].transform);
        const point = axis === 'X' ? { x: base.x, y: gap === null ? anchor.y : base.y + gap * i }
            : { x: gap === null ? anchor.x : base.x + gap * i, y: base.y };
        const result = editDrawingLeaderGrip(next, references[i].id, 'leader-content', point);
        if (result.error) return result;
        next = result.content;
    }
    return { content: next, selectedIds: ids };
}

export function collectDrawingLeaders(content, ids, gap = 0.5) {
    const references = ids.map(id => content.entities.find(entity => entity.id === id));
    if (references.length < 2 || references.length > 32 || references.some(entity => !entity?.leader || !canEditEntity(content, entity))
        || !Number.isFinite(gap) || gap < 0) return { error: 'selection' };
    const anchor = transformAffinePoint({ x: 0, y: 0 }, references[0].transform);
    const annotations = []; const branches = [];
    let cursor = 0;
    for (const reference of references) {
        const annotation = content.blocks.find(block => block.id === reference.blockId)?.entities.at(-1);
        if (!annotation) return { error: 'content' };
        const world = transformDrawingEntityAffine({ ...annotation, id: createDrawingId(annotation.type) }, reference.transform);
        const bounds = getEntityBounds(world);
        if (!bounds) return { error: 'content' };
        annotations.push(transformDrawingEntityAffine(world, translationAffineMatrix(cursor - bounds.minX, -bounds.minY)));
        cursor += bounds.maxX - bounds.minX + gap;
        branches.push(...reference.leader.branches.map(branch => branch.map(point => transformAffinePoint(point, reference.transform))));
    }
    const collection = createAnonymousDrawingBlock(annotations);
    const scale = Math.hypot(references[0].transform.a, references[0].transform.b);
    const style = { ...references[0].leader.style };
    for (const key of ['textSize', 'arrowSize', 'landingLength']) style[key] *= scale;
    const result = createDrawingLeader({ ...content, blocks: [...content.blocks, collection] }, branches, anchor, { blockId: collection.id, style });
    if (result.error) return result;
    const created = result.content.entities.at(-1);
    const selected = new Set(ids);
    const replacement = { ...references[0], blockId: created.blockId, transform: created.transform, leader: created.leader, definitionBounds: created.definitionBounds };
    return { content: { ...result.content, entities: content.entities.flatMap(entity => entity.id === references[0].id ? [replacement] : selected.has(entity.id) ? [] : [entity]) }, selectedIds: [replacement.id] };
}
