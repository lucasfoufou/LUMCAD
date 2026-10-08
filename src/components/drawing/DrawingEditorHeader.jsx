import useDrawingShortcutLabel from '~hooks/useDrawingShortcutLabel';
import React from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { getLcadPathLabel } from '~utils/lcadStorage';

export default function DrawingEditorHeader({
    name,
    onNameChange,
    filePath,
    saveStatus,
    isRecovery,
    lastSavedAt,
    onNew,
    onOpen,
    onPlot,
    onSaveAs,
    onOpenSettings,
    updateState,
    onInstallUpdate,
}) {
    const { formatTime, t } = useI18n();
    const shortcutLabel = useDrawingShortcutLabel();
    const pathLabel = getLcadPathLabel(filePath);
    return (
        <header className="drawing-editor-header">
            <div className="lumcad-brand" aria-label="LUMCAD">
                <img className="lumcad-brand-mark" src="/lumcad-icon.svg" alt="" aria-hidden="true" />
                <span className="lumcad-wordmark"><strong>LUMCAD</strong><small>0.1</small></span>
            </div>
            <div className="drawing-editor-title">
                <input value={name} onChange={event => onNameChange(event.target.value)} aria-label={t('header.drawingName')} />
                <span className={`drawing-save-status is-${saveStatus}`} title={filePath || undefined}>
                    <span>{saveStatusLabel(saveStatus, isRecovery, t)}</span>
                    <span className="lumcad-file-label">{pathLabel || t('header.noFile')}</span>
                    {lastSavedAt && <time dateTime={new Date(lastSavedAt).toISOString()}>{formatTime(lastSavedAt)}</time>}
                </span>
            </div>
            <nav className="lumcad-file-actions" aria-label={t('header.fileActions')}>
                <div className="lumcad-file-action-group">
                    <HeaderAction icon="new" onClick={onNew} title={shortcutLabel('newDocument', t('header.new'))}>{t('header.new')}</HeaderAction>
                    <HeaderAction icon="open" onClick={onOpen} title={shortcutLabel('open', t('header.open'))}>{t('header.open')}</HeaderAction>
                    <HeaderAction icon="save-as" onClick={onSaveAs} title={shortcutLabel('saveAs', t('header.saveAs'))} primary>{t('header.saveAs')}</HeaderAction>
                    <HeaderAction icon="plot" onClick={onPlot} title={t('header.plotHint')}>{t('header.plot')}</HeaderAction>
                </div>
                <UpdateHeaderAction state={updateState} onClick={onInstallUpdate} t={t} />
                {shouldShowSettingsButton() && (
                    <HeaderAction
                        icon="settings"
                        onClick={onOpenSettings}
                        aria-label={t('settings.open')}
                        title={t('settings.open')}
                        iconOnly
                    />
                )}
            </nav>
        </header>
    );
}

function HeaderAction({ children, className = '', icon, iconOnly = false, primary = false, ...buttonProps }) {
    return (
        <button
            type="button"
            className={['lumcad-header-button', iconOnly && 'is-icon', primary && 'is-primary', className].filter(Boolean).join(' ')}
            {...buttonProps}
        >
            <HeaderIcon name={icon} />
            {!iconOnly && <span className="lumcad-header-button-label">{children}</span>}
        </button>
    );
}

function HeaderIcon({ name }) {
    const paths = {
        new: <><path d="M5 2.75h7l3 3V17.25H5z" /><path d="M12 2.75v3h3M10 8.5v5M7.5 11h5" /></>,
        open: <><path d="M2.75 6.5h5l1.5-2h7v2" /><path d="m3 7.5 1.4 8.25h11.2L17 7.5z" /></>,
        'save-as': <><path d="M4 2.75h10l2 2v12.5H4z" /><path d="M7 2.75v5h6v-5M7 17.25v-5h6v5M15.5 9.5l2 2-2 2M17.5 11.5h-4" /></>,
        plot: <><path d="M5 7V2.75h10V7M5 14H3.25V7h13.5v7H15" /><path d="M5 11h10v6.25H5zM13.75 9h.01" /></>,
        update: <><path d="M10 3v9M6.5 8.5 10 12l3.5-3.5" /><path d="M4 14.5v2h12v-2" /></>,
        settings: <><circle cx="10" cy="10" r="2.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>,
    };
    return <svg className="lumcad-header-icon" viewBox="0 0 20 20" aria-hidden="true">{paths[name]}</svg>;
}

function UpdateHeaderAction({ state, onClick, t }) {
    if (!state?.version) return null;
    const checking = state.phase === 'checking';
    const busy = state.phase === 'downloading' || state.phase === 'installing';
    let label = t('updater.available', { version: state.version });
    if (checking) label = t('updater.checking');
    else if (state.phase === 'downloading') {
        label = Number.isFinite(state.progress?.percent)
            ? t('updater.downloadingProgress', { progress: state.progress.percent })
            : t('updater.downloading');
    } else if (state.phase === 'installing') label = t('updater.installing');
    else if (state.phase === 'error') label = t('updater.retry', { version: state.version });
    return (
        <HeaderAction
            className="lumcad-update-button"
            icon="update"
            disabled={checking || busy}
            onClick={onClick}
            title={label}
            aria-label={label}
        >
            {label}
        </HeaderAction>
    );
}

function shouldShowSettingsButton() {
    const isTauri = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
    const platform = typeof navigator === 'undefined' ? '' : `${navigator.platform || ''} ${navigator.userAgent || ''}`;
    return !isTauri || !/Mac/i.test(platform);
}

function saveStatusLabel(status, isRecovery, t) {
    if (status === 'saved' && isRecovery) return t('saveStatus.recovery');
    return t(`saveStatus.${status}`);
}
