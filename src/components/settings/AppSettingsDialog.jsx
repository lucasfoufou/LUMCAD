import React, { useEffect, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { getMcpStatus, normalizeAppSettings } from '~settings/appSettings';

export default function AppSettingsDialog({ open, onClose }) {
    const { locale, setLocale, t } = useI18n();
    const { settings, updateSettings } = useAppSettings();
    const [draft, setDraft] = useState(settings);
    const [mcpStatus, setMcpStatus] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return undefined;
        setDraft(settings);
        setSaveError(false);
        setCopied(false);
        let disposed = false;
        const refresh = () => getMcpStatus().then(status => {
            if (!disposed) setMcpStatus(status);
        }).catch(() => {
            if (!disposed) setMcpStatus(null);
        });
        refresh();
        const timer = window.setInterval(refresh, 1_500);
        const onKeyDown = event => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            disposed = true;
            window.clearInterval(timer);
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose, open, settings]);

    if (!open) return null;

    const update = patch => setDraft(current => ({ ...current, ...patch }));
    const updateDrawingDefaults = patch => setDraft(current => ({
        ...current,
        drawingDefaults: { ...current.drawingDefaults, ...patch },
    }));
    const updateMcp = patch => setDraft(current => ({ ...current, mcp: { ...current.mcp, ...patch } }));

    const save = async event => {
        event.preventDefault();
        setSaving(true);
        setSaveError(false);
        try {
            const normalized = normalizeAppSettings(draft);
            const saved = await updateSettings(normalized);
            if (saved.language !== locale) setLocale(saved.language);
            setDraft(saved);
            window.setTimeout(() => getMcpStatus().then(setMcpStatus).catch(() => {}), 120);
        } catch {
            setSaveError(true);
        } finally {
            setSaving(false);
        }
    };

    const copyEndpoint = async () => {
        if (!mcpStatus?.endpoint) return;
        try {
            await navigator.clipboard.writeText(mcpStatus.endpoint);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1_500);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="lumcad-settings-backdrop" onMouseDown={event => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section className="lumcad-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="lumcad-settings-title">
                <header className="lumcad-settings-header">
                    <div>
                        <span className="lumcad-settings-kicker">LUMCAD</span>
                        <h1 id="lumcad-settings-title">{t('settings.title')}</h1>
                    </div>
                    <button type="button" className="lumcad-settings-close" onClick={onClose} aria-label={t('settings.close')}>×</button>
                </header>

                <form onSubmit={save}>
                    <div className="lumcad-settings-content">
                        <SettingsSection title={t('settings.generalTitle')} description={t('settings.generalDescription')}>
                            <SettingsField label={t('language.label')}>
                                <select value={draft.language} onChange={event => update({ language: event.target.value })}>
                                    <option value="en">{t('language.english')}</option>
                                    <option value="fr">{t('language.french')}</option>
                                </select>
                            </SettingsField>
                            <SettingsField label={t('settings.autosaveDelay')} hint={t('settings.autosaveDelayHint')}>
                                <div className="lumcad-settings-input-unit">
                                    <input
                                        type="number"
                                        min="0.3"
                                        max="10"
                                        step="0.1"
                                        value={draft.autosaveDelayMs / 1000}
                                        onChange={event => update({ autosaveDelayMs: Number(event.target.value) * 1000 })}
                                    />
                                    <span>{t('settings.seconds')}</span>
                                </div>
                            </SettingsField>
                        </SettingsSection>

                        <SettingsSection title={t('settings.newDrawingsTitle')} description={t('settings.newDrawingsDescription')}>
                            <SettingsField label={t('settings.defaultGridSpacing')}>
                                <div className="lumcad-settings-input-unit">
                                    <input
                                        type="number"
                                        min="0.0001"
                                        max="1000"
                                        step="any"
                                        value={draft.drawingDefaults.gridSpacing}
                                        onChange={event => updateDrawingDefaults({ gridSpacing: Number(event.target.value) })}
                                    />
                                    <span>m</span>
                                </div>
                            </SettingsField>
                            <SettingsToggle
                                checked={draft.drawingDefaults.tracking}
                                onChange={tracking => updateDrawingDefaults({ tracking })}
                                label={t('settings.defaultTracking')}
                                hint={t('settings.defaultTrackingHint')}
                            />
                        </SettingsSection>

                        <SettingsSection title={t('settings.drawingOperationsTitle')} description={t('settings.drawingOperationsDescription')}>
                            <SettingsField label={t('settings.angleUnit')} hint={t('settings.angleUnitHint')}>
                                <select
                                    value={draft.drawingDefaults.angleUnit}
                                    onChange={event => updateDrawingDefaults({ angleUnit: event.target.value })}
                                >
                                    <option value="degrees">{t('settings.angleDegrees')}</option>
                                    <option value="radians">{t('settings.angleRadians')}</option>
                                    <option value="gradians">{t('settings.angleGradians')}</option>
                                </select>
                            </SettingsField>
                            <SettingsToggle
                                checked={draft.drawingDefaults.clockwiseAngles}
                                onChange={clockwiseAngles => updateDrawingDefaults({ clockwiseAngles })}
                                label={t('settings.clockwiseAngles')}
                                hint={t('settings.clockwiseAnglesHint')}
                            />
                            <SettingsToggle
                                checked={draft.drawingDefaults.mirrorText}
                                onChange={mirrorText => updateDrawingDefaults({ mirrorText })}
                                label={t('settings.mirrorText')}
                                hint={t('settings.mirrorTextHint')}
                            />
                        </SettingsSection>

                        <SettingsSection title={t('settings.mcpTitle')} description={t('settings.mcpDescription')}>
                            <SettingsToggle
                                checked={draft.mcp.enabled}
                                onChange={enabled => updateMcp({ enabled })}
                                label={t('settings.mcpEnabled')}
                                hint={t('settings.mcpEnabledHint')}
                            />
                            <SettingsField label={t('settings.mcpPreferredPort')} hint={t('settings.mcpPreferredPortHint')}>
                                <input
                                    type="number"
                                    min="1024"
                                    max="65535"
                                    step="1"
                                    value={draft.mcp.preferredPort}
                                    disabled={!draft.mcp.enabled}
                                    onChange={event => updateMcp({ preferredPort: Number(event.target.value) })}
                                />
                            </SettingsField>
                            <McpStatus status={mcpStatus} copied={copied} onCopy={copyEndpoint} t={t} />
                        </SettingsSection>
                    </div>

                    <footer className="lumcad-settings-footer">
                        <span className={saveError ? 'lumcad-settings-error is-visible' : 'lumcad-settings-error'}>
                            {saveError ? t('settings.saveError') : ''}
                        </span>
                        <div>
                            <button type="button" className="lumcad-settings-button" onClick={onClose}>{t('settings.cancel')}</button>
                            <button type="submit" className="lumcad-settings-button is-primary" disabled={saving}>
                                {saving ? t('settings.saving') : t('settings.save')}
                            </button>
                        </div>
                    </footer>
                </form>
            </section>
        </div>
    );
}

function SettingsSection({ title, description, children }) {
    return (
        <section className="lumcad-settings-section">
            <div className="lumcad-settings-section-heading">
                <h2>{title}</h2>
                <p>{description}</p>
            </div>
            <div className="lumcad-settings-fields">{children}</div>
        </section>
    );
}

function SettingsField({ label, hint = null, children }) {
    return (
        <label className="lumcad-settings-field">
            <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
            <span className="lumcad-settings-control">{children}</span>
        </label>
    );
}

function SettingsToggle({ checked, onChange, label, hint }) {
    return (
        <label className="lumcad-settings-field">
            <span><strong>{label}</strong><small>{hint}</small></span>
            <input className="lumcad-settings-toggle" type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
        </label>
    );
}

function McpStatus({ status, copied, onCopy, t }) {
    let state = 'stopped';
    if (status?.browserPreview) state = 'desktopOnly';
    else if (status?.starting) state = 'starting';
    else if (status?.running) state = status.fallbackUsed ? 'fallback' : 'running';
    else if (status?.lastError) state = 'error';
    else if (status?.enabled === false) state = 'disabled';
    return (
        <div className={`lumcad-mcp-status is-${state}`}>
            <div className="lumcad-mcp-status-heading">
                <span className="lumcad-mcp-status-dot" aria-hidden="true" />
                <strong>{t(`settings.mcpStatus.${state}`)}</strong>
            </div>
            {status?.endpoint && (
                <div className="lumcad-mcp-endpoint">
                    <code>{status.endpoint}</code>
                    <button type="button" onClick={onCopy}>{copied ? t('settings.copied') : t('settings.copy')}</button>
                </div>
            )}
            {status?.fallbackUsed && (
                <p>{t('settings.mcpFallbackDetail', { preferred: status.preferredPort, actual: status.actualPort })}</p>
            )}
            {state === 'error' && <p>{t('settings.mcpErrorDetail')}</p>}
        </div>
    );
}
