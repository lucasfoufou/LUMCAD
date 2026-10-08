import { createLcadDocument, normalizeLcadDocument } from './lcadDocument.js';
import { prepareRecoveredReferencePaths } from './lcadRecoveryReferences.js';
import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';

export function parseNewDrawingInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    if (!tokens.length) return { template: false, path: null };
    if (tokens.length === 1 && tokens[0].toUpperCase() === 'TEMPLATE') return { template: true, path: null };
    if (tokens.length === 2 && tokens[0].toUpperCase() === 'FROM' && tokens[1].trim()) return { template: true, path: tokens[1] };
    return null;
}

export function parseTemplateSaveInput(input) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return null;
    if (!tokens.length) return { path: null };
    if (tokens.length === 2 && tokens[0].toUpperCase() === 'TO' && tokens[1].trim()) return { path: tokens[1] };
    return null;
}

/** A template is an ordinary portable drawing; starting from it never adopts its file path. */
export function createLcadTemplateSession(template, { name = 'Untitled', sourcePath = null } = {}) {
    const references = prepareLcadTemplate(template, sourcePath);
    const fresh = createLcadDocument({ name });
    return {
        document: {
            ...references.document,
            id: fresh.id,
            name: fresh.name,
            createdAt: fresh.createdAt,
            updatedAt: fresh.updatedAt,
        },
        path: null,
        recovered: false,
        templateSourcePath: sourcePath,
        unresolvedReferences: references.unresolved,
    };
}

/** Pin references before the template itself can be saved in another directory. */
export function prepareLcadTemplate(document, sourcePath = null) {
    return prepareRecoveredReferencePaths(normalizeLcadDocument(structuredClone(document)), sourcePath);
}
