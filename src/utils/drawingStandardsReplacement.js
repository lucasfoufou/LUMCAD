import { checkDrawingStandards, parseDrawingStandards } from './drawingStandards.js';
import { drawingComparisonValue } from './drawingComparison.js';
import { repairDrawingStandards } from './drawingStandardsRepair.js';
import { mergeDrawingLayers } from './drawingLayers.js';
import { canEditEntity, isProtectedDrawingLayer } from './drawingDocument.js';
import { DEFAULT_DIMENSION_STYLE_ID, applyDimensionStyle } from './drawingDimensionStyles.js';
import { DEFAULT_DRAWING_TEXT_STYLE_ID } from './drawingText.js';
import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { auditDrawingDocument } from './drawingAudit.js';
import { drawingChangesAffectLockedEntities } from './drawingLockedChanges.js';

const equal = (a, b) => JSON.stringify(drawingComparisonValue(a)) === JSON.stringify(drawingComparisonValue(b));
const named = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Explicitly map one reported nonstandard definition onto an approved name, atomically. */
export function replaceDrawingStandard(document, input, report, index, targetName) {
    const standard = parseDrawingStandards(input);
    const current = checkDrawingStandards(document.content, standard);
    const issue = Number.isInteger(index) && index >= 0 ? report?.issues?.[index] : null;
    if (!issue || issue.kind !== 'nonstandard' || typeof targetName !== 'string') return { error: 'standardsSelection' };
    if (!current.issues.some(value => equal(value, issue))) return { error: 'standardsStale' };
    const approved = standard.catalogs[issue.scope].find(value => named(value.name, targetName));
    if (!approved) return { error: 'standardsTarget' };
    drawingComparisonValue(document);
    let candidate = structuredClone(document);
    const scope = issue.scope;
    const source = candidate.content[scope].find(value => named(value.name, issue.name));
    let target = candidate.content[scope].find(value => named(value.name, approved.name));
    const protectedSource = scope === 'layers' ? isProtectedDrawingLayer(source.id)
        : scope === 'textStyles' ? source.id === DEFAULT_DRAWING_TEXT_STYLE_ID
            : scope === 'dimensionStyles' ? source.id === DEFAULT_DIMENSION_STYLE_ID
                : ['tableStyles', 'multilineStyles'].includes(scope) && named(source.name, 'Standard');
    if (protectedSource) return { error: 'standardsProtected' };
    if (scope === 'layers' && source.locked) return { error: 'standardsLocked' };
    if (!target) {
        // Renaming retains every reference and avoids creating a redundant catalog entry.
        source.name = approved.name;
        target = source;
    } else if (scope === 'layers') {
        let visits = 0;
        const check = (entity, depth = 0) => {
            if (++visits > 100000 || depth > 32) throw new Error('standardsLimit');
            if (entity.layerId === source.id && !canEditEntity(document.content, entity)) throw new Error('standardsLocked');
            for (const part of entity.parts || []) check(part, depth + 1);
        };
        try {
            candidate.content.entities.forEach(entity => check(entity));
            for (const block of candidate.content.blocks || []) block.entities.forEach(entity => check(entity));
            for (const layout of candidate.layouts || []) (layout.paperEntities || []).forEach(entity => check(entity));
        } catch (error) { return { error: error.message }; }
        const merged = mergeDrawingLayers(candidate.content, [source.id], target.id, candidate.layouts || []);
        if (merged.error) return { error: 'standardsLocked' };
        candidate = { ...candidate, content: merged.content, layouts: merged.layouts };
    } else {
        candidate.content[scope] = candidate.content[scope].filter(value => value !== source);
        const field = scope === 'textStyles' ? 'textStyleId' : scope === 'dimensionStyles' ? 'dimensionStyleId' : null;
        if (field) {
            const active = scope === 'textStyles' ? 'activeTextStyleId' : 'activeDimensionStyleId';
            if (candidate.content[active] === source.id) candidate.content[active] = target.id;
            let visits = 0;
            const update = (entity, depth = 0) => {
                if (++visits > 100000 || depth > 32) throw new Error('standardsLimit');
                let result = entity;
                if (entity[field] === source.id) {
                    if (!canEditEntity(document.content, entity)) throw new Error('standardsLocked');
                    result = scope === 'dimensionStyles' ? applyDimensionStyle(entity, target, { keepOverrides: true }) : { ...entity, [field]: target.id };
                }
                return Array.isArray(result.parts) ? { ...result, parts: result.parts.map(part => update(part, depth + 1)) } : result;
            };
            try {
                candidate.content.entities = candidate.content.entities.map(entity => update(entity));
                candidate.content.blocks = (candidate.content.blocks || []).map(block => ({ ...block, entities: block.entities.map(entity => update(entity)) }));
                candidate.layouts = (candidate.layouts || []).map(layout => ({ ...layout, paperEntities: (layout.paperEntities || []).map(entity => update(entity)) }));
            } catch (error) { return { error: error.message }; }
        }
    }
    if (scope === 'layers') {
        // Saved filters may identify layers by name as well as by ID.
        candidate.content.selectionFilters = (candidate.content.selectionFilters || []).map(filter => ({ ...filter,
            criteria: filter.criteria.map(criterion => criterion.field === 'LAYER' && (criterion.value === source.id || named(criterion.value, issue.name))
                ? { ...criterion, value: target.id } : criterion) }));
    }
    const nextReport = checkDrawingStandards(candidate.content, standard);
    const propertyIndex = nextReport.issues.findIndex(value => value.scope === scope && value.kind === 'properties' && named(value.name, approved.name));
    if (propertyIndex !== -1) {
        const repaired = repairDrawingStandards(candidate, standard, nextReport, [propertyIndex]);
        if (repaired.error) return repaired;
        candidate = repaired.document;
    }
    candidate.content = refreshDrawingBlockBounds(candidate.content);
    if (drawingChangesAffectLockedEntities(document, candidate)) return { error: 'standardsLocked' };
    const audit = auditDrawingDocument(candidate);
    if (!audit.valid) return { error: 'standardsDependencies', issues: audit.issues || [] };
    return { document: candidate, report: checkDrawingStandards(candidate.content, standard), applied: 1 };
}
