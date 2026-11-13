import { Input } from '~components/ui/Controls';
import React from 'react';

import { useI18n } from '~i18n/I18nProvider';

export default function DrawingDynamicInput({
    anchor,
    enabled = true,
    value = '',
    measure = '',
    inputVisible = true,
    onChange,
    onSubmit,
}) {
    const { t } = useI18n();
    if (!enabled || !anchor) return null;
    const typing = String(value).length > 0;
    const submit = event => {
        event.preventDefault();
        onSubmit?.(value);
    };
    // Until the user types, the box is transparent to the pointer (see the
    // stylesheet): it sits beside the cursor and must never swallow a canvas click.
    return (
        <form
            className={`drawing-dynamic-input${typing ? ' is-typing' : ''}${inputVisible ? '' : ' is-measure-only'}`}
            style={{ left: anchor.x, top: anchor.y }}
            onSubmit={submit}
            onPointerDown={event => { if (typing) event.stopPropagation(); }}
        >
            {inputVisible && (
                <Input
                    type="text"
                    value={value}
                    onChange={event => onChange?.(event.target.value)}
                    aria-label={t('dynamicInput.label')}
                    placeholder={t('dynamicInput.placeholder')}
                    autoComplete="off"
                    spellCheck="false"
                />
            )}
            {measure && <output className="drawing-dynamic-input-measure" aria-label={t('dynamicInput.measure')}>{measure}</output>}
        </form>
    );
}
