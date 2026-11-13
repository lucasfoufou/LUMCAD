import { Button, Input } from '~components/ui/Controls';
import React, { useEffect, useRef, useState } from 'react';
import Icon from '~components/ui/Icon';
import { useI18n } from '~i18n/I18nProvider';
import { currentAnnotationScale } from '~utils/drawingAnnotations';
import { countDrawingPlanScaleAnnotations, DRAWING_PLAN_SCALE_PRESETS, parseDrawingPlanScale } from '~utils/drawingPlanScale';

/**
 * Plan scale in the model status bar: annotation sizes are paper millimetres
 * multiplied by this scale. Changing it asks whether existing dimensions and
 * texts are resized too; either answer is a single undo step.
 */
export default function DrawingPlanScaleControl({ content, onCommand }) {
    const { locale, t } = useI18n();
    const scale = currentAnnotationScale(content);
    const [open, setOpen] = useState(false);
    const [pending, setPending] = useState(null);
    const [draft, setDraft] = useState('');
    const ref = useRef(null);
    const formatted = formatScale(scale, locale);

    useEffect(() => {
        if (!open) return undefined;
        const close = event => {
            if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) {
                setOpen(false);
                setPending(null);
            }
        };
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('keydown', close, true);
        return () => {
            window.removeEventListener('pointerdown', close, true);
            window.removeEventListener('keydown', close, true);
        };
    }, [open]);

    const choose = requested => {
        if (!requested || requested === scale) { setOpen(false); return; }
        const counts = countDrawingPlanScaleAnnotations(content);
        if (!counts.dimensions && !counts.texts) {
            onCommand('scaleListEdit', `CURRENT ${requested}`);
            setOpen(false);
            return;
        }
        setPending({ scale: requested, ...counts });
    };
    const apply = rescale => {
        onCommand('scaleListEdit', `CURRENT ${pending.scale}${rescale ? ' RESCALE' : ''}`);
        setPending(null);
        setOpen(false);
    };
    const submitDraft = () => {
        const requested = parseDrawingPlanScale(draft);
        if (requested) choose(requested);
    };

    return (
        <span className="drawing-status-popover drawing-plan-scale" ref={ref}>
            <Button type="button" className="drawing-status-aid drawing-plan-scale-trigger" aria-haspopup="true" aria-expanded={open}
                title={t('planScale.title')} aria-label={t('planScale.aria', { scale: formatted })}
                onClick={() => { setOpen(value => !value); setPending(null); setDraft(''); }}>
                {t('planScale.label')} <span className="drawing-plan-scale-value">1:{formatted}</span><Icon name="chevronDown" size="sm" />
            </Button>
            {open && (
                <div className="ui-popover drawing-status-popover-panel drawing-plan-scale-panel" role="dialog" aria-label={t('planScale.title')}>
                    {pending ? (
                        <div className="drawing-plan-scale-confirm">
                            <p>{t('planScale.confirm', { scale: formatScale(pending.scale, locale), dimensions: pending.dimensions, texts: pending.texts })}</p>
                            <div className="drawing-status-menu-actions">
                                <Button type="button" className="ui-button is-small is-primary" onClick={() => apply(true)}>{t('planScale.rescale')}</Button>
                                <Button type="button" className="ui-button is-small" onClick={() => apply(false)}>{t('planScale.keep')}</Button>
                                <Button type="button" className="ui-button is-small" onClick={() => setPending(null)}>{t('planScale.cancel')}</Button>
                            </div>
                        </div>
                    ) : (
                        <div className="drawing-status-menu">
                            <p className="drawing-plan-scale-hint">{t('planScale.hint')}</p>
                            <div className="drawing-plan-scale-presets">
                                {DRAWING_PLAN_SCALE_PRESETS.map(value => (
                                    <Button key={value} type="button" className="drawing-status-aid" aria-pressed={value === scale}
                                        onClick={() => choose(value)}>1:{formatScale(value, locale)}</Button>
                                ))}
                            </div>
                            <label className="drawing-status-field is-wide">
                                <span>{t('planScale.custom')}</span>
                                <Input type="text" inputMode="decimal" value={draft} placeholder="1:75"
                                    onChange={event => setDraft(event.target.value)}
                                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submitDraft(); } }} />
                            </label>
                        </div>
                    )}
                </div>
            )}
        </span>
    );
}

function formatScale(value, locale) {
    const text = String(Math.round(value * 1e6) / 1e6);
    return locale === 'fr' ? text.replace('.', ',') : text;
}
