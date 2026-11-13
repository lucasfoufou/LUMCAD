import { parseDecimalDraft } from './drawingFormValues.js';

/** Rounds a stored value for display without changing the stored precision. */
export function formatCommittedDecimal(value, { locale = 'en', digits = 4 } = {}) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '';
    const factor = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)));
    const rounded = Math.round(numeric * factor) / factor;
    const text = String(Object.is(rounded, -0) ? 0 : rounded);
    return locale === 'fr' ? text.replace('.', ',') : text;
}

/**
 * Resolves the draft typed in a committed decimal field. Returns `null` when the
 * draft must be discarded (invalid, empty or unchanged), otherwise the clamped value.
 */
export function resolveCommittedDecimal(draft, { min = -Infinity, max = Infinity, current = undefined, digits = 4 } = {}) {
    const parsed = parseDecimalDraft(draft);
    if (parsed.kind !== 'complete') return null;
    const value = Math.max(Number(min), Math.min(Number(max), parsed.value));
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    // Re-validating the displayed rounding of the current value is not an edit.
    if (Number.isFinite(Number(current)) && Math.round(Number(current) * factor) === Math.round(value * factor)) return null;
    return value;
}
