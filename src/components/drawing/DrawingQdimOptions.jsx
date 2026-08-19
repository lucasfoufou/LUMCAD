import React, { useEffect, useId, useRef, useState } from 'react';

import {
    DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    DRAWING_QDIM_BASELINE_ENDS,
    DRAWING_QDIM_MODES,
    normalizeDrawingQdimBaselineEnd,
    normalizeDrawingQdimMode,
    reverseDrawingQdimBaselineEnd,
} from '~utils/drawingDimensions';

export default function DrawingQdimOptions({
    mode = 'continuous',
    baselineEnd = 'first',
    offset = 0.6,
    spacing = DEFAULT_DRAWING_QDIM_BASELINE_SPACING,
    disabled = false,
    onChange,
    t,
}) {
    const modeName = useId();
    if (typeof onChange !== 'function' || typeof t !== 'function') return null;
    const normalizedMode = normalizeDrawingQdimMode(mode);
    const normalizedBaselineEnd = normalizeDrawingQdimBaselineEnd(baselineEnd);
    const normalizedOffset = roundControlValue(finiteOr(offset, 0.6));
    const normalizedSpacing = Math.max(0, roundControlValue(
        finiteOr(spacing, DEFAULT_DRAWING_QDIM_BASELINE_SPACING),
    ));
    const emit = patch => onChange({
        mode: normalizedMode,
        baselineEnd: normalizedBaselineEnd,
        offset: normalizedOffset,
        spacing: normalizedSpacing,
        ...patch,
    }, patch);

    return (
        <fieldset className="drawing-qdim-options" disabled={disabled}>
            <legend>{t('dimension.qdim.mode')}</legend>
            <div className="drawing-qdim-mode-options">
                {DRAWING_QDIM_MODES.map(value => (
                    <label key={value} className="drawing-sidebar-check">
                        <input
                            checked={normalizedMode === value}
                            name={modeName}
                            onChange={() => emit({ mode: value })}
                            type="radio"
                            value={value}
                        />
                        {t(`dimension.qdim.mode.${value}`)}
                    </label>
                ))}
            </div>
            <label className="drawing-sidebar-field">
                <span>{t('dimension.qdim.offset')}</span>
                <QdimNumberInput
                    disabled={disabled}
                    onValueChange={offsetValue => emit({ offset: offsetValue })}
                    step="0.05"
                    value={normalizedOffset}
                />
            </label>
            {normalizedMode === 'baseline' && (
                <div className="drawing-qdim-baseline-options">
                    <label className="drawing-sidebar-field">
                        <span>{t('dimension.qdim.spacing')}</span>
                        <QdimNumberInput
                            disabled={disabled}
                            min="0"
                            onValueChange={spacingValue => emit({ spacing: spacingValue })}
                            step="0.05"
                            value={normalizedSpacing}
                        />
                    </label>
                    <label className="drawing-sidebar-field">
                        <span>{t('dimension.qdim.baselineEnd')}</span>
                        <select
                            value={normalizedBaselineEnd}
                            onChange={event => emit({
                                baselineEnd: normalizeDrawingQdimBaselineEnd(event.target.value),
                            })}
                        >
                            {DRAWING_QDIM_BASELINE_ENDS.map(value => (
                                <option key={value} value={value}>
                                    {t(`dimension.qdim.baselineEnd.${value}`)}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button
                        className="drawing-secondary-button"
                        onClick={() => emit({
                            baselineEnd: reverseDrawingQdimBaselineEnd(normalizedBaselineEnd),
                        })}
                        type="button"
                    >
                        {t('dimension.qdim.reverseBaseline')}
                    </button>
                </div>
            )}
        </fieldset>
    );
}

function QdimNumberInput({ disabled, min = null, onValueChange, step = '1', value }) {
    const editingRef = useRef(false);
    const [draft, setDraft] = useState(() => String(value));
    const minimum = min === null ? null : Number(min);
    const stepValue = Math.abs(finiteOr(step, 1)) || 1;

    useEffect(() => {
        if (!editingRef.current) setDraft(String(value));
    }, [value]);

    const publish = candidate => {
        const number = parseNumericDraft(candidate);
        if (number === null || (Number.isFinite(minimum) && number < minimum)) return false;
        onValueChange(number);
        return true;
    };
    const finishEditing = () => {
        editingRef.current = false;
        const number = parseNumericDraft(draft);
        if (number === null || (Number.isFinite(minimum) && number < minimum)) {
            setDraft(String(value));
            return;
        }
        const normalized = roundControlValue(number);
        setDraft(String(normalized));
        onValueChange(normalized);
    };

    return (
        <input
            aria-valuemin={Number.isFinite(minimum) ? minimum : undefined}
            aria-valuenow={parseNumericDraft(draft) ?? undefined}
            disabled={disabled}
            inputMode="decimal"
            onBlur={finishEditing}
            onChange={event => {
                const candidate = event.target.value;
                setDraft(candidate);
                publish(candidate);
            }}
            onFocus={() => { editingRef.current = true; }}
            onKeyDown={event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                    event.preventDefault();
                    setDraft(String(value));
                    event.currentTarget.blur();
                } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    const current = parseNumericDraft(draft) ?? finiteOr(value, 0);
                    const direction = event.key === 'ArrowUp' ? 1 : -1;
                    const next = Math.max(
                        Number.isFinite(minimum) ? minimum : -Infinity,
                        roundControlValue(current + stepValue * direction),
                    );
                    setDraft(String(next));
                    onValueChange(next);
                }
            }}
            role="spinbutton"
            type="text"
            value={draft}
        />
    );
}

function parseNumericDraft(value) {
    const text = String(value ?? '').trim();
    if (!text || ['-', '+', '.', '-.', '+.'].includes(text)) return null;
    const number = Number(text.replace(',', '.'));
    return Number.isFinite(number) ? number : null;
}

function finiteOr(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function roundControlValue(value) {
    return Math.round(value * 1_000_000_000) / 1_000_000_000;
}

export { DrawingQdimOptions };
