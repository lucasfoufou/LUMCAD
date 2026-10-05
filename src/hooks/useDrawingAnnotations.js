import { useCallback, useMemo } from 'react';
import { canEditEntity } from '~utils/drawingDocument';
import { ANNOTATION_HIDDEN, currentAnnotationScale, normalizeAnnotationScales, normalizeDrawingAnnotation, resolveDrawingAnnotationContent, restoreDrawingAnnotationContent, commitDrawingAnnotationRepresentation, supportsDrawingAnnotation, validAnnotationRatio, validAnnotationScale } from '~utils/drawingAnnotations';

export default function useDrawingAnnotations({ history, enabled, selectedIds, setSelectedIds, setMessage, t }) {
    const content = useMemo(() => enabled ? resolveDrawingAnnotationContent(history.content) : history.content, [enabled, history.content]);
    const commit = useCallback((nextOrUpdater, options) => history.commit(current => {
        const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(enabled ? resolveDrawingAnnotationContent(current) : current) : nextOrUpdater;
        return restoreDrawingAnnotationContent(next);
    }, options), [history.commit, enabled]);
    const run = (command, input) => {
        if (!['objectScale', 'scaleListEdit', 'annotationUpdate', 'annotationReset'].includes(command)) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const source = history.content;
        const scale = currentAnnotationScale(source);
        const tokens = input.trim().split(/\s+/).filter(Boolean);
        const action = (tokens.shift() || 'LIST').toUpperCase();
        const invalid = () => setMessage(t('annotation.invalid'));
        const save = next => { history.commit(next); setMessage(t('annotation.updated')); };
        if (command === 'scaleListEdit') {
            const catalog = normalizeAnnotationScales(source.annotationScales);
            const requested = Number(tokens[0]);
            if (action === 'LIST' && !tokens.length) setMessage(t('annotation.list', { scales: catalog.join(', '), current: scale }));
            else if (action === 'CURRENT' && tokens.length === 1 && validAnnotationScale(requested)) {
                save({ ...source, settings: { ...source.settings, annotationScale: requested }, annotationScales: normalizeAnnotationScales([...catalog, requested]) }); setSelectedIds([]);
            } else if (action === 'ALLVISIBLE' && tokens.length === 1 && ['ON', 'OFF'].includes(tokens[0].toUpperCase())) {
                save({ ...source, settings: { ...source.settings, annotationShowAll: tokens[0].toUpperCase() === 'ON' } }); setSelectedIds([]);
            } else if (action === 'ADD' && tokens.length === 1 && validAnnotationScale(requested) && (catalog.includes(requested) || catalog.length < 128)) save({ ...source, annotationScales: normalizeAnnotationScales([...catalog, requested]) });
            else if (action === 'DELETE' && tokens.length === 1 && catalog.includes(requested)) {
                const used = requested === scale || [...source.entities, ...source.blocks.flatMap(block => block.entities)].some(entity => normalizeDrawingAnnotation(entity.annotation)?.scales.some(item => item.scale === requested));
                if (used) { setMessage(t('annotation.used')); return true; }
                save({ ...source, annotationScales: catalog.filter(value => value !== requested) });
            } else if (action === 'RESET' && !tokens.length) save({ ...source, annotationScales: normalizeAnnotationScales() });
            else invalid();
            return true;
        }
        const selected = source.entities.filter(entity => selectedIds.includes(entity.id));
        if (!selected.length || selected.some(entity => !canEditEntity(source, entity) || !supportsDrawingAnnotation(entity))) { setMessage(t('annotation.selection')); return true; }
        if (command === 'annotationUpdate' && !input.trim() || command === 'objectScale' && action === 'OFF' && !tokens.length) {
            const next = commitDrawingAnnotationRepresentation(source, selectedIds, scale, { detach: command === 'objectScale' });
            if (!next || next.blocks.length > 1024 || next.blocks.reduce((sum, block) => sum + block.entities.length, 0) > 100000) invalid();
            else save(next);
            return true;
        }
        if (command === 'objectScale' && action === 'LIST' && !tokens.length) {
            setMessage(selected.map(entity => `${entity.id}: ${normalizeDrawingAnnotation(entity.annotation)?.scales.map(item => item.scale).join(', ') || '—'}`).join('\n')); return true;
        }
        let failed = false;
        const entities = source.entities.map(entity => {
            if (!selectedIds.includes(entity.id)) return entity;
            const annotation = normalizeDrawingAnnotation(entity.annotation);
            if (command === 'annotationReset' && !input.trim() && annotation) return { ...entity, annotation: { ...annotation, scales: annotation.scales.map(item => ({ ...item, offset: { x: 0, y: 0 } })) } };
            if (command === 'objectScale') {
                if (action === 'ON' && !tokens.length) return annotation ? entity : { ...entity, annotation: { baseScale: scale, scales: [{ scale, offset: { x: 0, y: 0 } }] } };
                if (annotation && ['ADD', 'DELETE'].includes(action) && tokens.length === 1 && validAnnotationScale(Number(tokens[0])) && validAnnotationRatio(Number(tokens[0]), annotation.baseScale)) {
                    const requested = Number(tokens[0]);
                    const exists = annotation.scales.some(item => item.scale === requested);
                    if (action === 'ADD' && exists) return entity;
                    if (action === 'ADD' && annotation.scales.length < 64) return { ...entity, annotation: { ...annotation, scales: [...annotation.scales, { scale: requested, offset: { x: 0, y: 0 } }] } };
                    if (action === 'DELETE' && exists && annotation.scales.length > 1) return { ...entity, annotation: { ...annotation, scales: annotation.scales.filter(item => item.scale !== requested) } };
                }
                if (annotation && action === 'OFFSET' && tokens.length === 3 && tokens.every(value => Number.isFinite(Number(value)))) {
                    const [requested, x, y] = tokens.map(Number);
                    if (Math.max(Math.abs(x), Math.abs(y)) <= 1e9 && annotation.scales.some(item => item.scale === requested)) return { ...entity, annotation: { ...annotation, scales: annotation.scales.map(item => item.scale === requested ? { ...item, offset: { x, y } } : item) } };
                }
            }
            failed = true; return entity;
        });
        if (failed) invalid(); else {
            const next = { ...source, entities };
            save(next);
            const visible = resolveDrawingAnnotationContent(next).entities.filter(entity => !entity[ANNOTATION_HIDDEN]).map(entity => entity.id);
            setSelectedIds(selectedIds.filter(id => visible.includes(id)));
        }
        return true;
    };
    return { history: { ...history, content, commit }, run };
}
