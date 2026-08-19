import React, { useEffect, useState } from 'react';

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

    const create = type => {
        const annotation = createDrawingPaperAnnotation(layout, type, {
            layerId: content.activeLayerId,
        });
        onChange(addDrawingPaperAnnotation(layout, annotation));
        setSelectedId(annotation.id);
    };
    const update = updater => onChange(updateDrawingPaperAnnotation(layout, selected.id, updater));
    const patch = values => update(entity => ({ ...entity, ...values }));
    const remove = () => {
        onChange(removeDrawingPaperAnnotation(layout, selected.id));
        setSelectedId(null);
    };

    return (
        <fieldset className="drawing-layout-fieldset drawing-paper-annotation-panel">
            <legend>{t('layout.paperAnnotations')}</legend>
            <p className="drawing-layout-help">{t('layout.paperAnnotationsHint')}</p>
            <div className="drawing-layout-sidebar-actions">
                <button type="button" onClick={() => create('text')}>{t('layout.addPaperText')}</button>
                <button type="button" onClick={() => create('line')}>{t('layout.addPaperLine')}</button>
                <button type="button" onClick={() => create('rectangle')}>{t('layout.addPaperRectangle')}</button>
            </div>
            {annotations.length > 0 ? (
                <label className="drawing-sidebar-field">
                    <span>{t('layout.paperAnnotation')}</span>
                    <select value={selectedId || ''} onChange={event => setSelectedId(event.target.value || null)}>
                        <option value="">{t('layout.paperAnnotationNone')}</option>
                        {annotations.map((annotation, index) => (
                            <option key={annotation.id} value={annotation.id}>
                                {t(`layout.paperAnnotation.${annotation.type}`)} {index + 1}
                            </option>
                        ))}
                    </select>
                </label>
            ) : (
                <p className="drawing-sidebar-empty">{t('layout.paperAnnotationEmpty')}</p>
            )}
            {selected && (
                <div className="drawing-paper-annotation-fields">
                    <label className="drawing-sidebar-field">
                        <span>{t('layout.paperAnnotationLayer')}</span>
                        <select value={selected.layerId} onChange={event => patch({ layerId: event.target.value })}>
                            {content.layers.map(layer => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
                        </select>
                    </label>
                    {selected.type === 'text' && <PaperTextFields annotation={selected} onChange={patch} t={t} />}
                    {selected.type === 'line' && <PaperLineFields annotation={selected} onChange={patch} t={t} />}
                    {selected.type === 'rectangle' && <PaperRectangleFields annotation={selected} onChange={patch} t={t} />}
                    <DrawingEntityAppearanceFields
                        content={content}
                        entities={[selected]}
                        onUpdate={update}
                        t={t}
                    />
                    <div className="drawing-layout-sidebar-actions">
                        <button type="button" className="is-danger" onClick={remove}>
                            {t('layout.deletePaperAnnotation')}
                        </button>
                    </div>
                </div>
            )}
        </fieldset>
    );
}

function PaperRectangleFields({ annotation, onChange, t }) {
    return (
        <>
            <div className="drawing-field-grid">
                <PaperNumberField label={t('layout.xMm')} value={annotation.x} onChange={x => onChange({ x })} />
                <PaperNumberField label={t('layout.yMm')} value={annotation.y} onChange={y => onChange({ y })} />
                <PaperNumberField label={t('layout.widthMm')} min="1" value={annotation.width} onChange={width => onChange({ width })} />
                <PaperNumberField label={t('layout.heightMm')} min="1" value={annotation.height} onChange={height => onChange({ height })} />
                <PaperNumberField label={t('layout.paperAnnotationRotation')} step="1" value={annotation.rotation} onChange={rotation => onChange({ rotation })} />
                <PaperNumberField label={t('layout.paperAnnotationCornerSize')} min="0" value={annotation.cornerValue} onChange={cornerValue => onChange({ cornerValue })} />
            </div>
            <label className="drawing-sidebar-field">
                <span>{t('layout.paperAnnotationCornerStyle')}</span>
                <select value={annotation.cornerStyle || 'square'} onChange={event => onChange({ cornerStyle: event.target.value })}>
                    {['square', 'fillet', 'chamfer'].map(style => (
                        <option key={style} value={style}>{t(`layout.paperAnnotationCornerStyle.${style}`)}</option>
                    ))}
                </select>
            </label>
        </>
    );
}

function PaperTextFields({ annotation, onChange, t }) {
    return (
        <>
            <label className="drawing-sidebar-field drawing-paper-annotation-text">
                <span>{t('layout.paperAnnotationContent')}</span>
                <textarea
                    value={annotation.text}
                    placeholder={t('layout.paperAnnotationTextPlaceholder')}
                    onChange={event => onChange({ text: event.target.value })}
                />
            </label>
            <div className="drawing-field-grid">
                <PaperNumberField label={t('layout.xMm')} value={annotation.x} onChange={x => onChange({ x })} />
                <PaperNumberField label={t('layout.yMm')} value={annotation.y} onChange={y => onChange({ y })} />
                <PaperNumberField label={t('layout.widthMm')} min="1" value={annotation.width} onChange={width => onChange({ width })} />
                <PaperNumberField label={t('layout.heightMm')} min="1" value={annotation.height} onChange={height => onChange({ height })} />
                <PaperNumberField label={t('layout.paperAnnotationFontSize')} min="0.5" step="0.5" value={annotation.fontSize} onChange={fontSize => onChange({ fontSize })} />
                <PaperNumberField label={t('layout.paperAnnotationRotation')} step="1" value={annotation.rotation} onChange={rotation => onChange({ rotation })} />
            </div>
        </>
    );
}

function PaperLineFields({ annotation, onChange, t }) {
    return (
        <div className="drawing-field-grid">
            <PaperNumberField label={t('layout.paperAnnotationX1')} value={annotation.x1} onChange={x1 => onChange({ x1 })} />
            <PaperNumberField label={t('layout.paperAnnotationY1')} value={annotation.y1} onChange={y1 => onChange({ y1 })} />
            <PaperNumberField label={t('layout.paperAnnotationX2')} value={annotation.x2} onChange={x2 => onChange({ x2 })} />
            <PaperNumberField label={t('layout.paperAnnotationY2')} value={annotation.y2} onChange={y2 => onChange({ y2 })} />
        </div>
    );
}

function PaperNumberField({ label, min, onChange, step = '0.5', value }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <input
                type="number"
                min={min}
                step={step}
                value={roundInput(value)}
                onChange={event => onChange(Number(event.target.value))}
            />
        </label>
    );
}

function roundInput(value) {
    return Math.round((Number(value) || 0) * 1_000_000) / 1_000_000;
}
