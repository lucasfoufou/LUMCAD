import { repairDrawingGroupCatalog } from './drawingGroupAudit.js';
import { auditDrawingDocument, DRAWING_AUDIT_MAX_OBJECTS, repairDrawingDocument } from './drawingAudit.js';
import { normalizeDrawingGeometricConstraints } from './drawingConstraintDefinition.js';

const ENTITY_DEFECTS = new Set(['invalidEntity', 'invalidGeometry', 'unknownEntityType', 'missingBlock', 'missingAsset', 'missingSource', 'missingId', 'duplicateId']);

function documentScopes(document) {
    return [{ owner: document.content, key: 'entities', path: 'content.entities' },
        ...(document.content.blocks || []).map((owner, index) => ({ owner, key: 'entities', path: `content.blocks[${index}].entities` })),
        ...(document.layouts || []).map((owner, index) => ({ owner, key: 'paperEntities', path: `layouts[${index}].paperEntities` }))];
}

/** Salvage a copy. Quarantined objects retain their complete raw value in the report. */
export function salvageDrawingDocument(source, { maxPasses = 64, maxObjects = DRAWING_AUDIT_MAX_OBJECTS, maxIssues = 10000, recoveredLayerName } = {}) {
    if (!Number.isInteger(maxPasses) || maxPasses < 1 || maxPasses > 256) return { error: 'invalid' };
    const limits = { maxObjects, maxIssues };
    const first = repairDrawingDocument(source, { ...limits, ...(recoveredLayerName ? { recoveredLayerName } : {}) });
    if (first.error) return first;
    const document = structuredClone(first.document);
    const quarantine = []; const repairs = [...first.repairs]; let audit = first;
    for (let pass = 0; pass < maxPasses; pass += 1) {
        let progress = false;
        for (const scope of documentScopes(document)) {
            if (!scope.owner || !Array.isArray(scope.owner[scope.key])) continue;
            const removals = new Map();
            for (const issue of audit.issues) {
                if (!ENTITY_DEFECTS.has(issue.code) || !issue.path.startsWith(`${scope.path}[`)) continue;
                const suffix = issue.path.slice(scope.path.length);
                const match = /^\[(\d+)\](?:$|\.)/.exec(suffix);
                if (!match) continue;
                const index = Number(match[1]);
                if (!removals.has(index)) removals.set(index, []);
                removals.get(index).push(issue);
            }
            if (removals.size) {
                scope.owner[scope.key] = scope.owner[scope.key].filter((entity, index) => {
                    if (!removals.has(index)) return true;
                    quarantine.push({ kind: 'entity', path: `${scope.path}[${index}]`, value: structuredClone(entity), issues: removals.get(index) });
                    progress = true; return false;
                });
            }
            // Keep the largest valid ordered subset without moving any surviving geometry.
            if (scope.key === 'entities' && Array.isArray(scope.owner.geometricConstraints)) {
                const kept = [];
                for (const [index, relation] of scope.owner.geometricConstraints.entries()) {
                    if (normalizeDrawingGeometricConstraints([...kept, relation], scope.owner.entities)) kept.push(relation);
                    else {
                        quarantine.push({ kind: 'geometricConstraint', path: `${scope.path.replace(/\.entities$/, '')}.geometricConstraints[${index}]`, value: structuredClone(relation) });
                        progress = true;
                    }
                }
                if (kept.length !== scope.owner.geometricConstraints.length) scope.owner.geometricConstraints = kept;
            }
        }
        const groupRepair = repairDrawingGroupCatalog(document.content);
        if (groupRepair.repairs.length) {
            document.content.groups = groupRepair.groups;
            repairs.push(...groupRepair.repairs);
            progress = true;
        }
        if (quarantine.length + repairs.length > maxIssues) return { error: 'limit' };
        audit = auditDrawingDocument(document, limits);
        if (audit.error) return audit;
        if (!progress || audit.valid) return { document, changed: first.changed || quarantine.length > 0,
            report: { valid: audit.valid, examined: audit.examined, issues: audit.issues, beforeIssues: first.before.issues, repairs, quarantine } };
    }
    return { error: 'limit' };
}
