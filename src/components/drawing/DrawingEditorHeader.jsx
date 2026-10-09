import useDrawingShortcutLabel from '~hooks/useDrawingShortcutLabel';
import React from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { getLcadPathLabel } from '~utils/lcadStorage';
import Icon from '~components/ui/Icon';

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
    commandLine = null,
    editActions = null,
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
            </div>
            <div className="drawing-editor-title">
                <input value={name} onChange={event => onNameChange(event.target.value)} aria-label={t('header.drawingName')} />
                {/* Only the status dot is visible; the details show on hover and remain readable by assistive technology. */}
                <span
                    className={`drawing-save-status is-${saveStatus}`}
                    title={[saveStatusLabel(saveStatus, isRecovery, t), filePath || t('header.noFile'), lastSavedAt && formatTime(lastSavedAt)].filter(Boolean).join(' · ')}
                >
                    <span className="ui-visually-hidden">
                        {saveStatusLabel(saveStatus, isRecovery, t)}, {pathLabel || t('header.noFile')}
                        {lastSavedAt && <>, <time dateTime={new Date(lastSavedAt).toISOString()}>{formatTime(lastSavedAt)}</time></>}
                    </span>
                </span>
            </div>
            {commandLine}
            <nav className="lumcad-file-actions" aria-label={t('header.fileActions')}>
                {editActions && (
                    <div className="lumcad-header-group" role="group" aria-label={t('header.editActions')}>
                        <HeaderIconButton icon="undo" label={shortcutLabel('undo')} disabled={!editActions.canUndo} onClick={editActions.undo} />
                        <HeaderIconButton icon="redo" label={shortcutLabel('redo')} disabled={!editActions.canRedo} onClick={editActions.redo} />
                        <HeaderIconButton icon="copy" label={shortcutLabel('copy')} disabled={!editActions.canCopy} onClick={editActions.copy} />
                        <HeaderIconButton icon="cut" label={shortcutLabel('cut')} disabled={!editActions.canCopy} onClick={editActions.cut} />
                        <HeaderIconButton icon="clipboard" label={shortcutLabel('paste')} onClick={editActions.paste} />
                    </div>
                )}
                <div className="lumcad-header-group">
                    <button type="button" className="ui-button is-ghost" onClick={onNew} title={shortcutLabel('newDocument', t('header.new'))}>{t('header.new')}</button>
                    <button type="button" className="ui-button is-ghost" onClick={onOpen} title={shortcutLabel('open', t('header.open'))}>{t('header.open')}</button>
                    <button type="button" className="ui-button" onClick={onPlot} title={t('header.plotHint')}><Icon name="plot" size="sm" />{t('header.plot')}</button>
                    <button type="button" className="ui-button is-primary" onClick={onSaveAs} title={shortcutLabel('saveAs', t('header.saveAs'))}>{t('header.saveAs')}</button>
                </div>
                <UpdateHeaderAction state={updateState} onClick={onInstallUpdate} t={t} />
                {shouldShowSettingsButton() && (
                    <HeaderIconButton icon="settings" label={t('settings.open')} onClick={onOpenSettings} />
                )}
            </nav>
        </header>
    );
}

function HeaderIconButton({ icon, label, ...buttonProps }) {
    return (
        <button type="button" className="ui-icon-button" aria-label={label} title={label} {...buttonProps}>
            <Icon name={icon} />
        </button>
    );
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
        <button type="button" className="ui-button lumcad-update-button" disabled={checking || busy} onClick={onClick} title={label}>
            <Icon name="update" size="sm" />{label}
        </button>
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
