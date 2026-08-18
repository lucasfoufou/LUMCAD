import React, { useEffect, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { parsePolarAnglesInput } from '~utils/drawingDraftingSettings';

const snapTypes = [
    { keys: 'grid', labelKey: 'snap.grid', glyph: '▦' },
    { keys: 'endpoint', labelKey: 'snap.endpoint', glyph: '◇' },
    { keys: ['midpoint', 'center'], labelKey: 'snap.midpointCenter', glyph: '⊙' },
    { keys: 'intersection', labelKey: 'snap.intersection', glyph: '×' },
    { keys: 'nearest', labelKey: 'snap.nearest', glyph: '⌁' },
];

const snapKeys = snapTypes.flatMap(({ keys }) => Array.isArray(keys) ? keys : [keys]);

export default function DrawingSnapControls({
    content,
    onChange,
    scaleRatio,
    onScaleChange,
    draftingSettingsOpen = false,
    onDraftingSettingsOpenChange,
    onTemporaryTrackingPoint,
}) {
    const { locale, t } = useI18n();
    const snaps = content.settings.snaps;
    const [scaleDraft, setScaleDraft] = useState(() => formatScaleRatio(scaleRatio, locale));
    const [polarAnglesDraft, setPolarAnglesDraft] = useState(() => formatPolarAngles(content.settings.polarAngles, locale));
    useEffect(() => setScaleDraft(formatScaleRatio(scaleRatio, locale)), [locale, scaleRatio]);
    useEffect(() => {
        setPolarAnglesDraft(formatPolarAngles(content.settings.polarAngles, locale));
    }, [content.settings.polarAngles, locale]);

    const updateSnaps = nextSnaps => onChange({
        ...content,
        settings: { ...content.settings, snaps: nextSnaps },
    });
    const updateSettings = patch => onChange({
        ...content,
        settings: { ...content.settings, ...patch },
    });
    const allEnabled = snapKeys.every(key => snaps[key]);
    const noneEnabled = snapKeys.every(key => !snaps[key]);
    const applyScale = () => {
        const next = Number.parseFloat(String(scaleDraft).replace(',', '.'));
        if (Number.isFinite(next) && next >= 1) onScaleChange?.(next);
        else setScaleDraft(formatScaleRatio(scaleRatio, locale));
    };
    const applyPolarAngles = () => {
        const angles = parsePolarAnglesInput(polarAnglesDraft, locale);
        updateSettings({ polarAngles: angles });
        setPolarAnglesDraft(formatPolarAngles(angles, locale));
    };
    const relations = content.settings.trackingRelations || {};

    return (
        <div className={`drawing-snap-controls${draftingSettingsOpen ? ' has-drafting-settings' : ''}`} aria-label={t('snap.controls')}>
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
                    className={content.settings.ortho ? 'is-active' : ''}
                    onClick={() => updateSettings({
                        ortho: !content.settings.ortho,
                        ...(!content.settings.ortho ? { polarTracking: false } : {}),
                    })}
                    aria-pressed={Boolean(content.settings.ortho)}
                    aria-label={t('snap.orthoMode')}
                    title={t('snap.orthoModeTitle')}
                >
                    O
                </button>
                <button
                    type="button"
                    className={content.settings.polarTracking ? 'is-active' : ''}
                    onClick={() => updateSettings({
                        polarTracking: !content.settings.polarTracking,
                        ...(!content.settings.polarTracking ? { ortho: false } : {}),
                    })}
                    aria-pressed={Boolean(content.settings.polarTracking)}
                    aria-label={t('snap.polarMode')}
                    title={t('snap.polarModeTitle')}
                >
                    P
                </button>
                <button
                    type="button"
                    className={content.settings.tracking ? 'is-active drawing-tracking-toggle' : 'drawing-tracking-toggle'}
                    onClick={() => updateSettings({ tracking: !content.settings.tracking })}
                    aria-pressed={Boolean(content.settings.tracking)}
                    aria-label={t('snap.objectTracking')}
                    title={t('snap.objectTrackingTitle')}
                >
                    T
                </button>
                <button
                    type="button"
                    onClick={onTemporaryTrackingPoint}
                    aria-label={t('snap.temporaryTrackingPoint')}
                    title={t('snap.temporaryTrackingPointTitle')}
                >
                    TT
                </button>
                <button
                    type="button"
                    className={draftingSettingsOpen ? 'is-active' : ''}
                    onClick={() => onDraftingSettingsOpenChange?.(!draftingSettingsOpen)}
                    aria-expanded={draftingSettingsOpen}
                    aria-label={t('snap.draftingSettings')}
                    title={t('snap.draftingSettingsTitle')}
                >
                    ⚙
                </button>
            </div>
            {draftingSettingsOpen && (
                <div className="drawing-drafting-settings">
                    <label className="drawing-snap-number">
                        <span>{t('snap.polarIncrement')}</span>
                        <input
                            type="number"
                            min="1"
                            max="180"
                            step="1"
                            value={content.settings.polarIncrement}
                            onChange={event => {
                                const value = Number(event.target.value);
                                if (Number.isFinite(value) && value >= 1 && value <= 180) updateSettings({ polarIncrement: value });
                            }}
                        />
                        <span>°</span>
                    </label>
                    <label className="drawing-drafting-angle-list">
                        <span>{t('snap.additionalPolarAngles')}</span>
                        <input
                            type="text"
                            value={polarAnglesDraft}
                            placeholder={t('snap.additionalPolarAnglesPlaceholder')}
                            onChange={event => setPolarAnglesDraft(event.target.value)}
                            onBlur={applyPolarAngles}
                            onKeyDown={event => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    applyPolarAngles();
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </label>
                    <fieldset className="drawing-tracking-relations">
                        <legend>{t('snap.objectTrackingRelations')}</legend>
                        {['parallel', 'perpendicular', 'tangent'].map(relation => (
                            <label key={relation}>
                                <input
                                    type="checkbox"
                                    checked={relations[relation] !== false}
                                    onChange={event => updateSettings({
                                        trackingRelations: { ...relations, [relation]: event.target.checked },
                                    })}
                                />
                                <span>{t(`snap.${relation}`)}</span>
                            </label>
                        ))}
                    </fieldset>
                </div>
            )}
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

function formatPolarAngles(values, locale) {
    return (Array.isArray(values) ? values : [])
        .map(value => locale === 'fr' ? String(value).replace('.', ',') : String(value))
        .join('; ');
}

function formatScaleRatio(value, locale) {
    const ratio = Number(value);
    if (!Number.isFinite(ratio) || ratio <= 0) return '';
    const rounded = Math.round(ratio);
    if (Math.abs(ratio - rounded) < 1e-8) return String(rounded);
    const decimal = ratio.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    return locale === 'fr' ? decimal.replace('.', ',') : decimal;
}
