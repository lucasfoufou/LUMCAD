import React from 'react';

import {
    DRAWING_DIMENSION_TOLERANCE_MODES,
    DRAWING_DIMENSION_UNITS,
    DRAWING_LINEAR_DIMENSION_MODES,
    DRAWING_RADIAL_DIMENSION_MODES,
    getDrawingEntityDependencyIds,
    normalizeDrawingDimension,
    normalizeDrawingDimensionFormat,
} from '~utils/drawingDimensions';

export default function DrawingDimensionFields({
    dimension,
    disabled = false,
    onChange,
    t,
}) {
    if (!dimension || typeof onChange !== 'function' || typeof t !== 'function') return null;
    const normalized = normalizeDrawingDimension(dimension);
    const format = normalizeDrawingDimensionFormat(normalized.dimensionFormat);
    const associated = getDrawingEntityDependencyIds(normalized).length > 0;
    const emit = patch => onChange(normalizeDrawingDimension({ ...normalized, ...patch }), patch);
    const emitFormat = patch => {
        const dimensionFormat = normalizeDrawingDimensionFormat({ ...format, ...patch });
        emit({ dimensionFormat });
    };
    const emitTolerance = patch => emitFormat({
        tolerance: { ...format.tolerance, ...patch },
    });
    const emitAlternate = patch => emitFormat({
        alternateUnits: { ...format.alternateUnits, ...patch },
    });
    const emitInspection = patch => emitFormat({
        inspection: { ...format.inspection, ...patch },
    });

    return (
        <section className="drawing-dimension-fields">
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
                                label={t('dimension.fields.jogCenter')}
                                onChange={jogCenter => emit({ jogCenter })}
                                point={normalized.jogCenter}
                                t={t}
                            />
                            <OptionalPointField
                                disabled={disabled}
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
                        label={t('dimension.fields.leaderPoint')}
                        onChange={leaderPoint => emit({ leaderPoint })}
                        point={normalized.leaderPoint}
                        t={t}
                    />
                </>
            )}
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
            {normalized.type !== 'centerMark' && (
                <NumberField
                    disabled={disabled}
                    label={t('dimension.fields.textSize')}
                    min="0.01"
                    onChange={textSize => emit({ textSize })}
                    step="0.05"
                    value={Number.isFinite(Number(normalized.textSize)) ? Number(normalized.textSize) : 0.35}
                />
            )}

            {normalized.type !== 'centerMark' && (
                <>
                    <h4>{t('dimension.fields.format')}</h4>
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
                                angular={normalized.type === 'angularDimension'}
                                disabled={disabled}
                                label={t('dimension.fields.toleranceUpper')}
                                onChange={upper => emitTolerance({ upper })}
                                value={format.tolerance.upper}
                            />
                            {format.tolerance.mode !== 'symmetric' && (
                                <ToleranceField
                                    angular={normalized.type === 'angularDimension'}
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
                    {normalized.type !== 'angularDimension' && <CheckboxField
                        checked={format.alternateUnits.enabled}
                        disabled={disabled}
                        label={t('dimension.fields.alternateUnits')}
                        onChange={enabled => emitAlternate({ enabled })}
                    />}
                    {normalized.type !== 'angularDimension' && format.alternateUnits.enabled && (
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
                </>
            )}
        </section>
    );
}

function SelectField({ disabled, label, onChange, options, value }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <select disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>
                {options.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </label>
    );
}

function NumberField({ disabled, label, max, min, onChange, step, value }) {
    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <input
                disabled={disabled}
                max={max}
                min={min}
                onChange={event => onChange(Number(event.target.value))}
                step={step}
                type="number"
                value={value}
            />
        </label>
    );
}

function AngleField({ disabled, label, onChange, value }) {
    return (
        <NumberField
            disabled={disabled}
            label={label}
            onChange={degrees => onChange(degrees * Math.PI / 180)}
            step="1"
            value={Number(value || 0) * 180 / Math.PI}
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
            <input
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
            <input
                checked={Boolean(checked)}
                disabled={disabled}
                onChange={event => onChange(event.target.checked)}
                type="checkbox"
            />
            <span>{label}</span>
        </label>
    );
}

function PointField({ disabled, label, onChange, point, t }) {
    const value = finitePoint(point);
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

function OptionalPointField({ disabled, label, onChange, point, t }) {
    const enabled = Boolean(point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)));
    return (
        <div className="drawing-dimension-optional-point">
            <CheckboxField
                checked={enabled}
                disabled={disabled}
                label={label}
                onChange={checked => onChange(checked ? { x: 0, y: 0 } : undefined)}
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
