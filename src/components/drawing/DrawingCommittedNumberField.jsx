import { Input } from '~components/ui/Controls';
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '~i18n/I18nProvider';
import { formatCommittedDecimal, resolveCommittedDecimal } from '~utils/drawingDecimalInput';

/**
 * Decimal sidebar field that commits once, on Enter or when focus leaves.
 * Escape restores the stored value. `mixed` shows an empty field for a
 * multi-selection whose values differ.
 */
export default function DrawingCommittedNumberField({
    disabled = false,
    digits = 4,
    label,
    max = Infinity,
    min = -Infinity,
    mixed = false,
    onChange,
    value,
}) {
    const { locale, t } = useI18n();
    const display = mixed ? '' : formatCommittedDecimal(value, { locale, digits });
    const [draft, setDraft] = useState(display);
    const editingRef = useRef(false);
    const cancelledRef = useRef(false);

    useEffect(() => {
        if (!editingRef.current) setDraft(display);
    }, [display]);

    const commit = () => {
        editingRef.current = false;
        if (cancelledRef.current) {
            cancelledRef.current = false;
            setDraft(display);
            return;
        }
        const next = resolveCommittedDecimal(draft, { min, max, digits, current: mixed ? undefined : value });
        if (next !== null) onChange(next);
        setDraft(display);
    };

    return (
        <label className="drawing-sidebar-field">
            <span>{label}</span>
            <Input
                disabled={disabled}
                inputMode="decimal"
                placeholder={mixed ? t('dimension.fields.mixed') : undefined}
                type="text"
                value={draft}
                onFocus={() => { editingRef.current = true; }}
                onChange={event => { editingRef.current = true; setDraft(event.target.value); }}
                onBlur={commit}
                onKeyDown={event => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                    } else if (event.key === 'Escape') {
                        event.preventDefault();
                        cancelledRef.current = true;
                        event.currentTarget.blur();
                    }
                }}
            />
        </label>
    );
}
