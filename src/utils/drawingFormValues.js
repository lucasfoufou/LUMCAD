export function parseDecimalDraft(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return { kind: 'empty', value: undefined };

    const normalized = raw.replace(',', '.');
    if (/^[+-]?(?:\d+|\d*\.\d+)$/.test(normalized)) {
        const numeric = Number(normalized);
        if (Number.isFinite(numeric)) return { kind: 'complete', value: numeric };
    }
    if (/^[+-]?(?:\d+\.?|\.?)?$/.test(normalized)) {
        return { kind: 'incomplete', value: undefined };
    }
    return { kind: 'invalid', value: undefined };
}

// Fields show at most this many decimals: 0.1 mm for distances in metres.
export const DEFAULT_DECIMAL_FIELD_PRECISION = 4;

/**
 * Editable representation of a number in the interface language: a comma
 * separates decimals in French, a point in English, without digit grouping
 * so the text can be parsed back. Values are rounded to `precision` decimals.
 */
export function formatDecimalValue(value, { locale = 'en', precision = DEFAULT_DECIMAL_FIELD_PRECISION } = {}) {
    if (!Number.isFinite(value)) return '';
    const digits = Number.isInteger(precision) && precision >= 0 && precision <= 12 ? precision : DEFAULT_DECIMAL_FIELD_PRECISION;
    const rounded = Number(value.toFixed(digits));
    const text = String(Object.is(rounded, -0) ? 0 : rounded);
    // Very large or small magnitudes keep the exponent form, which parses back.
    if (/e/i.test(text)) return text;
    return locale === 'fr' ? text.replace('.', ',') : text;
}
