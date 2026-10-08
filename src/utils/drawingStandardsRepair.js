import { checkDrawingStandards } from './drawingStandards.js';
import { drawingComparisonValue } from './drawingComparison.js';
import { createDrawingId, canEditEntity } from './drawingDocument.js';
import { applyDimensionStyle } from './drawingDimensionStyles.js';
import { refreshDrawingBlockBounds } from './drawingBlocks.js';
import { auditDrawingDocument } from './drawingAudit.js';
import { drawingChangesAffectLockedEntities } from './drawingLockedChanges.js';

const equal = (a, b) => JSON.stringify(drawingComparisonValue(a)) === JSON.stringify(drawingComparisonValue(b));

/** Repair accepted catalog discrepancies as one candidate document; caller owns the history commit. */
export function repairDrawingStandards(document, standard, report, selectedIndexes) {
    const current = checkDrawingStandards(document.content, standard);
    if (!Array.isArray(selectedIndexes) || !selectedIndexes.length || new Set(selectedIndexes).size !== selectedIndexes.length
        || selectedIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= (report?.issues?.length || 0))) return { error: 'standardsSelection' };
    const selected = selectedIndexes.map(index => report.issues[index]);
    // Match accepted issues by content, not by a possibly shifted current report index.
    if (selected.some(issue => !current.issues.some(candidate => equal(candidate, issue)))) return { error: 'standardsStale' };
    if (selected.some(issue => issue.kind === 'nonstandard')) return { error: 'standardsReplacementRequired' };
    drawingComparisonValue(document);
    const candidate = structuredClone(document);
    const dimensionStyles = new Map();
    for (const issue of selected) {
        const catalog = candidate.content[issue.scope] ||= [];
        const position = catalog.findIndex(entry => entry.name.trim().toLowerCase() === issue.name.toLowerCase());
        if (issue.kind === 'properties') {
            catalog[position] = { ...catalog[position], ...issue.expected };
            if (issue.scope === 'dimensionStyles') dimensionStyles.set(catalog[position].id, catalog[position]);
        } else {
            const identified = ['layers', 'textStyles', 'dimensionStyles'].includes(issue.scope);
            catalog.push({ ...(identified ? { id: createDrawingId(issue.scope) } : {}), name: issue.name,
                ...(issue.scope === 'layers' ? { visible: true, frozen: false, locked: false, newViewportFrozen: false } : {}), ...issue.expected });
        }
    }
    if (dimensionStyles.size) {
        let visited = 0;
        const update = (entity, depth = 0) => {
            if (++visited > 100000 || depth > 32) throw new Error('standardsLimit');
            const style = dimensionStyles.get(entity.dimensionStyleId);
            const updated = style ? applyDimensionStyle(entity, style, { keepOverrides: true }) : entity;
            if (style && !equal(entity, updated) && !canEditEntity(document.content, entity)) throw new Error('standardsLocked');
            return Array.isArray(updated.parts) ? { ...updated, parts: updated.parts.map(part => update(part, depth + 1)) } : updated;
        };
        try {
            candidate.content.entities = candidate.content.entities.map(entity => update(entity));
            candidate.content.blocks = (candidate.content.blocks || []).map(block => ({ ...block, entities: block.entities.map(entity => update(entity)) }));
            candidate.layouts = (candidate.layouts || []).map(layout => ({ ...layout, paperEntities: (layout.paperEntities || []).map(entity => update(entity)) }));
            candidate.content = refreshDrawingBlockBounds(candidate.content);
        } catch (error) { return { error: error.message }; }
    }
    // Recheck catalog capacity/identity after additions, then validate all document dependencies.
    const remaining = checkDrawingStandards(candidate.content, standard);
    if (drawingChangesAffectLockedEntities(document, candidate)) return { error: 'standardsLocked' };
    const audit = auditDrawingDocument(candidate);
    if (!audit.valid) return { error: 'standardsDependencies', issues: audit.issues || [] };
    return { document: candidate, applied: selected.length, report: remaining };
}
