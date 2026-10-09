import { Button, Select } from '~components/ui/Controls';
import DrawingCreationControls from '~components/drawing/DrawingCreationControls';
import { canEditEntity } from '~utils/drawingDocument';
import React, { useEffect, useRef, useState } from 'react';

import { DrawingEntityAppearanceFields } from '~components/drawing/DrawingAppearanceFields';
import {
    DRAWING_PAPER_ANNOTATION_TYPE_OPTIONS,
    addDrawingPaperAnnotation,
    createDrawingPaperAnnotation,
    removeDrawingPaperAnnotation,
    updateDrawingPaperAnnotation,
} from '~utils/drawingLayouts';

export default function DrawingPaperAnnotationPanel({
    content,
    layout,
    onChange,
    onSelectedPaperEntityChange,
    selectedPaperEntityId,
    t,
}) {
    const annotations = (layout.paperEntities || []).filter(entity => (
        DRAWING_PAPER_ANNOTATION_TYPE_OPTIONS.includes(entity.type)
    ));
    const selectedFieldsRef = useRef(null);
    const [internalSelectedId, setInternalSelectedId] = useState(null);
    const selectedId = selectedPaperEntityId === undefined ? internalSelectedId : selectedPaperEntityId;
    const setSelectedId = value => {
        if (selectedPaperEntityId === undefined) setInternalSelectedId(value);
        onSelectedPaperEntityChange?.(value);
    };
    const selected = annotations.find(entity => entity.id === selectedId) || null;

    useEffect(() => {
        if (selectedId && !annotations.some(entity => entity.id === selectedId)) setSelectedId(null);
    }, [annotations, selectedId]);

    useEffect(() => {
        if (selectedId) selectedFieldsRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    const create = type => {
        if (!canEditEntity(content, { layerId: content.activeLayerId })) return;
        const annotation = createDrawingPaperAnnotation(layout, type, {
            layerId: content.activeLayerId,
        });
        onChange(addDrawingPaperAnnotation(layout, annotation));
        setSelectedId(annotation.id);
    };
    const update = updater => selected && canEditEntity(content, selected) && onChange(updateDrawingPaperAnnotation(layout, selected.id, updater));
    const patch = values => update(entity => ({ ...entity, ...values }));
    const remove = () => {
        if (!canEditEntity(content, selected)) return;
        onChange(removeDrawingPaperAnnotation(layout, selected.id));
        setSelectedId(null);
    };

    return (
        <fieldset className="drawing-layout-fieldset drawing-paper-annotation-panel">
            <legend>{t('layout.paperAnnotations')}</legend>
            <p className="drawing-layout-help">{t('layout.paperAnnotationsHint')}</p>
            <div className="drawing-layout-sidebar-actions">
                <Button type="button" disabled={!canEditEntity(content, { layerId: content.activeLayerId })} onClick={() => create('text')}>{t('layout.addPaperText')}</Button>
                <Button type="button" disabled={!canEditEntity(content, { layerId: content.activeLayerId })} onClick={() => create('line')}>{t('layout.addPaperLine')}</Button>
                <Button type="button" disabled={!canEditEntity(content, { layerId: content.activeLayerId })} onClick={() => create('rectangle')}>{t('layout.addPaperRectangle')}</Button>
            </div>
            {annotations.length > 0 ? (
                <label className="drawing-sidebar-field">
                    <span>{t('layout.paperAnnotation')}</span>
                    <Select value={selectedId || ''} onChange={event => setSelectedId(event.target.value || null)}>
                        <option value="">{t('layout.paperAnnotationNone')}</option>
                        {annotations.map((annotation, index) => (
                            <option key={annotation.id} value={annotation.id}>
                                {t(`layout.paperAnnotation.${annotation.type}`)} {index + 1}
                            </option>
                        ))}
                    </Select>
                </label>
            ) : (
                <p className="drawing-sidebar-empty">{t('layout.paperAnnotationEmpty')}</p>
            )}
            {selected && (
                <fieldset ref={selectedFieldsRef} className="drawing-paper-annotation-fields" disabled={!canEditEntity(content, selected)}>
                    <label className="drawing-sidebar-field">
                        <span>{t('layout.paperAnnotationLayer')}</span>
                        <Select value={selected.layerId} onChange={event => patch({ layerId: event.target.value })}>
                            {content.layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                        </Select>
                    </label>
                    <DrawingCreationControls key={selected.id} embedded lengthUnit="mm" editEntity={selected}
                        textStyles={content.textStyles} onEditChange={canEditEntity(content, selected) ? patch : null} />
                    <DrawingEntityAppearanceFields
                        content={content}
                        entities={[selected]}
                        onUpdate={update}
                        t={t}
                    />
                    <div className="drawing-layout-sidebar-actions">
                        <Button type="button" className="is-danger" onClick={remove}>
                            {t('layout.deletePaperAnnotation')}
                        </Button>
                    </div>
                </fieldset>
            )}
        </fieldset>
    );
}
