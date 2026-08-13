import React, { useEffect, useId, useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { createDefaultDrawingCreationConfig, supportsDrawingCreationPanel } from '~utils/drawingCreation';
import { formatDecimalValue, parseDecimalDraft } from '~utils/drawingFormValues';

export default function DrawingCreationControls({
    activeTool,
    mode,
    options = {},
    onChange = () => {},
    editEntity = null,
    onEditChange = null,
}) {
    const { t } = useI18n();
    const editMode = isEditableEntity(editEntity);
    const panelTool = editMode ? editEntity.type : activeTool;
    if (!supportsDrawingCreationPanel(panelTool)) return null;

    const toolLabel = t(`commands.${panelTool}`);
    const updateOptions = patch => onChange({
        mode,
        options: patchCreationOptions(options, patch),
    });
    const updateMode = nextMode => onChange({
        mode: nextMode,
        options: creationOptionsForMode(activeTool, nextMode, options),
    });
    const updateEdit = patch => {
        if (typeof onEditChange === 'function') onEditChange(patch);
    };

    return (
        <section
            className={`drawing-creation-controls${editMode ? ' is-editing' : ''}`}
            aria-label={editMode
                ? t('creation.editSelected', { tool: toolLabel })
                : t('creation.controls', { tool: toolLabel })}
        >
            <header>
                <strong>{editMode ? t('creation.editSelected', { tool: toolLabel }) : toolLabel}</strong>
                {!editMode && (
                    <button type="button" onClick={() => onChange(createDefaultDrawingCreationConfig(activeTool))}>
                        {t('creation.reset')}
                    </button>
                )}
            </header>
            {editMode ? (
                <EntityEditFields
                    entity={editEntity}
                    disabled={typeof onEditChange !== 'function'}
                    t={t}
                    onChange={updateEdit}
                />
            ) : (
                <CreationFields
                    activeTool={activeTool}
                    mode={mode}
                    options={options}
                    t={t}
                    onModeChange={updateMode}
                    onChange={updateOptions}
                />
            )}
        </section>
    );
}

function CreationFields({ activeTool, mode, options, t, onModeChange, onChange }) {
    if (activeTool === 'rectangle') return <RectangleCreationFields options={options} t={t} onChange={onChange} />;
    if (activeTool === 'circle') return <CircleCreationFields mode={mode} options={options} t={t} onModeChange={onModeChange} onChange={onChange} />;
    if (activeTool === 'polygon') return <PolygonCreationFields options={options} t={t} onChange={onChange} />;
    if (activeTool === 'arc') return <ArcCreationFields mode={mode} options={options} t={t} onModeChange={onModeChange} onChange={onChange} />;
    if (activeTool === 'text') return <TextFields values={options} t={t} onChange={onChange} />;
    return null;
}

function EntityEditFields({ entity, disabled, t, onChange }) {
    if (entity.type === 'rectangle') return <RectangleEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'circle') return <CircleEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'polygon') return <PolygonEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'arc') return <ArcEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'text') return <TextFields values={entity} disabled={disabled} includeGeometry t={t} onChange={onChange} />;
    return null;
}

function RectangleCreationFields({ options, t, onChange }) {
    const sizeMode = Number.isFinite(options.area)
        ? 'area'
        : Number.isFinite(options.width) || Number.isFinite(options.height) ? 'dimensions' : 'corners';
    const cornerStyle = Number(options.fillet) > 0 ? 'fillet' : Number(options.chamfer) > 0 ? 'chamfer' : 'square';
    const cornerSize = cornerStyle === 'fillet' ? options.fillet : cornerStyle === 'chamfer' ? options.chamfer : undefined;

    const setSizeMode = nextMode => {
        if (nextMode === 'dimensions') {
            onChange({ area: undefined, width: options.width ?? 1, height: options.height ?? 1 });
        } else if (nextMode === 'area') {
            onChange({ width: undefined, height: undefined, area: options.area ?? 1 });
        } else {
            onChange({ width: undefined, height: undefined, area: undefined });
        }
    };
    const setCornerStyle = nextStyle => {
        if (nextStyle === 'chamfer') onChange({ chamfer: options.chamfer ?? 0.25, fillet: undefined });
        else if (nextStyle === 'fillet') onChange({ chamfer: undefined, fillet: options.fillet ?? 0.25 });
        else onChange({ chamfer: undefined, fillet: undefined });
    };

    return (
        <div className="drawing-creation-fields">
            <SelectField label={t('creation.sizeMethod')} value={sizeMode} onChange={setSizeMode} options={[
                ['corners', t('creation.byCorners')],
                ['dimensions', t('creation.dimensions')],
                ['area', t('creation.byArea')],
            ]} />
            {sizeMode === 'dimensions' && (
                <>
                    <NumberField label={t('creation.width')} value={options.width} min={0.0001} onChange={value => onChange({ width: value })} />
                    <NumberField label={t('creation.height')} value={options.height} min={0.0001} onChange={value => onChange({ height: value })} />
                </>
            )}
            {sizeMode === 'area' && (
                <NumberField label={t('creation.area')} value={options.area} min={0.0001} onChange={value => onChange({ area: value })} />
            )}
            <NumberField label={t('creation.rotation')} value={options.rotation} step={1} placeholder="0" onChange={value => onChange({ rotation: value })} />
            <SelectField label={t('creation.cornerStyle')} value={cornerStyle} onChange={setCornerStyle} options={[
                ['square', t('creation.square')],
                ['chamfer', t('creation.chamfer')],
                ['fillet', t('creation.fillet')],
            ]} />
            {cornerStyle !== 'square' && (
                <NumberField
                    label={t('creation.cornerSize')}
                    value={cornerSize}
                    min={0.0001}
                    onChange={value => onChange({ [cornerStyle]: value })}
                />
            )}
            <NumberField label={t('creation.lineWidth')} value={options.lineWidth} min={0.1} placeholder={t('creation.byLayer')} onChange={value => onChange({ lineWidth: value })} />
        </div>
    );
}

function CircleCreationFields({ mode, options, t, onModeChange, onChange }) {
    const supportsRadius = ['centerRadius', 'tangentTangentRadius'].includes(mode);
    return (
        <div className="drawing-creation-fields">
            <SelectField label={t('creation.mode')} value={mode} onChange={onModeChange} options={[
                ['centerRadius', t('creation.circleCenterRadius')],
                ['twoPoint', t('creation.circleTwoPoint')],
                ['threePoint', t('creation.circleThreePoint')],
                ['tangentTangentRadius', t('creation.circleTTR')],
                ['tangentTangentTangent', t('creation.circleTTT')],
            ]} />
            {supportsRadius && (
                <NumberField
                    label={t('creation.fixedRadius')}
                    value={options.radius}
                    min={0.0001}
                    placeholder={t('creation.fromPointer')}
                    onChange={value => updatePositiveFinite(onChange, 'radius', value, true)}
                />
            )}
        </div>
    );
}

function PolygonCreationFields({ options, t, onChange }) {
    return (
        <div className="drawing-creation-fields">
            <NumberField
                label={t('creation.polygonSides')}
                value={options.sides}
                min={3}
                max={1_000}
                step={1}
                placeholder="6"
                onChange={value => onChange({
                    sides: Number.isFinite(value) ? Math.max(3, Math.min(1_000, Math.round(value))) : undefined,
                })}
            />
            <SelectField label={t('creation.polygonMode')} value={options.mode || 'inscribed'} onChange={value => onChange({ mode: value })} options={[
                ['inscribed', t('creation.inscribed')],
                ['circumscribed', t('creation.circumscribed')],
            ]} />
        </div>
    );
}

function ArcCreationFields({ mode, options, t, onModeChange, onChange }) {
    return (
        <div className="drawing-creation-fields">
            <SelectField label={t('creation.mode')} value={mode} onChange={onModeChange} options={[
                ['threePoint', t('creation.arcStartEndPoint')],
                ['startCenterEnd', t('creation.arcStartCenterEnd')],
                ['startEndRadius', t('creation.arcStartEndRadius')],
                ['startCenterAngle', t('creation.arcStartCenterAngle')],
            ]} />
            {mode !== 'threePoint' && (
                <SelectField label={t('creation.direction')} value={options.counterClockwise === false ? 'clockwise' : 'counterClockwise'} onChange={value => onChange({ counterClockwise: value !== 'clockwise' })} options={[
                    ['counterClockwise', t('creation.counterClockwise')],
                    ['clockwise', t('creation.clockwise')],
                ]} />
            )}
            {mode === 'startEndRadius' && (
                <NumberField label={t('creation.fixedRadius')} value={options.radius} min={0.0001} placeholder={t('creation.fromPointer')} onChange={value => updatePositiveFinite(onChange, 'radius', value, true)} />
            )}
            {mode === 'startCenterAngle' && (
                <NumberField label={t('creation.angle')} value={options.angle} min={0.0001} max={359.9999} placeholder={t('creation.fromPointer')} onChange={value => onChange({ angle: value })} />
            )}
        </div>
    );
}

function TextFields({ values, t, onChange, disabled = false, includeGeometry = false }) {
    const updateNumber = (property, value) => updateFinite(onChange, property, value);
    return (
        <div className="drawing-creation-fields">
            {includeGeometry && (
                <DetailsFields t={t}>
                    <NumberField label={t('creation.x')} value={values.x} disabled={disabled} onChange={value => updateNumber('x', value)} />
                    <NumberField label={t('creation.y')} value={values.y} disabled={disabled} onChange={value => updateNumber('y', value)} />
                    <NumberField label={t('creation.width')} value={values.width} disabled={disabled} onChange={value => updateNumber('width', value)} />
                    <NumberField label={t('creation.height')} value={values.height} disabled={disabled} onChange={value => updateNumber('height', value)} />
                    <NumberField label={t('creation.rotation')} value={values.rotation} step={1} disabled={disabled} onChange={value => updateNumber('rotation', value)} />
                </DetailsFields>
            )}
            <TextAreaField
                className="is-wide"
                label={t('creation.textContent')}
                value={values.text ?? ''}
                disabled={disabled}
                placeholder={t('creation.textPlaceholder')}
                onChange={value => onChange({ text: value })}
            />
            <NumberField label={t('creation.textSize')} value={values.fontSize} min={0.01} step={0.05} disabled={disabled} placeholder="0.35" onChange={value => updateNumber('fontSize', value)} />
            <SelectField label={t('creation.horizontalAlignment')} value={values.horizontalAlign || 'left'} disabled={disabled} onChange={value => onChange({ horizontalAlign: value })} options={[
                ['left', t('creation.left')],
                ['center', t('creation.centered')],
                ['right', t('creation.right')],
            ]} />
            <SelectField label={t('creation.verticalAlignment')} value={values.verticalAlign || 'top'} disabled={disabled} onChange={value => onChange({ verticalAlign: value })} options={[
                ['top', t('creation.top')],
                ['middle', t('creation.middle')],
                ['bottom', t('creation.bottom')],
            ]} />
        </div>
    );
}

function RectangleEditFields({ entity, disabled, t, onChange }) {
    const cornerStyle = ['chamfer', 'fillet'].includes(entity.cornerStyle) ? entity.cornerStyle : 'square';
    const updateNumber = (property, value) => updateFinite(onChange, property, value);
    const updateCornerStyle = nextStyle => onChange(nextStyle === 'square'
        ? { cornerStyle: 'square', cornerValue: 0 }
        : { cornerStyle: nextStyle, cornerValue: Number.isFinite(entity.cornerValue) && entity.cornerValue > 0 ? entity.cornerValue : 0.25 });
    return (
        <div className="drawing-creation-fields">
            <DetailsFields t={t}>
                <NumberField label={t('creation.x')} value={entity.x} disabled={disabled} onChange={value => updateNumber('x', value)} />
                <NumberField label={t('creation.y')} value={entity.y} disabled={disabled} onChange={value => updateNumber('y', value)} />
                <NumberField label={t('creation.width')} value={entity.width} disabled={disabled} onChange={value => updateNumber('width', value)} />
                <NumberField label={t('creation.height')} value={entity.height} disabled={disabled} onChange={value => updateNumber('height', value)} />
                <NumberField label={t('creation.rotation')} value={entity.rotation} step={1} disabled={disabled} onChange={value => updateNumber('rotation', value)} />
            </DetailsFields>
            <SelectField label={t('creation.cornerStyle')} value={cornerStyle} disabled={disabled} onChange={updateCornerStyle} options={[
                ['square', t('creation.square')],
                ['chamfer', t('creation.chamfer')],
                ['fillet', t('creation.fillet')],
            ]} />
            {cornerStyle !== 'square' && (
                <NumberField label={t('creation.cornerSize')} value={entity.cornerValue} min={0.0001} disabled={disabled} onChange={value => updateNumber('cornerValue', value)} />
            )}
        </div>
    );
}

function CircleEditFields({ entity, disabled, t, onChange }) {
    return (
        <div className="drawing-creation-fields">
            <DetailsFields t={t}>
                <NumberField label={t('creation.centerX')} value={entity.cx} disabled={disabled} onChange={value => updateFinite(onChange, 'cx', value)} />
                <NumberField label={t('creation.centerY')} value={entity.cy} disabled={disabled} onChange={value => updateFinite(onChange, 'cy', value)} />
            </DetailsFields>
            <NumberField label={t('creation.radius')} value={entity.r} min={0.0001} disabled={disabled} onChange={value => updatePositiveFinite(onChange, 'r', value)} />
        </div>
    );
}

function PolygonEditFields({ entity, disabled, t, onChange }) {
    return (
        <div className="drawing-creation-fields">
            <DetailsFields t={t}>
                <NumberField label={t('creation.centerX')} value={entity.cx} disabled={disabled} onChange={value => updateFinite(onChange, 'cx', value)} />
                <NumberField label={t('creation.centerY')} value={entity.cy} disabled={disabled} onChange={value => updateFinite(onChange, 'cy', value)} />
                <NumberField label={t('creation.rotation')} value={entity.rotation} step={1} disabled={disabled} onChange={value => updateFinite(onChange, 'rotation', value)} />
            </DetailsFields>
            <NumberField label={t('creation.radius')} value={entity.r} min={0.0001} disabled={disabled} onChange={value => updatePositiveFinite(onChange, 'r', value)} />
            <NumberField label={t('creation.polygonSides')} value={entity.sides} min={3} max={1_000} step={1} disabled={disabled} onChange={value => updateFinite(onChange, 'sides', Number.isFinite(value) ? Math.max(3, Math.min(1_000, Math.round(value))) : value)} />
            <SelectField label={t('creation.polygonMode')} value={entity.mode || 'inscribed'} disabled={disabled} onChange={value => onChange({ mode: value })} options={[
                ['inscribed', t('creation.inscribed')],
                ['circumscribed', t('creation.circumscribed')],
            ]} />
        </div>
    );
}

function ArcEditFields({ entity, disabled, t, onChange }) {
    return (
        <div className="drawing-creation-fields">
            <DetailsFields t={t}>
                <NumberField label={t('creation.centerX')} value={entity.cx} disabled={disabled} onChange={value => updateFinite(onChange, 'cx', value)} />
                <NumberField label={t('creation.centerY')} value={entity.cy} disabled={disabled} onChange={value => updateFinite(onChange, 'cy', value)} />
                <NumberField label={t('creation.arcStartAngle')} value={radiansToDegrees(entity.startAngle)} step={1} disabled={disabled} onChange={value => updateAngle(onChange, 'startAngle', value)} />
                <NumberField label={t('creation.arcEndAngle')} value={radiansToDegrees(entity.endAngle)} step={1} disabled={disabled} onChange={value => updateAngle(onChange, 'endAngle', value)} />
            </DetailsFields>
            <NumberField label={t('creation.radius')} value={entity.r} min={0.0001} disabled={disabled} onChange={value => updatePositiveFinite(onChange, 'r', value)} />
            <SelectField label={t('creation.direction')} value={entity.counterClockwise === false ? 'clockwise' : 'counterClockwise'} disabled={disabled} onChange={value => onChange({ counterClockwise: value !== 'clockwise' })} options={[
                ['counterClockwise', t('creation.counterClockwise')],
                ['clockwise', t('creation.clockwise')],
            ]} />
        </div>
    );
}

function NumberField({ label, value, onChange, min, max, step = 0.1, placeholder, disabled = false }) {
    const formattedValue = formatDecimalValue(value);
    const [draft, setDraft] = useState(formattedValue);
    const focusedRef = useRef(false);

    useEffect(() => {
        if (!focusedRef.current) setDraft(formattedValue);
    }, [formattedValue]);

    const applyDraft = rawValue => {
        setDraft(rawValue);
        const parsed = parseDecimalDraft(rawValue);
        if (parsed.kind === 'empty') onChange(undefined);
        else if (parsed.kind === 'complete') onChange(parsed.value);
    };

    const finishEditing = () => {
        focusedRef.current = false;
        const parsed = parseDecimalDraft(draft);
        if (parsed.kind === 'complete') onChange(parsed.value);
        else if (parsed.kind === 'empty') onChange(undefined);
        setDraft(formattedValue);
    };

    return (
        <label className="drawing-creation-field">
            <span>{label}</span>
            <input
                type="text"
                role="spinbutton"
                inputMode="decimal"
                value={draft}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={Number.isFinite(value) ? value : undefined}
                data-step={step}
                placeholder={placeholder}
                disabled={disabled}
                onFocus={() => { focusedRef.current = true; }}
                onChange={event => applyDraft(event.target.value)}
                onBlur={finishEditing}
            />
        </label>
    );
}

function TextAreaField({ label, value, onChange, placeholder, disabled = false, className = '' }) {
    return (
        <label className={`drawing-creation-field ${className}`.trim()}>
            <span>{label}</span>
            <textarea value={value} placeholder={placeholder} disabled={disabled} rows="2" onChange={event => onChange(event.target.value)} />
        </label>
    );
}

function DetailsFields({ children, t }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="drawing-creation-details">
            <button
                type="button"
                className="drawing-creation-details-toggle"
                aria-expanded={open}
                onClick={() => setOpen(current => !current)}
            >
                <span aria-hidden="true">{open ? '^' : '>'}</span>
                {t('creation.details')}
            </button>
            {open && <div className="drawing-creation-details-fields">{children}</div>}
        </div>
    );
}

function SelectField({ label, value, onChange, options, disabled = false }) {
    const fieldRef = useRef(null);
    const triggerRef = useRef(null);
    const labelId = useId();
    const listboxId = useId();
    const [open, setOpen] = useState(false);
    const selected = options.find(([optionValue]) => optionValue === value) || options[0];

    useEffect(() => {
        if (!open) return undefined;
        const closeOnOutsidePointer = event => {
            if (fieldRef.current?.contains(event.target)) return;
            setOpen(false);
            triggerRef.current?.blur();
        };
        document.addEventListener('pointerdown', closeOnOutsidePointer, true);
        return () => document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    }, [open]);

    const selectValue = nextValue => {
        onChange(nextValue);
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.blur());
    };

    return (
        <div ref={fieldRef} className="drawing-creation-field drawing-creation-select-field">
            <span id={labelId}>{label}</span>
            <button
                ref={triggerRef}
                type="button"
                className="drawing-creation-select"
                role="combobox"
                aria-labelledby={labelId}
                aria-controls={listboxId}
                aria-expanded={open}
                aria-haspopup="listbox"
                disabled={disabled}
                onClick={() => setOpen(current => !current)}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        setOpen(false);
                        event.currentTarget.blur();
                    } else if (event.key === 'ArrowDown') {
                        event.preventDefault();
                        setOpen(true);
                    }
                }}
            >
                <span>{selected?.[1] || ''}</span>
                <span aria-hidden="true">⌄</span>
            </button>
            {open && (
                <div id={listboxId} className="drawing-creation-select-menu" role="listbox" aria-labelledby={labelId}>
                    {options.map(([optionValue, optionLabel]) => (
                        <button
                            type="button"
                            role="option"
                            aria-selected={optionValue === value}
                            className={optionValue === value ? 'is-selected' : ''}
                            key={optionValue}
                            onClick={() => selectValue(optionValue)}
                        >
                            {optionLabel}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

function updateFinite(onChange, property, value) {
    if (Number.isFinite(value)) onChange({ [property]: value });
}

function updatePositiveFinite(onChange, property, value, allowUndefined = false) {
    if (value === undefined && allowUndefined) onChange({ [property]: undefined });
    else if (Number.isFinite(value) && value > 0 && value <= 1e12) onChange({ [property]: value });
}

function updateAngle(onChange, property, value) {
    if (Number.isFinite(value)) onChange({ [property]: value * Math.PI / 180 });
}

function radiansToDegrees(value) {
    return Number.isFinite(value) ? value * 180 / Math.PI : undefined;
}

function isEditableEntity(entity) {
    return supportsDrawingCreationPanel(entity);
}

function patchCreationOptions(options, patch) {
    const next = { ...options };
    Object.entries(patch).forEach(([key, value]) => {
        if (value === undefined || value === null) delete next[key];
        else next[key] = value;
    });
    return next;
}

function creationOptionsForMode(tool, mode, options) {
    if (tool === 'arc') return patchCreationOptions(options, { radius: undefined, angle: undefined });
    if (tool === 'circle' && !['centerRadius', 'tangentTangentRadius'].includes(mode)) {
        return patchCreationOptions(options, { radius: undefined });
    }
    return { ...options };
}
