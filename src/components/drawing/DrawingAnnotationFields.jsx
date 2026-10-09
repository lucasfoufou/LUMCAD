import React from 'react';
import { ANNOTATION_LIMIT, currentAnnotationScale, normalizeAnnotationScales, normalizeDrawingAnnotation, supportsDrawingAnnotation } from '~utils/drawingAnnotations';
import { canEditEntity } from '~utils/drawingDocument';

export default function DrawingAnnotationFields({ content, selectedIds, onCommand, t }) {
    const current = currentAnnotationScale(content);
    const catalog = normalizeAnnotationScales([...(content.annotationScales || normalizeAnnotationScales()), current]);
    const selectedIdSet = new Set(selectedIds);
    const selected = content.entities.filter(entity => selectedIdSet.has(entity.id));
    const editable = selected.length > 0 && selected.every(entity => supportsDrawingAnnotation(entity) && canEditEntity(content, entity));
    const annotation = selected.length === 1 ? normalizeDrawingAnnotation(selected[0].annotation) : null;
    return <details className="drawing-annotation-fields">
        <summary>{t('annotation.current', { scale: current })}</summary>
        {content[ANNOTATION_LIMIT] && <p role="status">{t('annotation.limit')}</p>}
        <label className="drawing-sidebar-field"><span>{t('annotation.currentLabel')}</span>
            <select value={current} onChange={event => onCommand('scaleListEdit', `CURRENT ${event.target.value}`)}>
                {catalog.map(scale => <option key={scale} value={scale}>1:{scale}</option>)}
            </select>
        </label>
        <label className="drawing-sidebar-check"><input type="checkbox" checked={content.settings?.annotationShowAll === true}
            onChange={event => onCommand('scaleListEdit', `ALLVISIBLE ${event.target.checked ? 'ON' : 'OFF'}`)} />{t('annotation.showAll')}</label>
        {editable && <label className="drawing-sidebar-check"><input type="checkbox" checked={selected.every(entity => Boolean(entity.annotation))}
            onChange={event => onCommand('objectScale', event.target.checked ? 'ON' : 'OFF')} />{t('annotation.enabled')}</label>}
        {editable && annotation && <>
            <label className="drawing-sidebar-field"><span>{t('annotation.add')}</span>
                <select value="" onChange={event => onCommand('objectScale', `ADD ${event.target.value}`)}>
                    <option value="">{t('annotation.add')}</option>
                    {catalog.filter(scale => !annotation.scales.some(item => item.scale === scale)).map(scale => <option key={scale} value={scale}>1:{scale}</option>)}
                </select>
            </label>
            {annotation.scales.map(item => <div className="drawing-layout-sidebar-actions" key={item.scale}>
                <span>1:{item.scale}</span><button type="button" disabled={annotation.scales.length <= 1}
                    onClick={() => onCommand('objectScale', `DELETE ${item.scale}`)} aria-label={t('annotation.remove', { scale: item.scale })}>×</button>
            </div>)}
            <div className="drawing-layout-sidebar-actions">
                <button type="button" onClick={() => onCommand('annotationReset', '')}>{t('commands.annotationReset')}</button>
                <button type="button" onClick={() => onCommand('annotationUpdate', '')}>{t('commands.annotationUpdate')}</button>
            </div>
        </>}
    </details>;
}
