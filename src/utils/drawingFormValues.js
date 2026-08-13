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

export function formatDecimalValue(value) {
    return Number.isFinite(value) ? String(value) : '';
}
