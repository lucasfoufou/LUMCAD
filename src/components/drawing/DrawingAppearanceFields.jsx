import React from 'react';

import {
    DRAWING_LINE_TYPE_OPTIONS,
    DRAWING_LINE_WEIGHT_OPTIONS,
    MAX_DRAWING_TRANSPARENCY,
    clampDrawingTransparency,
    getEntityColor,
    getEntityLineType,
    getEntityLineWeight,
    getEntityTransparency,
} from '~utils/drawingDocument';

export function DrawingLayerAppearanceFields({ layer, onChange, t }) {
    return (
        <div className="drawing-layer-appearance">
            <input
                type="color"
                value={layer.color}
                aria-label={t('sidebar.layerColor', { name: layer.name })}
                onChange={event => onChange({ color: event.target.value })}
            />
            <select
                value={layer.lineWeight}
                aria-label={t('sidebar.layerLineWeight', { name: layer.name })}
                onChange={event => onChange({ lineWeight: Number(event.target.value) })}
            >
                {DRAWING_LINE_WEIGHT_OPTIONS.map(weight => (
                    <option key={weight} value={weight}>{formatWeight(weight)}</option>
                ))}
            </select>
            <select
                value={layer.lineType}
                aria-label={t('sidebar.layerLineType', { name: layer.name })}
                onChange={event => onChange({ lineType: event.target.value })}
            >
                {DRAWING_LINE_TYPE_OPTIONS.map(lineType => (
                    <option key={lineType} value={lineType}>{t(`lineType.${lineType}`)}</option>
                ))}
            </select>
            <div className="drawing-layer-transparency">
                <input
                    type="number"
                    min="0"
                    max={MAX_DRAWING_TRANSPARENCY}
                    step="5"
                    value={layer.transparency ?? 0}
                    title={t('sidebar.layerTransparency', { name: layer.name })}
                    aria-label={t('sidebar.layerTransparency', { name: layer.name })}
                    onChange={event => onChange({ transparency: clampDrawingTransparency(event.target.value) })}
                />
                <span aria-hidden="true">%</span>
            </div>
        </div>
    );
}

export function DrawingEntityAppearanceFields({ content, disabled, entities, onUpdate, t }) {
    const colorEntities = entities.filter(entity => entity.type !== 'image');
    const strokeEntities = entities.filter(supportsStrokeAppearance);
    const transparencyEntities = entities;
    return (
        <section className="drawing-appearance-panel">
            <h4>{t('sidebar.appearance')}</h4>
            {colorEntities.length > 0 && (
                <ByLayerColorField
                    content={content}
                    disabled={disabled}
                    entities={colorEntities}
                    onUpdate={onUpdate}
                    t={t}
                />
            )}
            {strokeEntities.length > 0 && (
                <>
                    <ByLayerSelectField
                        customOptions={DRAWING_LINE_WEIGHT_OPTIONS}
                        disabled={disabled}
                        entities={strokeEntities}
                        formatOption={formatWeight}
                        getResolved={entity => getEntityLineWeight(content, entity)}
                        label={t('sidebar.lineWeight')}
                        onUpdate={onUpdate}
                        property="lineWeight"
                        t={t}
                    />
                    <ByLayerSelectField
                        customOptions={DRAWING_LINE_TYPE_OPTIONS}
                        disabled={disabled}
                        entities={strokeEntities}
                        formatOption={lineType => t(`lineType.${lineType}`)}
                        getResolved={entity => getEntityLineType(content, entity)}
                        label={t('sidebar.lineType')}
                        onUpdate={onUpdate}
                        property="lineType"
                        t={t}
                    />
                </>
            )}
            {transparencyEntities.length > 0 && (
                <ByLayerTransparencyField
                    content={content}
                    disabled={disabled}
                    entities={transparencyEntities}
                    onUpdate={onUpdate}
                    t={t}
                />
            )}
        </section>
    );
}

function ByLayerColorField({ content, disabled, entities, onUpdate, t }) {
    const mode = commonMode(entities, 'color');
    const color = commonValue(entities, entity => getEntityColor(content, entity)) || getEntityColor(content, entities[0]);
    return (
        <div className="drawing-appearance-field">
            <label className="drawing-sidebar-field">
                <span>{t('sidebar.color')}</span>
                <select disabled={disabled} value={mode} onChange={event => setMode({
                    entities,
                    mode: event.target.value,
                    onUpdate,
                    property: 'color',
                    resolvedValue: entity => getEntityColor(content, entity),
                })}>
                    {mode === 'mixed' && <option value="mixed" disabled>{t('sidebar.mixed')}</option>}
                    <option value="byLayer">{t('sidebar.byLayer')}</option>
                    <option value="custom">{t('sidebar.custom')}</option>
                </select>
            </label>
            {mode === 'custom' && (
                <input
                    className="drawing-appearance-color"
                    disabled={disabled}
                    type="color"
                    value={color}
                    aria-label={t('sidebar.customColor')}
                    onChange={event => onUpdate(entity => (
                        entities.some(candidate => candidate.id === entity.id)
                            ? { ...entity, color: event.target.value }
                            : entity
                    ))}
                />
            )}
        </div>
    );
}

function ByLayerSelectField({ customOptions, disabled, entities, formatOption, getResolved, label, onUpdate, property, t }) {
    const mode = commonMode(entities, property);
    const resolved = commonValue(entities, getResolved) ?? getResolved(entities[0]);
    return (
        <div className="drawing-appearance-field">
            <label className="drawing-sidebar-field">
                <span>{label}</span>
                <select disabled={disabled} value={mode} onChange={event => setMode({
                    entities,
                    mode: event.target.value,
                    onUpdate,
                    property,
                    resolvedValue: getResolved,
                })}>
                    {mode === 'mixed' && <option value="mixed" disabled>{t('sidebar.mixed')}</option>}
                    <option value="byLayer">{t('sidebar.byLayer')}</option>
                    <option value="custom">{t('sidebar.custom')}</option>
                </select>
            </label>
            {mode === 'custom' && (
                <label className="drawing-sidebar-field drawing-appearance-custom-value">
                    <span>{t('sidebar.customValue')}</span>
                    <select disabled={disabled} value={resolved} onChange={event => {
                        const value = typeof customOptions[0] === 'number' ? Number(event.target.value) : event.target.value;
                        onUpdate(entity => entities.some(candidate => candidate.id === entity.id)
                            ? { ...entity, [property]: value }
                            : entity);
                    }}>
                        {customOptions.map(option => <option key={option} value={option}>{formatOption(option)}</option>)}
                    </select>
                </label>
            )}
        </div>
    );
}

function ByLayerTransparencyField({ content, disabled, entities, onUpdate, t }) {
    const mode = commonMode(entities, 'transparency');
    const resolved = commonValue(entities, entity => getEntityTransparency(content, entity))
        ?? getEntityTransparency(content, entities[0]);
    return (
        <div className="drawing-appearance-field">
            <label className="drawing-sidebar-field">
                <span>{t('sidebar.transparency')}</span>
                <select disabled={disabled} value={mode} onChange={event => setMode({
                    entities,
                    mode: event.target.value,
                    onUpdate,
                    property: 'transparency',
                    resolvedValue: entity => getEntityTransparency(content, entity),
                })}>
                    {mode === 'mixed' && <option value="mixed" disabled>{t('sidebar.mixed')}</option>}
                    <option value="byLayer">{t('sidebar.byLayer')}</option>
                    <option value="custom">{t('sidebar.custom')}</option>
                </select>
            </label>
            {mode === 'custom' && (
                <label className="drawing-sidebar-field drawing-appearance-custom-value">
                    <span>{t('sidebar.transparencyValue', { value: resolved })}</span>
                    <input
                        disabled={disabled}
                        type="range"
                        min="0"
                        max={MAX_DRAWING_TRANSPARENCY}
                        step="1"
                        value={resolved}
                        onChange={event => onUpdate(entity => entities.some(candidate => candidate.id === entity.id)
                            ? { ...entity, transparency: Number(event.target.value) }
                            : entity)}
                    />
                </label>
            )}
        </div>
    );
}

function setMode({ entities, mode, onUpdate, property, resolvedValue }) {
    if (!['byLayer', 'custom'].includes(mode)) return;
    const ids = new Set(entities.map(entity => entity.id));
    onUpdate(entity => {
        if (!ids.has(entity.id)) return entity;
        if (mode === 'custom') return { ...entity, [property]: resolvedValue(entity) };
        const { [property]: _removed, ...rest } = entity;
        return rest;
    });
}

function commonMode(entities, property) {
    const modes = new Set(entities.map(entity => Object.hasOwn(entity, property) ? 'custom' : 'byLayer'));
    return modes.size === 1 ? [...modes][0] : 'mixed';
}

function commonValue(entities, getter) {
    const values = new Set(entities.map(getter));
    return values.size === 1 ? [...values][0] : null;
}

function supportsStrokeAppearance(entity) {
    return ['line', 'xline', 'ray', 'polyline', 'rectangle', 'polygon', 'circle', 'arc', 'linearDimension', 'radialDimension'].includes(entity.type);
}

function formatWeight(weight) {
    return String(weight);
}
