import React from 'react';

import { useI18n } from '~i18n/I18nProvider';

export default function DrawingDynamicInput({
    anchor,
    enabled = true,
    value = '',
    onChange,
    onSubmit,
}) {
    const { t } = useI18n();
    if (!enabled || !anchor) return null;
    const submit = event => {
        event.preventDefault();
        onSubmit?.(value);
    };
    return (
        <form
            className="drawing-dynamic-input"
            style={{ left: anchor.x, top: anchor.y }}
            onSubmit={submit}
            onPointerDown={event => event.stopPropagation()}
        >
            <span aria-hidden="true">⌖</span>
            <input
                type="text"
                value={value}
                onChange={event => onChange?.(event.target.value)}
                aria-label={t('dynamicInput.label')}
                placeholder={t('dynamicInput.placeholder')}
                autoComplete="off"
                spellCheck="false"
            />
        </form>
    );
}
