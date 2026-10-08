import { normalizeDrawingField } from './drawingFieldDefinition.js';
import { evaluateDrawingExpression } from './drawingPrecisionInput.js';
import { measureDrawingEntity } from './drawingInquiry.js';
import { getEntityBounds } from './drawingGeometry.js';
import { evaluateDrawingTable, parseTableCellAddress } from './drawingTables.js';
import { normalizeDrawingTextEntity } from './drawingText.js';

/** Evaluate against one document/time snapshot so UPDATEFIELD produces deterministic results. */
export function createDrawingFieldEvaluator(document, { now = new Date(), layoutId = null } = {}) {
    const content = document?.content || {};
    const layouts = document?.layouts || [];
    const entities = new Map((content.entities || []).map(entity => [entity.id, entity]));
    const paperLayouts = new Map();
    for (const layout of layouts) for (const entity of layout.paperEntities || []) {
        entities.set(entity.id, entity); paperLayouts.set(entity.id, layout.id);
    }
    const memo = new Map(); const visiting = new Set(); const measurements = new Map(); const tables = new Map();
    const fail = code => { throw new Error(code); };
    const scalar = value => {
        if (!['string', 'number', 'boolean'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) fail('#VALUE!');
        return value;
    };
    const evaluateEntity = (id, depth = 0) => {
        if (memo.has(id)) return memo.get(id);
        if (visiting.has(id) || depth > 64) return { error: '#CYCLE!' };
        const entity = entities.get(id);
        if (!entity?.field) return { error: '#REF!' };
        visiting.add(id);
        const result = evaluate(entity.field, { layoutId: paperLayouts.get(id) || layoutId }, depth + 1);
        visiting.delete(id); memo.set(id, result); return result;
    };
    const rawValue = (field, context, depth) => {
        if (depth > 64) fail('#CYCLE!');
        if (field.kind === 'metadata') {
            if (!Object.hasOwn(content.metadata || {}, field.key)) fail('#REF!');
            return scalar(content.metadata[field.key]);
        }
        if (field.kind === 'document') return scalar(document[field.property]);
        if (field.kind === 'date') {
            const date = now instanceof Date ? now : new Date(now);
            if (!Number.isFinite(date.getTime())) fail('#VALUE!');
            const iso = date.toISOString(); const [year, month, day] = iso.slice(0, 10).split('-');
            return { iso: iso.slice(0, 10), datetime: iso, year, dmy: `${day}/${month}/${year}`, mdy: `${month}/${day}/${year}` }[field.format];
        }
        if (field.kind === 'page') {
            if (field.property === 'count') return layouts.length;
            const index = layouts.findIndex(layout => layout.id === (field.layoutId || context.layoutId));
            if (index < 0) fail('#REF!');
            return field.property === 'number' ? index + 1 : layouts[index].name;
        }
        if (field.kind === 'formula') {
            const variables = {};
            for (const [name, binding] of Object.entries(field.bindings)) {
                const result = evaluate(binding, context, depth + 1);
                if (result.error) fail(result.error);
                if (result.number === null) fail('#VALUE!');
                variables[name] = result.number;
            }
            try { return evaluateDrawingExpression(field.expression, { variables }); }
            catch { fail('#FORMULA!'); }
        }
        const entity = entities.get(field.entityId);
        if (!entity) fail('#REF!');
        if (field.kind === 'field' || field.kind === 'object' && field.property === 'text' && entity.field) {
            const result = evaluateEntity(field.entityId, depth + 1);
            if (result.error) fail(result.error);
            return field.kind === 'field' ? result.raw : result.value;
        }
        if (field.kind === 'table') {
            if (!entity.table) fail('#REF!');
            if (!tables.has(entity.id)) tables.set(entity.id, evaluateDrawingTable(entity.table));
            const cell = parseTableCellAddress(field.address);
            const result = cell && tables.get(entity.id)?.[cell.row]?.[cell.column];
            if (!result) fail('#REF!');
            if (result.error) fail(result.error);
            return result.number ?? result.value;
        }
        if (field.property === 'type') return entity.type;
        if (field.property === 'layer') return content.layers?.find(layer => layer.id === entity.layerId)?.name ?? fail('#REF!');
        if (field.property === 'text') return scalar(entity.text);
        if (['length', 'perimeter', 'area', 'radius', 'diameter'].includes(field.property)) {
            if (!measurements.has(entity.id)) measurements.set(entity.id, measureDrawingEntity(entity));
            const measures = measurements.get(entity.id);
            const value = field.property === 'length' ? measures?.perimeter : field.property === 'diameter' ? measures?.radius * 2 : measures?.[field.property];
            return scalar(value);
        }
        const bounds = getEntityBounds(entity);
        if (!bounds) fail('#VALUE!');
        return { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY }[field.property];
    };
    const evaluate = (definition, context = { layoutId }, depth = 0) => {
        const field = normalizeDrawingField(definition);
        if (!field) return { error: '#FIELD!' };
        try {
            const raw = scalar(rawValue(field, context, depth));
            const number = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() && Number.isFinite(Number(raw)) ? Number(raw) : null;
            const text = typeof raw === 'number' ? (field.precision === undefined ? String(Number(raw.toPrecision(12))) : raw.toFixed(field.precision)) : String(raw);
            const value = `${field.prefix || ''}${text}${field.suffix || ''}`;
            if (value.length > 4096) fail('#VALUE!');
            return { raw, number, value };
        } catch (error) { return { error: ['#VALUE!', '#REF!', '#CYCLE!', '#FORMULA!'].includes(error.message) ? error.message : '#FIELD!' }; }
    };
    return { evaluate, evaluateEntity };
}

/** Cache resolved text; preserve field sources and entity IDs for archives and undo. */
export function refreshDrawingFields(document, { selectedIds = null, ...options } = {}) {
    const evaluator = createDrawingFieldEvaluator(document, options);
    const selected = selectedIds && new Set(selectedIds);
    let changed = false;
    const refresh = entity => {
        if (entity.type !== 'text' || !entity.field || selected && !selected.has(entity.id)) return entity;
        const result = evaluator.evaluateEntity(entity.id);
        const text = result.error || result.value;
        if (text === entity.text) return entity;
        changed = true;
        // Keep the run marks when a field occupies the entire text entity.
        const runs = [{ ...(entity.runs?.[0] || {}), text }];
        return normalizeDrawingTextEntity({ ...entity, text, runs });
    };
    const entities = document.content.entities.map(refresh);
    const layouts = (document.layouts || []).map(layout => {
        const paperEntities = (layout.paperEntities || []).map(refresh);
        return paperEntities.some((entity, index) => entity !== layout.paperEntities[index]) ? { ...layout, paperEntities } : layout;
    });
    return changed ? { ...document, content: { ...document.content, entities }, layouts } : document;
}
