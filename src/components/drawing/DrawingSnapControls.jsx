import useDrawingShortcutLabel from '~hooks/useDrawingShortcutLabel';
import React, { useEffect, useRef, useState } from 'react';

import Icon from '~components/ui/Icon';
import { useI18n } from '~i18n/I18nProvider';
import { parsePolarAnglesInput } from '~utils/drawingDraftingSettings';

const objectSnapKeys = ['endpoint', 'midpoint', 'center', 'intersection', 'nearest'];

// Drafting aids shown in the status bar: object snaps, grid, ortho, polar and
// object tracking, drafting settings and the screen scale.
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
    const shortcutLabel = useDrawingShortcutLabel();
    const settings = content.settings;
    const snaps = settings.snaps;
    const [snapMenuOpen, setSnapMenuOpen] = useState(false);
    const [scaleDraft, setScaleDraft] = useState(() => formatScaleRatio(scaleRatio, locale));
    const [polarAnglesDraft, setPolarAnglesDraft] = useState(() => formatPolarAngles(settings.polarAngles, locale));
    useEffect(() => setScaleDraft(formatScaleRatio(scaleRatio, locale)), [locale, scaleRatio]);
    useEffect(() => setPolarAnglesDraft(formatPolarAngles(settings.polarAngles, locale)), [settings.polarAngles, locale]);

    const updateSettings = patch => onChange({ ...content, settings: { ...content.settings, ...patch } });
    const updateSnaps = patch => updateSettings({ snaps: { ...snaps, ...patch } });
    const objectSnapsOn = objectSnapKeys.some(key => snaps[key]);
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
    const relations = settings.trackingRelations || {};
    const commitOnEnter = apply => event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        apply();
        event.currentTarget.blur();
    };

    return (
        <div className="drawing-snap-controls" role="group" aria-label={t('snap.controls')}>
            <StatusPopover
                open={snapMenuOpen}
                onOpenChange={setSnapMenuOpen}
                trigger={(
                    <button type="button" className="drawing-status-aid" aria-pressed={objectSnapsOn} aria-haspopup="true"
                        aria-expanded={snapMenuOpen} onClick={() => setSnapMenuOpen(open => !open)} title={t('snap.controls')}>
                        {t('status.snap')}<Icon name="chevronDown" size="sm" />
                    </button>
                )}
            >
                <div className="drawing-status-menu" aria-label={t('snap.controls')}>
                    {objectSnapKeys.map(key => (
                        <label key={key}>
                            <input type="checkbox" checked={Boolean(snaps[key])} onChange={event => updateSnaps({ [key]: event.target.checked })} />
                            <span>{t(`snap.${key}`)}</span>
                        </label>
                    ))}
                    <div className="drawing-status-menu-actions">
                        <button type="button" className="ui-button is-small" disabled={objectSnapKeys.every(key => snaps[key])}
                            onClick={() => updateSnaps(Object.fromEntries(objectSnapKeys.map(key => [key, true])))}>{t('snap.all')}</button>
                        <button type="button" className="ui-button is-small" disabled={!objectSnapsOn}
                            onClick={() => updateSnaps(Object.fromEntries(objectSnapKeys.map(key => [key, false])))}>{t('snap.none')}</button>
                    </div>
                </div>
            </StatusPopover>
            <button type="button" className="drawing-status-aid" aria-pressed={Boolean(snaps.grid)} title={t('snap.grid')}
                onClick={() => updateSnaps({ grid: !snaps.grid })}>{t('status.grid')}</button>
            <button type="button" className="drawing-status-aid" aria-pressed={Boolean(settings.ortho)} title={`${shortcutLabel('toggleOrtho')}; ${t('commandPreferences.temporaryOrtho')}`}
                aria-label={t('snap.orthoMode')}
                onClick={() => updateSettings({ ortho: !settings.ortho, ...(!settings.ortho ? { polarTracking: false } : {}) })}>{t('status.ortho')}</button>
            <button type="button" className="drawing-status-aid" aria-pressed={Boolean(settings.polarTracking)} title={shortcutLabel('togglePolar')}
                aria-label={t('snap.polarMode')}
                onClick={() => updateSettings({ polarTracking: !settings.polarTracking, ...(!settings.polarTracking ? { ortho: false } : {}) })}>{t('status.polar')}</button>
            <button type="button" className="drawing-status-aid drawing-tracking-toggle" aria-pressed={Boolean(settings.tracking)} title={shortcutLabel('toggleObjectTracking')}
                aria-label={t('snap.objectTracking')}
                onClick={() => updateSettings({ tracking: !settings.tracking })}>{t('status.tracking')}</button>
            <button type="button" className="ui-icon-button is-small" onClick={onTemporaryTrackingPoint}
                aria-label={t('snap.temporaryTrackingPoint')} title={t('snap.temporaryTrackingPointTitle')}>
                <Icon name="point" size="sm" />
            </button>
            <StatusPopover
                open={draftingSettingsOpen}
                onOpenChange={open => onDraftingSettingsOpenChange?.(open)}
                trigger={(
                    <button type="button" className="ui-icon-button is-small" aria-expanded={draftingSettingsOpen}
                        onClick={() => onDraftingSettingsOpenChange?.(!draftingSettingsOpen)}
                        aria-label={t('snap.draftingSettings')} title={t('snap.draftingSettingsTitle')}>
                        <Icon name="settings" size="sm" />
                    </button>
                )}
            >
                <div className="drawing-status-menu drawing-drafting-settings">
                    <label className="drawing-status-field">
                        <span>{t('snap.spacing')}</span>
                        <input type="number" min="0.0001" step="0.1" value={settings.gridSpacing}
                            onChange={event => updateSettings({ gridSpacing: Math.max(0.0001, Number(event.target.value) || 0.5) })} />
                        <span>m</span>
                    </label>
                    <label className="drawing-status-field">
                        <span>{t('snap.polarIncrement')}</span>
                        <input type="number" min="1" max="180" step="1" value={settings.polarIncrement}
                            onChange={event => {
                                const value = Number(event.target.value);
                                if (Number.isFinite(value) && value >= 1 && value <= 180) updateSettings({ polarIncrement: value });
                            }} />
                        <span>°</span>
                    </label>
                    <label className="drawing-status-field is-wide">
                        <span>{t('snap.additionalPolarAngles')}</span>
                        <input type="text" value={polarAnglesDraft} placeholder={t('snap.additionalPolarAnglesPlaceholder')}
                            onChange={event => setPolarAnglesDraft(event.target.value)} onBlur={applyPolarAngles} onKeyDown={commitOnEnter(applyPolarAngles)} />
                    </label>
                    <fieldset className="drawing-tracking-relations">
                        <legend>{t('snap.objectTrackingRelations')}</legend>
                        {['parallel', 'perpendicular', 'tangent'].map(relation => (
                            <label key={relation}>
                                <input type="checkbox" checked={relations[relation] !== false}
                                    onChange={event => updateSettings({ trackingRelations: { ...relations, [relation]: event.target.checked } })} />
                                <span>{t(`snap.${relation}`)}</span>
                            </label>
                        ))}
                    </fieldset>
                </div>
            </StatusPopover>
            <span className="drawing-status-separator" aria-hidden="true" />
            <label className="drawing-snap-scale" title={t('snap.screenScaleTitle')}>
                <span aria-hidden="true">1:</span>
                <input type="text" inputMode="decimal" value={scaleDraft} aria-label={t('snap.screenScaleAria')}
                    onChange={event => setScaleDraft(event.target.value)} onBlur={applyScale} onKeyDown={commitOnEnter(applyScale)} />
            </label>
        </div>
    );
}

// A trigger with a menu that opens above the status bar and closes on outside click or Escape.
function StatusPopover({ open, onOpenChange, trigger, children }) {
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return undefined;
        const close = event => {
            if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) onOpenChange(false);
        };
        window.addEventListener('pointerdown', close, true);
        window.addEventListener('keydown', close, true);
        return () => {
            window.removeEventListener('pointerdown', close, true);
            window.removeEventListener('keydown', close, true);
        };
    }, [open, onOpenChange]);
    return (
        <span className="drawing-status-popover" ref={ref}>
            {trigger}
            {open && <div className="ui-popover drawing-status-popover-panel">{children}</div>}
        </span>
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
