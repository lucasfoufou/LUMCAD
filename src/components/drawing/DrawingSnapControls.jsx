import React, { useEffect, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';

const snapTypes = [
    { keys: 'grid', labelKey: 'snap.grid', glyph: '▦' },
    { keys: 'endpoint', labelKey: 'snap.endpoint', glyph: '◇' },
    { keys: ['midpoint', 'center'], labelKey: 'snap.midpointCenter', glyph: '⊙' },
    { keys: 'intersection', labelKey: 'snap.intersection', glyph: '×' },
    { keys: 'nearest', labelKey: 'snap.nearest', glyph: '⌁' },
];

const snapKeys = snapTypes.flatMap(({ keys }) => Array.isArray(keys) ? keys : [keys]);

export default function DrawingSnapControls({ content, onChange, scaleRatio, onScaleChange }) {
    const { locale, t } = useI18n();
    const snaps = content.settings.snaps;
    const [scaleDraft, setScaleDraft] = useState(() => formatScaleRatio(scaleRatio, locale));
    useEffect(() => setScaleDraft(formatScaleRatio(scaleRatio, locale)), [locale, scaleRatio]);

    const updateSnaps = nextSnaps => onChange({
        ...content,
        settings: { ...content.settings, snaps: nextSnaps },
    });
    const allEnabled = snapKeys.every(key => snaps[key]);
    const noneEnabled = snapKeys.every(key => !snaps[key]);
    const applyScale = () => {
        const next = Number.parseFloat(String(scaleDraft).replace(',', '.'));
        if (Number.isFinite(next) && next >= 1) onScaleChange?.(next);
        else setScaleDraft(formatScaleRatio(scaleRatio, locale));
    };

    return (
        <div className="drawing-snap-controls" aria-label={t('snap.controls')}>
            <span className="drawing-snap-label">{t('snap.controls')}</span>
            <div className="drawing-snap-buttons">
                {snapTypes.map(({ keys, labelKey, glyph }) => {
                    const groupKeys = Array.isArray(keys) ? keys : [keys];
                    const enabled = groupKeys.every(key => snaps[key]);
                    return (
                    <button
                        type="button"
                        key={groupKeys.join('-')}
                        className={enabled ? 'is-active' : ''}
                        onClick={() => updateSnaps({
                            ...snaps,
                            ...Object.fromEntries(groupKeys.map(key => [key, !enabled])),
                        })}
                        aria-label={t(labelKey)}
                        title={t(labelKey)}
                        aria-pressed={enabled}
                    >
                        {glyph}
                    </button>
                    );
                })}
                <button
                    type="button"
                    className="drawing-snap-clear"
                    disabled={noneEnabled}
                    onClick={() => updateSnaps({ ...snaps, ...Object.fromEntries(snapKeys.map(key => [key, false])) })}
                    aria-label={t('snap.disableAll')}
                    title={t('snap.none')}
                >
                    Ø
                </button>
                <button
                    type="button"
                    disabled={allEnabled}
                    onClick={() => updateSnaps({ ...snaps, ...Object.fromEntries(snapKeys.map(key => [key, true])) })}
                    aria-label={t('snap.enableAll')}
                    title={t('snap.all')}
                >
                    ●
                </button>
                <button
                    type="button"
                    className={content.settings.tracking ? 'is-active drawing-tracking-toggle' : 'drawing-tracking-toggle'}
                    onClick={() => onChange({
                        ...content,
                        settings: { ...content.settings, tracking: !content.settings.tracking },
                    })}
                    aria-pressed={Boolean(content.settings.tracking)}
                    aria-label={t('snap.trackingHelpers')}
                    title={t('snap.trackingHelpersTitle')}
                >
                    ⌖
                </button>
            </div>
            <label className="drawing-snap-number">
                <span>{t('snap.spacing')}</span>
                <input
                    type="number"
                    min="0.0001"
                    step="0.1"
                    value={content.settings.gridSpacing}
                    onChange={event => onChange({
                        ...content,
                        settings: { ...content.settings, gridSpacing: Math.max(0.0001, Number(event.target.value) || 0.5) },
                    })}
                />
                <span>m</span>
            </label>
            <label className="drawing-snap-number drawing-snap-scale-input" title={t('snap.screenScaleTitle')}>
                <span>{t('snap.screenScale')}</span>
                <span className="drawing-snap-scale-value">
                    <b aria-hidden="true">1 /</b>
                    <input
                        type="text"
                        inputMode="decimal"
                        value={scaleDraft}
                        onChange={event => setScaleDraft(event.target.value)}
                        onBlur={applyScale}
                        onKeyDown={event => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                applyScale();
                                event.currentTarget.blur();
                            }
                        }}
                        aria-label={t('snap.screenScaleAria')}
                    />
                </span>
            </label>
        </div>
    );
}

function formatScaleRatio(value, locale) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio) || ratio <= 0) return '';
    const rounded = Math.round(ratio);
    if (Math.abs(ratio - rounded) < 1e-8) return String(rounded);
    const decimal = ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return locale === 'fr' ? decimal.replace('.', ',') : decimal;
}
