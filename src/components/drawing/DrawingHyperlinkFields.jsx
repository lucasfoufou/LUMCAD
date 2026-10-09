import { Button, Input } from '~components/ui/Controls';
import React, { useEffect, useState } from 'react';
import { useI18n } from '~i18n/I18nProvider';
import { setDrawingHyperlink } from '~utils/drawingHyperlinkOperations';
import { openDrawingHyperlink } from '~utils/openDrawingHyperlink';

export default function DrawingHyperlinkFields({ content, entity, disabled, onCommit }) {
    const { t } = useI18n();
    const [url, setUrl] = useState(entity.hyperlink?.url || '');
    const [label, setLabel] = useState(entity.hyperlink?.label || '');
    const [error, setError] = useState(false);
    useEffect(() => {
        setUrl(entity.hyperlink?.url || ''); setLabel(entity.hyperlink?.label || ''); setError(false);
    }, [entity.id, entity.hyperlink?.url, entity.hyperlink?.label]);
    const apply = link => {
        try {
            const next = setDrawingHyperlink(content, [entity.id], link);
            if (next !== content) onCommit(next);
            setError(false);
        }
        catch { setError(true); }
    };
    return <fieldset className="drawing-hyperlink-fields">
        <legend>{t('hyperlink.title')}</legend>
        <label className="drawing-sidebar-field"><span>{t('hyperlink.url')}</span>
            <Input value={url} disabled={disabled} maxLength={4096} onChange={event => setUrl(event.target.value)} />
        </label>
        <label className="drawing-sidebar-field"><span>{t('hyperlink.label')}</span>
            <Input value={label} disabled={disabled} maxLength={256} onChange={event => setLabel(event.target.value)} />
        </label>
        <div className="drawing-sidebar-actions">
            <Button type="button" disabled={disabled} onClick={() => apply({ url, label })}>{t('hyperlink.apply')}</Button>
            <Button type="button" disabled={disabled || !entity.hyperlink} onClick={() => apply(null)}>{t('hyperlink.remove')}</Button>
            <Button type="button" disabled={!entity.hyperlink} onClick={() => openDrawingHyperlink(entity.hyperlink).catch(() => setError(true))}>{t('hyperlink.open')}</Button>
        </div>
        {entity.hyperlink && <p className="drawing-hyperlink-target">{entity.hyperlink.url}</p>}
        {error && <p role="alert">{t('hyperlink.failed')}</p>}
    </fieldset>;
}
