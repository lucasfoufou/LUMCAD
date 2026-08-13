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
    onSaveAs,
    onOpenSettings,
}) {
    const { formatTime, t } = useI18n();
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
                    <HeaderAction icon="new" onClick={onNew} title={t('header.newShortcut')}>{t('header.new')}</HeaderAction>
                    <HeaderAction icon="open" onClick={onOpen} title={t('header.openShortcut')}>{t('header.open')}</HeaderAction>
                    <HeaderAction icon="save-as" onClick={onSaveAs} title={t('header.saveAsShortcut')} primary>{t('header.saveAs')}</HeaderAction>
                </div>
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

function HeaderAction({ children, icon, iconOnly = false, primary = false, ...buttonProps }) {
    return (
        <button
            type="button"
            className={['lumcad-header-button', iconOnly && 'is-icon', primary && 'is-primary'].filter(Boolean).join(' ')}
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
        settings: <><circle cx="10" cy="10" r="2.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4" /></>,
    };
    return <svg className="lumcad-header-icon" viewBox="0 0 20 20" aria-hidden="true">{paths[name]}</svg>;
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
