import { Button, Input, Select } from '~components/ui/Controls';
import React, { createContext, useContext } from 'react';
import { drawingEntryDirectionToWorld, drawingEntryPointToWorld, drawingWorldDirectionForDisplay, drawingWorldPointForDisplay } from '~utils/drawingCoordinates';

// Drawing settings seen through the "Y axis up" preference (identity when Y is down).
const UserSettingsContext = createContext(null);
import DrawingCommittedNumberField from './DrawingCommittedNumberField';

import {
    DRAWING_DIMENSION_TOLERANCE_MODES,
    DRAWING_DIMENSION_UNITS,
    DRAWING_LINEAR_DIMENSION_MODES,
    DRAWING_RADIAL_DIMENSION_MODES,
    getDrawingEntityDependencyIds,
    normalizeDrawingDimension,
    normalizeDrawingDimensionFormat,
    getDimensionGeometry,
} from '~utils/drawingDimensions';
import { presentDrawingDimension } from '~utils/drawingDimensionPresentation';

export default function DrawingDimensionFields({
    dimension,
    sources = null,
    automaticBreakTruncated = false,
    disabled = false,
    onChange,
    t,
    userSettings = null,
}) {
    if (!dimension || typeof onChange !== 'function' || typeof t !== 'function') return null;
    const normalized = normalizeDrawingDimension(dimension);
    const format = normalizeDrawingDimensionFormat(normalized.dimensionFormat);
    const associated = getDrawingEntityDependencyIds(normalized).length > 0;
    // Optional overrides start from what is drawn now, not from the origin.
    const presented = presentDrawingDimension(getDimensionGeometry(normalized, sources), normalized, normalized.textSize);
    const currentLabelPoint = presented?.label?.point || null;
    const currentLinePoint = presented?.kind === 'linear' ? presented.points?.[0] : null;
    const emit = patch => onChange(normalizeDrawingDimension({ ...normalized, ...patch }), patch);
    const emitFormat = patch => {
        const dimensionFormat = normalizeDrawingDimensionFormat({ ...format, ...patch });
        emit({ dimensionFormat });
    };


    return (
        <UserSettingsContext.Provider value={userSettings}>
        <section className="drawing-dimension-fields">
            {automaticBreakTruncated && <p role="status" className="drawing-sidebar-empty">{t('dimension.autoBreakTooComplex')}</p>}
            {normalized.dimensionAutoBreak && (
                <>
                    <h4>{t('dimension.fields.autoBreak')}</h4>
                    <NumberField disabled={disabled} label={t('dimension.fields.breakGap')}
                        min="0.000001" step="0.05" value={normalized.dimensionAutoBreak.gap}
                        onChange={gap => emit({ dimensionAutoBreak: { ...normalized.dimensionAutoBreak, gap } })} />
                    <Button type="button" className="drawing-secondary-button" disabled={disabled} onClick={() => emit({ dimensionAutoBreak: undefined })}>{t('dimension.disableAutoBreak')}</Button>
                </>
            )}
            <h4>{t('dimension.fields.geometry')}</h4>
            {normalized.type === 'linearDimension' && (
                <>
                    <SelectField
                        disabled={disabled}
                        label={t('dimension.fields.measurementMode')}
                        onChange={measurementMode => emit({ measurementMode })}
                        options={DRAWING_LINEAR_DIMENSION_MODES.map(value => ({
                            value,
                            label: t(`dimension.measurementMode.${value}`),
                        }))}
                        value={normalized.measurementMode}
                    />
                    {normalized.measurementMode === 'rotated' && (
                        <AngleField
                            disabled={disabled}
                            label={t('dimension.fields.dimensionAngle')}
                            onChange={dimensionAngle => emit({ dimensionAngle })}
                            value={normalized.dimensionAngle}
                        />
                    )}
                    <NumberField
                        disabled={disabled}
                        label={t('dimension.fields.offset')}
                        onChange={offset => emit({ offset })}
                        step="0.05"
                        value={normalized.offset}
                    />
                    <OptionalPointField
                        disabled={disabled}
                        initialPoint={currentLinePoint}
                        label={t('dimension.fields.linePoint')}
                        onChange={linePoint => emit({ linePoint })}
                        point={normalized.linePoint}
                        t={t}
                    />
                    {!associated && (
                        <>
                            <PointField
                                disabled={disabled}
                                label={t('dimension.fields.firstPoint')}
                                onChange={p1 => emit({ p1 })}
                                point={normalized.p1}
                                t={t}
                            />
                            <PointField
                                disabled={disabled}
                                label={t('dimension.fields.secondPoint')}
                                onChange={p2 => emit({ p2 })}
                                point={normalized.p2}
                                t={t}
                            />
                        </>
                    )}
                </>
            )}
            {normalized.type === 'radialDimension' && (
                <>
                    <SelectField
                        disabled={disabled}
                        label={t('dimension.fields.radialMode')}
                        onChange={mode => emit({ mode })}
                        options={DRAWING_RADIAL_DIMENSION_MODES.map(value => ({
                            value,
                            label: t(`dimension.radialMode.${value}`),
                        }))}
                        value={normalized.mode}
                    />
                    <AngleField
                        disabled={disabled}
                        label={t('dimension.fields.leaderAngle')}
                        onChange={angle => emit({ angle })}
                        value={normalized.angle}
                    />
                    <NumberField
                        disabled={disabled}
                        label={t('dimension.fields.leaderScale')}
                        min="1.05"
                        onChange={leaderScale => emit({ leaderScale })}
                        step="0.05"
                        value={normalized.leaderScale}
                    />
                    {normalized.mode === 'joggedRadius' && (
                        <>
                            <NumberField
                                disabled={disabled}
                                label={t('dimension.fields.jogSize')}
                                min="0"
                                onChange={jogSize => emit({ jogSize })}
                                step="0.05"
                                value={normalized.jogSize}
                            />
                            <OptionalPointField
                                disabled={disabled}
                                initialPoint={presented?.jogCenter}
                                label={t('dimension.fields.jogCenter')}
                                onChange={jogCenter => emit({ jogCenter })}
                                point={normalized.jogCenter}
                                t={t}
                            />
                            <OptionalPointField
                                disabled={disabled}
                                initialPoint={presented?.jogPoint}
                                label={t('dimension.fields.jogPoint')}
                                onChange={jogPoint => emit({ jogPoint })}
                                point={normalized.jogPoint}
                                t={t}
                            />
                        </>
                    )}
                </>
            )}
            {normalized.type === 'angularDimension' && (
                <>
                    <NumberField
                        disabled={disabled}
                        label={t('dimension.fields.radius')}
                        min="0.000001"
                        onChange={radius => emit({ radius })}
                        step="0.05"
                        value={normalized.radius}
                    />
                    <SelectField
                        disabled={disabled}
                        label={t('dimension.fields.direction')}
                        onChange={value => emit({ counterClockwise: value === 'counterClockwise' })}
                        options={['counterClockwise', 'clockwise'].map(value => ({
                            value,
                            label: t(`dimension.direction.${value}`),
                        }))}
                        value={normalized.counterClockwise ? 'counterClockwise' : 'clockwise'}
                    />
                    <CheckboxField
                        checked={normalized.reflex}
                        disabled={disabled}
                        label={t('dimension.fields.reflex')}
                        onChange={reflex => emit({ reflex })}
                    />
                    {!associated && (
                        <>
                            <PointField
                                disabled={disabled}
                                label={t('dimension.fields.vertex')}
                                onChange={vertex => emit({ vertex })}
                                point={normalized.vertex}
                                t={t}
                            />
                            <PointField
                                disabled={disabled}
                                label={t('dimension.fields.firstRayPoint')}
                                onChange={ray1Point => emit({ ray1Point })}
                                point={normalized.ray1Point}
                                t={t}
                            />
                            <PointField
                                disabled={disabled}
                                label={t('dimension.fields.secondRayPoint')}
                                onChange={ray2Point => emit({ ray2Point })}
                                point={normalized.ray2Point}
                                t={t}
                            />
                        </>
                    )}
                </>
            )}
            {normalized.type === 'arcLengthDimension' && (
                <NumberField
                    disabled={disabled}
                    label={t('dimension.fields.offset')}
                    onChange={offset => emit({ offset })}
                    step="0.05"
                    value={normalized.offset}
                />
            )}
            {normalized.type === 'ordinateDimension' && (
                <>
                    <SelectField
                        disabled={disabled}
                        label={t('dimension.fields.axis')}
                        onChange={axis => emit({ axis })}
                        options={['x', 'y'].map(value => ({
                            value,
                            label: t(`dimension.axis.${value}`),
                        }))}
                        value={normalized.axis}
                    />
                    <PointField
                        disabled={disabled}
                        label={t('dimension.fields.origin')}
                        onChange={origin => emit({ origin })}
                        point={normalized.origin}
                        t={t}
                    />
                    {(!associated || normalized.featurePoint) && (
                        <PointField
                            disabled={disabled}
                            label={t('dimension.fields.featurePoint')}
                            onChange={featurePoint => emit({ featurePoint })}
                            point={normalized.featurePoint}
                            t={t}
                        />
                    )}
                    <OptionalPointField
                        disabled={disabled}
                        initialPoint={presented?.text || currentLabelPoint}
                        label={t('dimension.fields.leaderPoint')}
                        onChange={leaderPoint => emit({ leaderPoint })}
                        point={normalized.leaderPoint}
                        t={t}
                    />
                </>
            )}
            {normalized.type === 'centerLine' && <>
                <NumberField disabled={disabled} label={t('dimension.fields.extension')} min="0" max="1000000" step="0.05"
                    value={normalized.extension} onChange={extension => emit({ extension })} />
                {associated && <CheckboxField disabled={disabled} label={t('centerLine.alternateBisector')}
                    checked={normalized.alternateBisector} onChange={alternateBisector => emit({ alternateBisector })} />}
            </>}
            {normalized.type === 'centerMark' && (
                <>
                    <NumberField
                        disabled={disabled}
                        label={t('dimension.fields.size')}
                        min="0.000001"
                        onChange={size => emit({ size })}
                        step="0.05"
                        value={normalized.size}
                    />
                    <NumberField
                        disabled={disabled}
                        label={t('dimension.fields.extension')}
                        min="0"
                        onChange={extension => emit({ extension })}
                        step="0.05"
                        value={normalized.extension}
                    />
                </>
            )}

            {!['centerMark', 'centerLine'].includes(normalized.type) && (
                <>
                    <h4>{t('dimension.fields.format')}</h4>
                    <OptionalPointField disabled={disabled} initialPoint={currentLabelPoint} label={t('dimension.fields.textPosition')}
                        point={normalized.dimensionTextPosition} t={t}
                        onChange={dimensionTextPosition => emit({ dimensionTextPosition })} />
                    <CheckboxField disabled={disabled} label={t('dimension.fields.textAngleOverride')}
                        checked={Number.isFinite(normalized.dimensionTextAngle)}
                        onChange={checked => emit({ dimensionTextAngle: checked ? Number(presented?.label?.angle) || 0 : undefined })} />
                    {Number.isFinite(normalized.dimensionTextAngle) && (
                        <AngleField disabled={disabled} label={t('dimension.fields.textAngle')}
                            value={normalized.dimensionTextAngle}
                            onChange={dimensionTextAngle => emit({ dimensionTextAngle })} />
                    )}
                    <TextField
                        disabled={disabled}
                        label={t('dimension.fields.overrideText')}
                        value={normalized.dimensionTextOverride ?? '<>'}
                        onChange={value => {
                            const next = { ...normalized };
                            if (value === '<>') delete next.dimensionTextOverride;
                            else next.dimensionTextOverride = value.slice(0, 16384);
                            onChange(next, {});
                        }}
                    />
                    <NumberField
                        disabled={disabled}
                        label={t('dimension.fields.precision')}
                        max="8"
                        min="0"
                        onChange={precision => emitFormat({ precision })}
                        step="1"
                        value={format.precision}
                    />
                    <TextField
                        disabled={disabled}
                        label={t('dimension.fields.prefix')}
                        onChange={prefix => emitFormat({ prefix })}
                        value={format.prefix}
                    />
                    <TextField
                        disabled={disabled}
                        label={t('dimension.fields.suffix')}
                        onChange={suffix => emitFormat({ suffix })}
                        value={format.suffix}
                    />
                    <DrawingDimensionFormatFields format={format} angular={normalized.type === 'angularDimension'} disabled={disabled} onChange={emitFormat} t={t} />
                </>
            )}
        </section>
        </UserSettingsContext.Provider>
    );
}

export function DrawingDimensionFormatFields({ format, angular = false, disabled = false, onChange, t }) {
    const emitTolerance = patch => onChange({
        tolerance: { ...format.tolerance, ...patch },
    });
    const emitAlternate = patch => onChange({
        alternateUnits: { ...format.alternateUnits, ...patch },
    });
    const emitInspection = patch => onChange({
        inspection: { ...format.inspection, ...patch },
    });
    return <>
                    <SelectField
                        disabled={disabled}
                        label={t('dimension.fields.toleranceMode')}
                        onChange={mode => emitTolerance({ mode })}
                        options={DRAWING_DIMENSION_TOLERANCE_MODES.map(value => ({
                            value,
                            label: t(`dimension.tolerance.${value}`),
                        }))}
                        value={format.tolerance.mode}
                    />
                    {format.tolerance.mode !== 'none' && (
                        <>
                            <ToleranceField
                                angular={angular}
                                disabled={disabled}
                                label={t('dimension.fields.toleranceUpper')}
                                onChange={upper => emitTolerance({ upper })}
                                value={format.tolerance.upper}
                            />
                            {format.tolerance.mode !== 'symmetric' && (
                                <ToleranceField
                                    angular={angular}
                                    disabled={disabled}
                                    label={t('dimension.fields.toleranceLower')}
                                    onChange={lower => emitTolerance({ lower })}
                                    value={format.tolerance.lower}
                                />
                            )}
                            <NumberField
                                disabled={disabled}
                                label={t('dimension.fields.tolerancePrecision')}
                                max="8"
                                min="0"
                                onChange={precision => emitTolerance({ precision })}
                                step="1"
                                value={format.tolerance.precision}
                            />
                        </>
                    )}
                    {!angular && <CheckboxField
                        checked={format.alternateUnits.enabled}
                        disabled={disabled}
                        label={t('dimension.fields.alternateUnits')}
                        onChange={enabled => emitAlternate({ enabled })}
                    />}
                    {!angular && format.alternateUnits.enabled && (
                        <>
                            <SelectField
                                disabled={disabled}
                                label={t('dimension.fields.alternateUnit')}
                                onChange={unit => emitAlternate({ unit })}
                                options={DRAWING_DIMENSION_UNITS.map(value => ({ value, label: value }))}
                                value={format.alternateUnits.unit}
                            />
                            <NumberField
                                disabled={disabled}
                                label={t('dimension.fields.alternatePrecision')}
                                max="8"
                                min="0"
                                onChange={precision => emitAlternate({ precision })}
                                step="1"
                                value={format.alternateUnits.precision}
                            />
                        </>
                    )}
                    <CheckboxField
                        checked={format.inspection.enabled}
                        disabled={disabled}
                        label={t('dimension.fields.inspection')}
                        onChange={enabled => emitInspection({ enabled })}
                    />
                    {format.inspection.enabled && (
                        <>
                            <TextField
                                disabled={disabled}
                                label={t('dimension.fields.inspectionLabel')}
                                onChange={label => emitInspection({ label })}
                                value={format.inspection.label}
                            />
                            <TextField
                                disabled={disabled}
                                label={t('dimension.fields.inspectionRate')}
                                onChange={rate => emitInspection({ rate })}
                                value={format.inspection.rate}
                            />
                        </>
                    )}
    </>;
}

function SelectField({ disabled, label, onChange, options, value }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <Select disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>
                {options.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </Select>
        </label>
    );
}

function NumberField({ disabled, label, max, min, mixed = false, onChange, step, value }) {
    return (
        <DrawingCommittedNumberField
            digits={String(step) === '1' ? 0 : 4}
            disabled={disabled}
            label={label}
            max={max === undefined ? Infinity : Number(max)}
            min={min === undefined ? -Infinity : Number(min)}
            mixed={mixed}
            onChange={onChange}
            value={value}
        />
    );
}

function AngleField({ disabled, label, onChange, value }) {
    const settings = useContext(UserSettingsContext);
    return (
        <NumberField
            disabled={disabled}
            label={label}
            onChange={degrees => onChange(drawingEntryDirectionToWorld(degrees, settings) * Math.PI / 180)}
            step="1"
            value={drawingWorldDirectionForDisplay(Number(value || 0) * 180 / Math.PI, settings)}
        />
    );
}

function ToleranceField({ angular, disabled, label, onChange, value }) {
    if (angular) {
        return (
            <NumberField
                disabled={disabled}
                label={`${label} (°)`}
                min="0"
                onChange={degrees => onChange(degrees * Math.PI / 180)}
                step="0.01"
                value={value * 180 / Math.PI}
            />
        );
    }
    return (
        <NumberField
            disabled={disabled}
            label={label}
            min="0"
            onChange={onChange}
            step="0.001"
            value={value}
        />
    );
}

function TextField({ disabled, label, onChange, value }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <Input
                disabled={disabled}
                onChange={event => onChange(event.target.value)}
                type="text"
                value={value}
            />
        </label>
    );
}

function CheckboxField({ checked, disabled, label, onChange }) {
    return (
        <label className="drawing-sidebar-field drawing-sidebar-checkbox">
            <Input
                checked={Boolean(checked)}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                type="checkbox"
            />
            <span>{label}</span>
        </label>
    );
}

function PointField({ disabled, label, onChange: onWorldChange, point, t }) {
    const settings = useContext(UserSettingsContext);
    const value = drawingWorldPointForDisplay(finitePoint(point), settings);
    const onChange = next => onWorldChange(drawingEntryPointToWorld(next, settings));
    return (
        <fieldset className="drawing-dimension-point-field" disabled={disabled}>
            <legend>{label}</legend>
            <NumberField
                disabled={disabled}
                label={t('dimension.fields.coordinateX')}
                onChange={x => onChange({ ...value, x })}
                step="0.01"
                value={value.x}
            />
            <NumberField
                disabled={disabled}
                label={t('dimension.fields.coordinateY')}
                onChange={y => onChange({ ...value, y })}
                step="0.01"
                value={value.y}
            />
        </fieldset>
    );
}

function OptionalPointField({ disabled, initialPoint = null, label, onChange, point, t }) {
    const enabled = Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
    return (
        <div className="drawing-dimension-optional-point">
            <CheckboxField
                checked={enabled}
                disabled={disabled}
                label={label}
                onChange={checked => onChange(checked ? finitePoint(initialPoint) : undefined)}
            />
            {enabled && (
                <PointField
                    disabled={disabled}
                    label={label}
                    onChange={onChange}
                    point={point}
                    t={t}
                />
            )}
        </div>
    );
}

function finitePoint(point) {
    return {
        x: Number.isFinite(Number(point?.x)) ? Number(point.x) : 0,
        y: Number.isFinite(Number(point?.y)) ? Number(point.y) : 0,
    };
}

export { DrawingDimensionFields };
