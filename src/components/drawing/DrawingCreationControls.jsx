import { getDrawingOperationOptionSuggestions } from '~utils/drawingOperationOptions';
import { getDrawingCreationOptionSuggestions } from '~utils/drawingCreation';
import { getEntityBounds } from '~utils/drawingGeometry';
import { translateEntity } from '~utils/drawingPrimitives';
import { normalizeImageAdjustments } from '~utils/drawingImageAdjustments';
import { normalizeImageClip, parseImageClipInput } from '~utils/drawingImageClip';
import { isDrawingWipeout } from '~utils/drawingWipeout';
import { normalizeDrawingHatchPattern } from '~utils/drawingAdvancedEntities';
import React, { useEffect, useId, useRef, useState } from 'react';

import { editSplineControl, editSplineDefinitionPoint, editSplineDefinitionKnot, editSplineEndpointTangent, splineEndpointDerivative, isEditableSpline } from '~utils/drawingSplineEditing';
import { changeSplinePointList, convertSplineToControl, convertSplineToPolyline, insertSplineKnot, refitSpline } from '~utils/drawingSplineTopology';
import { MAX_SPLINE_CREATION_POINTS } from '~utils/drawingSplineCreation';
import { normalizeCurvePrimitive } from '~utils/drawingCurveKernel';
import { useI18n } from '~i18n/I18nProvider';
import { createDefaultDrawingCreationConfig, supportsDrawingCreationPanel } from '~utils/drawingCreation';
import { formatDecimalValue, parseDecimalDraft } from '~utils/drawingFormValues';
import {
    DEFAULT_DRAWING_TEXT_STYLE_ID,
    DRAWING_TEXT_FONTS,
    DRAWING_TEXT_WRAP_MODES,
    normalizeDrawingTextStyles,
    resolveDrawingTextStyle,
} from '~utils/drawingText';

export default function DrawingCreationControls({
    activeTool,
    embedded = false,
    lengthUnit = 'm',
    mode,
    options = {},
    onChange = () => {},
    editEntity = null,
    onEditChange = null,
    onImageSource = null,
    imageSourceBusy = false,
    textStyles = [],
    content = null,
    operation = null,
    commandInput = null,
    onCancel = null,
}) {
    const { t: translate } = useI18n();
    const t = (key, values) => translate(key, { unit: lengthUnit, ...values });
    const editMode = isEditableEntity(editEntity);
    const panelTool = editMode ? (isDrawingWipeout(editEntity) ? 'wipeout' : isEditableSpline(editEntity) ? 'spline' : editEntity.type) : activeTool;
    const contextual = !editMode && (operation || activeTool !== 'select');
    if (!supportsDrawingCreationPanel(panelTool) && !contextual) return null;

    const toolLabel = operation ? t('creation.context') : t(`${editMode ? 'entity' : 'commands'}.${panelTool}`);
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
            className={`drawing-creation-controls${editMode ? ' is-editing' : ''}${embedded ? ' is-embedded' : ''}`}
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
                    content={content}
                    entity={editEntity}
                    onImageSource={onImageSource}
                    imageSourceBusy={imageSourceBusy}
                    disabled={typeof onEditChange !== 'function'}
                    textStyles={textStyles}
                    t={t}
                    onChange={updateEdit}
                />
            ) : (
                <CreationFields
                    activeTool={activeTool}
                    mode={mode}
                    options={options}
                    textStyles={textStyles}
                    t={t}
                    onModeChange={updateMode}
                    onChange={updateOptions}
                />
            )}
            {contextual && commandInput && <ContextFields operation={operation} activeTool={activeTool}
                input={commandInput} onCancel={onCancel} t={t} />}
        </section>
    );
}

function ContextFields({ operation, activeTool, input, onCancel, t }) {
    const suggestions = operation ? getDrawingOperationOptionSuggestions(operation, '')
        : getDrawingCreationOptionSuggestions(activeTool, '');
    return <form className="drawing-creation-context" onSubmit={event => { event.preventDefault(); input.onSubmit?.(input.value); }}>
        {suggestions.length > 0 && <label className="drawing-creation-field">
            <span>{t('creation.contextOption')}</span>
            <select value="" onChange={event => input.onChange(`${event.target.value} `)}>
                <option value="">{t('creation.contextOption')}</option>
                {suggestions.map(option => <option key={option.command || option.name} value={option.completion}>{t(option.labelKey)}</option>)}
            </select>
        </label>}
        <label className="drawing-creation-field"><span>{t('creation.contextInput')}</span>
            <input value={input.value || ''} onChange={event => input.onChange(event.target.value)} /></label>
        <div className="drawing-layout-sidebar-actions">
            <button type="submit">{t('commandBar.enter')}</button>
            {onCancel && <button type="button" onClick={onCancel}>{t('settings.cancel')}</button>}
        </div>
    </form>;
}

function CreationFields({ activeTool, mode, options, textStyles, t, onModeChange, onChange }) {
    if (['line', 'xline', 'ray', 'polyline', 'region', 'blockReference'].includes(activeTool)) return <p>{t('creation.pickGeometry')}</p>;
    if (activeTool === 'rectangle') return <RectangleCreationFields options={options} t={t} onChange={onChange} />;
    if (activeTool === 'circle') return <CircleCreationFields mode={mode} options={options} t={t} onModeChange={onModeChange} onChange={onChange} />;
    if (activeTool === 'polygon') return <PolygonCreationFields options={options} t={t} onChange={onChange} />;
    if (activeTool === 'spline') return <div className="drawing-creation-fields"><SelectField label={t('creation.mode')} value={mode} onChange={onModeChange} options={[
        ['fit', t('creation.splineFit')], ['control', t('creation.splineControl')],
    ]} /></div>;
    if (activeTool === 'ellipse') return <EllipseFields mode={mode} options={options} t={t} onModeChange={onModeChange} onChange={onChange} />;
    if (activeTool === 'arc') return <ArcCreationFields mode={mode} options={options} t={t} onModeChange={onModeChange} onChange={onChange} />;
    if (activeTool === 'text') return <TextFields values={options} textStyles={textStyles} t={t} onChange={onChange} />;
    return null;
}

function EntityEditFields({ content, entity, disabled, textStyles, t, onChange, onImageSource, imageSourceBusy }) {
    if (['line', 'xline', 'ray'].includes(entity.type)) return <LineFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (isDrawingWipeout(entity)) return <div className="drawing-creation-fields"><SelectField label={t('wipeout.frame')} disabled={disabled}
        value={entity.wipeout.frame === false ? 'off' : 'on'} options={[['on', t('image.cropOn')], ['off', t('image.cropOff')]]}
        onChange={value => onChange({ wipeout: { frame: value === 'on' } })} /></div>;
    if (entity.leader && content) return <LeaderFields content={content} entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (['blockReference', 'region'].includes(entity.type) || (entity.type === 'polyline' && !isEditableSpline(entity))) return <PositionFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'image') return <ImageFields entity={entity} disabled={disabled} t={t} onChange={onChange} onImageSource={onImageSource} busy={imageSourceBusy} />;
    if (entity.type === 'hatch') return <HatchFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'rectangle') return <RectangleEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'circle') return <CircleEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'polygon') return <PolygonEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (isEditableSpline(entity) && entity.splineDefinition) return <SplineDefinitionFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (isEditableSpline(entity)) return <SplineEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'ellipse') return <EllipseFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'arc') return <ArcEditFields entity={entity} disabled={disabled} t={t} onChange={onChange} />;
    if (entity.type === 'text') return <TextFields values={entity} textStyles={textStyles} disabled={disabled} includeGeometry t={t} onChange={onChange} />;
    return null;
}

function LeaderFields({ content, entity, disabled, t, onChange }) {
    const annotation = content.blocks?.find(block => block.id === entity.blockId)?.entities.at(-1);
    return <>
        <PositionFields entity={entity} disabled={disabled} t={t} onChange={onChange} />
        <div className="drawing-creation-fields">
            {annotation?.type === 'text' && <TextAreaField label={t('creation.textContent')} value={annotation.text}
                disabled={disabled} onChange={text => onChange({ leaderEdit: { text } })} />}
            {['textSize', 'arrowSize', 'landingLength'].map(key => <NumberField key={key} label={t(`creation.leader.${key}`)}
                value={entity.leader.style[key]} disabled={disabled} min={0}
                onChange={value => { if (Number.isFinite(value) && value > 0 && value <= 1e6) onChange({ leaderEdit: { style: { [key]: value } } }); }} />)}
            <SelectField label={t('creation.leader.arrowType')} value={entity.leader.style.arrowType} disabled={disabled}
                options={['open', 'closed', 'none'].map(value => [value, t(`creation.leader.${value}`)])}
                onChange={arrowType => onChange({ leaderEdit: { style: { arrowType } } })} />
        </div>
    </>;
}

function LineFields({ entity, disabled, t, onChange }) {
    return <div className="drawing-creation-fields">
        {['x1', 'y1', 'x2', 'y2'].map(key => <NumberField key={key}
            label={t('creation.endpoint', { coordinate: key.toUpperCase() })} value={entity[key]} disabled={disabled}
            onChange={value => {
                if (!Number.isFinite(value) || Math.abs(value) > 1e9) return;
                const next = { ...entity, [key]: value };
                if (Math.hypot(next.x2 - next.x1, next.y2 - next.y1) > 1e-9) onChange({ [key]: value });
            }} />)}
    </div>;
}

function PositionFields({ entity, disabled, t, onChange }) {
    const bounds = getEntityBounds(entity);
    if (!bounds) return null;
    return <div className="drawing-creation-fields">
        {['x', 'y'].map(axis => <NumberField key={axis} label={t(`creation.${axis}`)}
            value={bounds[axis === 'x' ? 'minX' : 'minY']} disabled={disabled}
            onChange={value => {
                if (!Number.isFinite(value) || Math.abs(value) > 1e9) return;
                const delta = value - bounds[axis === 'x' ? 'minX' : 'minY'];
                onChange(translateEntity(entity, axis === 'x' ? delta : 0, axis === 'y' ? delta : 0));
            }} />)}
        <p className="drawing-creation-field is-wide">{t('creation.geometryGrips')}</p>
    </div>;
}

function ImageFields({ entity, disabled, t, onChange, onImageSource, busy }) {
    const settings = normalizeImageAdjustments(entity.imageAdjustments);
    const clip = normalizeImageClip(entity.imageClip);
    const rect = clip ? [Math.min(...clip.points.map(point => point.x)), Math.min(...clip.points.map(point => point.y)),
        Math.max(...clip.points.map(point => point.x)), Math.max(...clip.points.map(point => point.y))] : [0, 0, 1, 1];
    const update = patch => onChange({ imageAdjustments: { ...settings, ...patch } });
    return <div className="drawing-creation-fields">
        <DetailsFields t={t} label={t('image.source')}>
            <label className="drawing-creation-field is-wide"><span>{t('image.sourcePath')}</span><input readOnly value={entity.imageSource?.path || t('image.embedded')} title={entity.imageSource?.path || ''} /></label>
            {onImageSource && <>
                <button type="button" className="drawing-creation-action" disabled={disabled || busy} onClick={() => onImageSource('LINK')}>{t('image.sourceLink')}</button>
                <button type="button" className="drawing-creation-action" disabled={disabled || busy || !entity.imageSource} onClick={() => onImageSource('RELOAD')}>{t('image.sourceReload')}</button>
                <button type="button" className="drawing-creation-action" disabled={disabled || busy || !entity.imageSource} onClick={() => onImageSource('EMBED')}>{t('image.sourceEmbed')}</button>
            </>}
        </DetailsFields>
        {['brightness', 'contrast'].map(key => <NumberField key={key} label={t(`image.${key}`)} value={settings[key]} min={0} max={200} step={1} disabled={disabled}
            onChange={value => { if (Number.isFinite(value) && value >= 0 && value <= 200) update({ [key]: value }); }} />)}
        <SelectField label={t('image.colorMode')} value={settings.monochrome ? 'mono' : 'color'} disabled={disabled}
            options={[['color', t('image.color')], ['mono', t('image.monochrome')]]} onChange={value => update({ monochrome: value === 'mono' })} />
        <button type="button" className="drawing-creation-action" disabled={disabled} onClick={() => onChange({ imageAdjustments: normalizeImageAdjustments() })}>{t('creation.reset')}</button>
        <DetailsFields t={t} label={t('image.transparentColor')}>
            <SelectField label={t('image.colorKeyMode')} value={settings.transparentColor ? 'on' : 'off'} disabled={disabled}
                options={[['off', t('image.keyOff')], ['on', t('image.keyOn')]]}
                onChange={value => update({ transparentColor: value === 'on' ? '#ffffff' : undefined, colorTolerance: 0 })} />
            {settings.transparentColor && <>
                <label className="drawing-creation-field"><span>{t('image.transparentColor')}</span><input type="color" aria-label={t('image.transparentColor')} disabled={disabled}
                    value={settings.transparentColor} onChange={event => update({ transparentColor: event.target.value })} /></label>
                <NumberField label={t('image.colorTolerance')} value={settings.colorTolerance} min={0} max={100} step={1} disabled={disabled}
                    onChange={value => { if (Number.isFinite(value) && value >= 0 && value <= 100) update({ colorTolerance: value }); }} />
            </>}
        </DetailsFields>
        <DetailsFields t={t} label={t('image.crop')}>
            <SelectField label={t('image.cropMode')} value={clip ? clip.enabled ? 'on' : 'off' : 'none'} disabled={disabled}
                options={[['none', t('image.cropNone')], ['on', t('image.cropOn')], ['off', t('image.cropOff')]]}
                onChange={value => onChange(value === 'none' ? { imageClip: undefined }
                    : { imageClip: { ...(clip || parseImageClipInput('RECT 0 0 1 1').imageClip), enabled: value === 'on' } })} />
            {['left', 'top', 'right', 'bottom'].map((key, index) => <NumberField key={key} label={t(`image.crop.${key}`)} value={rect[index] * 100} min={0} max={100} step={1} disabled={disabled}
                onChange={value => {
                    const next = rect.map((coordinate, current) => current === index ? value / 100 : coordinate);
                    if (!(next[2] > next[0] && next[3] > next[1])) return;
                    const patch = parseImageClipInput(`RECT ${next.join(' ')}`);
                    if (patch) onChange(patch);
                }} />)}
        </DetailsFields>
    </div>;
}

function HatchFields({ entity, disabled, t, onChange }) {
    const pattern = normalizeDrawingHatchPattern(entity.pattern);
    const update = patch => onChange({ pattern: normalizeDrawingHatchPattern({ ...pattern, ...patch }) });
    return <div className="drawing-creation-fields">
        <SelectField label={t('hatch.pattern')} value={pattern.name} disabled={disabled} onChange={name => update({ name })}
            options={['solid', 'lines', 'cross', 'gradient', 'radial'].map(name => [name, t(`hatch.${name}`)])} />
        {['lines', 'cross'].includes(pattern.name) && <NumberField label={t('hatch.spacing')} value={pattern.spacing} min={0.02} max={1e6} disabled={disabled}
            onChange={value => { if (Number.isFinite(value) && value >= 0.02 && value <= 1e6) update({ spacing: value, scale: 1 }); }} />}
        {pattern.name !== 'solid' && <NumberField label={t('creation.rotation')} value={pattern.angle} disabled={disabled}
            onChange={value => { if (Number.isFinite(value)) update({ angle: value }); }} />}
        {['gradient', 'radial'].includes(pattern.name) && <label className="drawing-creation-field"><span>{t('hatch.endColor')}</span>
            <input type="color" aria-label={t('hatch.endColor')} value={pattern.endColor || '#ffffff'} disabled={disabled} onChange={event => update({ endColor: event.target.value })} />
        </label>}
        <DetailsFields t={t}>
            {['x', 'y'].map(axis => <NumberField key={axis} label={t('hatch.origin', { axis: axis.toUpperCase() })} value={pattern.origin[axis]} disabled={disabled}
                onChange={value => { if (Number.isFinite(value) && Math.abs(value) <= 1e12) update({ origin: { ...pattern.origin, [axis]: value } }); }} />)}
            {entity.sourceIds?.length > 0 && <button type="button" className="drawing-creation-action" disabled={disabled}
                onClick={() => onChange({ sourceIds: undefined })}>{t('hatch.detach')}</button>}
        </DetailsFields>
    </div>;
}

function SplineDefinitionFields({ entity, disabled, t, onChange }) {
    const [selectedPoint, setSelectedPoint] = useState(0);
    const [selectedKnot, setSelectedKnot] = useState(0);
    const [newKnot, setNewKnot] = useState(0.5);
    const definition = entity.splineDefinition;
    const pointIndex = Math.min(selectedPoint, definition.points.length - 1);
    const knotIndex = Math.min(selectedKnot, definition.knots.length - 1);
    const point = definition.points[pointIndex];
    useEffect(() => { setSelectedPoint(0); setSelectedKnot(0); }, [entity.id]);
    const update = next => { if (next !== entity) onChange(next); };
    return <div className="drawing-creation-fields">
        <SelectField label={t(definition.mode === 'fit' ? 'creation.splineFit' : 'creation.splineControl')}
            value={String(pointIndex)} onChange={value => setSelectedPoint(Number(value))}
            options={definition.points.map((point, index) => [String(index), String(index + 1)])} />
        {['x', 'y'].map(axis => <NumberField key={axis} label={t('creation.splinePointCoordinate', { index: pointIndex + 1, axis: axis.toUpperCase() })}
            value={point[axis]} disabled={disabled} onChange={value => update(editSplineDefinitionPoint(entity, pointIndex, { ...point, [axis]: value }))} />)}
        <SelectField label={t('creation.splineKnot')} value={String(knotIndex)} onChange={value => setSelectedKnot(Number(value))}
            options={definition.knots.map((knot, index) => [String(index), String(index + 1)])} />
        <NumberField label={t('creation.splineParameter')} value={definition.knots[knotIndex]} min={0} max={1} step={0.01}
            disabled={disabled || (definition.mode === 'fit' ? knotIndex === 0 || knotIndex === definition.knots.length - 1 : knotIndex < 4 || knotIndex >= definition.knots.length - 4)}
            onChange={value => update(editSplineDefinitionKnot(entity, knotIndex, value))} />
        <button type="button" className="drawing-creation-action" disabled={disabled || definition.points.length >= MAX_SPLINE_CREATION_POINTS}
            onClick={() => {
                const next = definition.points[pointIndex + 1];
                const previous = definition.points[Math.max(0, pointIndex - 1)];
                const added = next ? { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 }
                    : { x: 2 * point.x - previous.x, y: 2 * point.y - previous.y };
                update(changeSplinePointList(entity, pointIndex + 1, added));
            }}>{t('creation.splineInsertPoint')}</button>
        <button type="button" className="drawing-creation-action" disabled={disabled || definition.points.length <= (definition.mode === 'fit' ? 2 : 4)}
            onClick={() => update(changeSplinePointList(entity, pointIndex))}>{t('creation.splineRemovePoint')}</button>
        <span>{t('creation.splineReparameterize')}</span>
        {definition.mode === 'control' && <DetailsFields t={t} label={t('creation.splineInsertKnot')}>
            <NumberField label={t('creation.splineNewKnot')} value={newKnot} min={0} max={1} step={0.01} disabled={disabled} onChange={setNewKnot} />
            <button type="button" className="drawing-creation-action" disabled={disabled || definition.points.length >= MAX_SPLINE_CREATION_POINTS}
                onClick={() => update(insertSplineKnot(entity, newKnot))}>{t('creation.splineInsertKnot')}</button>
        </DetailsFields>}
        <SplineTangentFields entity={entity} disabled={disabled} t={t} onChange={update} />
        <button type="button" className="drawing-creation-action" disabled={disabled} onClick={() => onChange({ splineDefinition: undefined })}>{t('creation.splineBezier')}</button>
        <SplineConversionFields entity={entity} disabled={disabled} t={t} onChange={update} />
    </div>;
}

function SplineTangentFields({ entity, disabled, t, onChange }) {
    const [endpoint, setEndpoint] = useState('start');
    const definition = entity.splineDefinition;
    const tangent = splineEndpointDerivative(entity, endpoint);
    const key = endpoint === 'start' ? 'startTangent' : 'endTangent';
    const natural = definition.mode === 'fit' && !definition[key];
    if (!tangent) return null;
    return <DetailsFields t={t} label={t('creation.splineTangent')}>
        <SelectField label={t('creation.splineTangent')} value={endpoint} onChange={setEndpoint}
            options={['start', 'end'].map(value => [value, t(`creation.splineTangent${value === 'start' ? 'Start' : 'End'}`)])} />
        {['x', 'y'].map(axis => <NumberField key={axis} label={t('creation.splineDerivative', { axis: axis.toUpperCase() })}
            value={tangent[axis]} disabled={disabled} onChange={value => onChange(editSplineEndpointTangent(entity, endpoint, { ...tangent, [axis]: value }))} />)}
        {definition.mode === 'fit' && <button type="button" className="drawing-creation-action" disabled={disabled}
            onClick={() => onChange(editSplineEndpointTangent(entity, endpoint, natural ? tangent : null))}>
            {t(natural ? 'creation.splineConstrainTangent' : 'creation.splineNaturalTangent')}
        </button>}
    </DetailsFields>;
}

function SplineEditFields({ entity, disabled, t, onChange }) {
    const [selectedSpan, setSelectedSpan] = useState(0);
    const parts = entity.type === 'spline' ? [entity] : entity.parts;
    const span = Math.min(selectedSpan, parts.length - 1);
    useEffect(() => setSelectedSpan(0), [entity.id]);
    const controls = normalizeCurvePrimitive(parts[span])?.controlPoints || [];
    return <div className="drawing-creation-fields">
        {parts.length > 1 && <SelectField label={t('creation.splineSpan')} value={String(span)}
            onChange={value => setSelectedSpan(Number(value))} options={parts.map((part, index) => [String(index), String(index + 1)])} />}
        {controls.map((point, index) => <React.Fragment key={index}>
            {['x', 'y'].map(axis => <NumberField key={axis} label={t('creation.splineCoordinate', { index: index + 1, axis: axis.toUpperCase() })}
                value={point[axis]} disabled={disabled} onChange={value => {
                    const next = editSplineControl(entity, span, index, { ...point, [axis]: value });
                    if (next !== entity) onChange(entity.type === 'spline' ? { controlPoints: next.controlPoints } : { parts: next.parts });
                }} />)}
        </React.Fragment>)}
        <SplineConversionFields entity={entity} disabled={disabled} t={t} onChange={onChange} />
    </div>;
}

function SplineConversionFields({ entity, disabled, t, onChange }) {
    const [tolerance, setTolerance] = useState(0.001);
    const update = next => { if (next !== entity) onChange(next); };
    return <DetailsFields t={t} label={t('creation.splineConversions')}>
        <button type="button" className="drawing-creation-action" disabled={disabled} onClick={() => update(convertSplineToControl(entity))}>{t('creation.splineToControl')}</button>
        <button type="button" className="drawing-creation-action" disabled={disabled} onClick={() => update(refitSpline(entity))}>{t('creation.splineRefit')}</button>
        <NumberField label={t('creation.splineTolerance')} value={tolerance} min={0.00000001} step={0.001} disabled={disabled} onChange={setTolerance} />
        <button type="button" className="drawing-creation-action" disabled={disabled} onClick={() => update(convertSplineToPolyline(entity, tolerance))}>{t('creation.splineToPolyline')}</button>
    </DetailsFields>;
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

function EllipseFields({ entity = null, mode, options = {}, disabled = false, t, onModeChange, onChange }) {
    const values = entity || options;
    const isArc = entity ? !entity.fullEllipse : ['axisArc', 'centerArc'].includes(mode);
    const update = patch => {
        if (!entity || normalizeCurvePrimitive({ ...entity, ...patch })) onChange(patch);
    };
    return (
        <div className="drawing-creation-fields">
            {!entity && <SelectField label={t('creation.mode')} value={mode} onChange={onModeChange} options={[
                ['axis', t('creation.ellipseAxis')], ['center', t('creation.ellipseCenter')],
                ['axisArc', t('creation.ellipseArc')], ['centerArc', t('creation.ellipseCenterArc')],
            ]} />}
            {entity && <>
                <DetailsFields t={t}>
                    <NumberField label={t('creation.centerX')} value={entity.cx} disabled={disabled} onChange={value => updateFinite(update, 'cx', value)} />
                    <NumberField label={t('creation.centerY')} value={entity.cy} disabled={disabled} onChange={value => updateFinite(update, 'cy', value)} />
                    <NumberField label={t('creation.rotation')} value={entity.rotation} disabled={disabled} onChange={value => updateFinite(update, 'rotation', value)} />
                </DetailsFields>
                <NumberField label={t('creation.ellipseRadiusX')} value={entity.rx} min={0.0001} disabled={disabled} onChange={value => updatePositiveFinite(update, 'rx', value)} />
                <NumberField label={t('creation.ellipseRadiusY')} value={entity.ry} min={0.0001} disabled={disabled} onChange={value => updatePositiveFinite(update, 'ry', value)} />
                {isArc && <>
                    <NumberField label={t('creation.arcStartAngle')} value={radiansToDegrees(entity.startAngle)} disabled={disabled} onChange={value => updateAngle(update, 'startAngle', value)} />
                    <NumberField label={t('creation.arcEndAngle')} value={radiansToDegrees(entity.endAngle)} disabled={disabled} onChange={value => updateAngle(update, 'endAngle', value)} />
                </>}
            </>}
            {isArc && <SelectField label={t('creation.direction')} value={values.counterClockwise === false ? 'clockwise' : 'counterClockwise'} disabled={disabled} onChange={value => update({ counterClockwise: value !== 'clockwise' })} options={[
                ['counterClockwise', t('creation.counterClockwise')], ['clockwise', t('creation.clockwise')],
            ]} />}
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

function TextFields({ values, textStyles = [], t, onChange, disabled = false, includeGeometry = false }) {
    const updateNumber = (property, value) => updateFinite(onChange, property, value);
    const normalizedStyles = normalizeDrawingTextStyles(textStyles);
    const textMode = values.textMode === 'singleLine' ? 'singleLine' : 'multiline';
    const wrapMode = textMode === 'singleLine'
        ? 'none'
        : DRAWING_TEXT_WRAP_MODES.includes(values.wrapMode) ? values.wrapMode : 'word';
    const textStyleId = normalizedStyles.some(style => style.id === values.textStyleId)
        ? values.textStyleId
        : DEFAULT_DRAWING_TEXT_STYLE_ID;
    const resolvedStyle = resolveDrawingTextStyle({ ...values, textStyleId }, normalizedStyles);
    const changeTextMode = nextMode => onChange({
        textMode: nextMode,
        wrapMode: nextMode === 'singleLine' ? 'none' : 'word',
        ...(nextMode === 'singleLine' ? { text: String(values.text || '').replace(/\r\n?|\n/g, ' ') } : {}),
    });
    const changeTextStyle = nextStyleId => onChange({
        textStyleId: nextStyleId,
        fontFamily: undefined,
        fontSize: undefined,
        fontWeight: undefined,
        fontStyle: undefined,
        lineHeight: undefined,
        underline: undefined,
        strikethrough: undefined,
    });
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
            <SelectField label={t('creation.textMode')} value={textMode} disabled={disabled} onChange={changeTextMode} options={[
                ['singleLine', t('creation.textModeSingleLine')],
                ['multiline', t('creation.textModeMultiline')],
            ]} />
            <TextAreaField
                className="is-wide"
                label={t('creation.textContent')}
                value={values.text ?? ''}
                disabled={disabled}
                singleLine={textMode === 'singleLine'}
                placeholder={t('creation.textPlaceholder')}
                onChange={value => onChange({ text: value })}
            />
            <SelectField label={t('creation.textStyle')} value={textStyleId} disabled={disabled} onChange={changeTextStyle} options={normalizedStyles.map(style => [
                style.id,
                style.id === DEFAULT_DRAWING_TEXT_STYLE_ID ? t('creation.textStyleStandard') : style.name,
            ])} />
            <SelectField label={t('creation.textFont')} value={resolvedStyle.fontFamily} disabled={disabled} onChange={value => onChange({ fontFamily: value })} options={DRAWING_TEXT_FONTS.map(font => [
                font.id,
                t(`creation.textFont.${font.id}`),
            ])} />
            <NumberField label={t('creation.textSize')} value={resolvedStyle.fontSize} min={0.01} step={0.05} disabled={disabled} placeholder="0.35" onChange={value => updateNumber('fontSize', value)} />
            <CheckboxField label={t('creation.textBold')} checked={resolvedStyle.fontWeight >= 700} disabled={disabled} onChange={checked => onChange({ fontWeight: checked ? 700 : 400 })} />
            <CheckboxField label={t('creation.textItalic')} checked={resolvedStyle.fontStyle === 'italic'} disabled={disabled} onChange={checked => onChange({ fontStyle: checked ? 'italic' : 'normal' })} />
            <CheckboxField label={t('creation.textUnderline')} checked={resolvedStyle.underline} disabled={disabled} onChange={underline => onChange({ underline })} />
            <CheckboxField label={t('creation.textStrikethrough')} checked={resolvedStyle.strikethrough} disabled={disabled} onChange={strikethrough => onChange({ strikethrough })} />
            <SelectField label={t('creation.textWrapMode')} value={wrapMode} disabled={disabled || textMode === 'singleLine'} onChange={value => onChange({ wrapMode: value })} options={[
                ['word', t('creation.textWrapMode.word')],
                ['character', t('creation.textWrapMode.character')],
                ['none', t('creation.textWrapMode.none')],
            ]} />
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

function TextAreaField({ label, value, onChange, placeholder, disabled = false, className = '', singleLine = false }) {
    return (
        <label className={`drawing-creation-field ${className}`.trim()}>
            <span>{label}</span>
            {singleLine ? (
                <input type="text" value={value} placeholder={placeholder} disabled={disabled} onChange={event => onChange(event.target.value)} />
            ) : (
                <textarea value={value} placeholder={placeholder} disabled={disabled} rows="2" onChange={event => onChange(event.target.value)} />
            )}
        </label>
    );
}

function CheckboxField({ label, checked, onChange, disabled = false }) {
    return (
        <label className="drawing-creation-toggle">
            <input type="checkbox" checked={Boolean(checked)} disabled={disabled} onChange={event => onChange(event.target.checked)} />
            <span>{label}</span>
        </label>
    );
}

function DetailsFields({ children, t, label }) {
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
                {label || t('creation.details')}
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
