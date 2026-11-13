import { Button, Input } from '~components/ui/Controls';
import DrawingFileMenu from '~components/drawing/DrawingFileMenu';
import useDrawingShortcutLabel from '~hooks/useDrawingShortcutLabel';
import React from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { formatDrawingShortcut } from '~utils/drawingCommandPreferences';
import { resolveDrawingSaveStatus } from '~utils/drawingSaveStatus';
import { getLcadPathLabel, isTauriRuntime } from '~utils/lcadStorage';
import Icon from '~components/ui/Icon';
import { formatAppUpdateError } from '~utils/appUpdater';

export default function DrawingEditorHeader({
    name,
    onNameChange,
    filePath,
    saveStatus,
    isRecovery,
    recovered = false,
    lastSavedAt,
    onNew,
    onOpen,
    onImport,
    onExport,
    onPlot,
    onSave,
    onSaveAs,
    onOpenSettings,
    onHelp,
    fileMenuRef = null,
    commandLine = null,
    editActions = null,
    updateState,
    onInstallUpdate,
}) {
    const { formatTime, t } = useI18n();
    const { settings } = useAppSettings();
    const shortcutLabel = useDrawingShortcutLabel();
    const pathLabel = getLcadPathLabel(filePath);
    const platform = typeof navigator === 'undefined' ? '' : navigator.platform || navigator.userAgent || '';
    const keys = value => formatDrawingShortcut(value, platform).replace(/ \+ /g, '+');
    const binding = action => {
        const row = settings.commandShortcuts.find(item => item.command === `@${action}`);
        return row ? keys(row.shortcut) : null;
    };
    const status = resolveDrawingSaveStatus({ status: saveStatus, filePath, isRecovery, recovered });
    const statusLabel = t(status.key);
    const saveLabel = `${t('fileMenu.save')} (${keys('MOD+S')})`;
    const settingsLabel = `${t('settings.open')} (${keys('MOD+,')})`;
    const fileMenuItems = [
        { id: 'new', icon: 'new', label: t('fileMenu.new'), shortcut: binding('newDocument'), action: onNew },
        { id: 'open', icon: 'open', label: t('fileMenu.open'), shortcut: binding('open'), action: onOpen },
        { id: 'separator-1', separator: true },
        { id: 'import', icon: 'import', label: t('fileMenu.import'), action: onImport },
        { id: 'export', icon: 'export', label: t('fileMenu.export') },
        { id: 'separator-2', separator: true },
        { id: 'save', icon: 'save', label: t('fileMenu.save'), shortcut: keys('MOD+S'), action: onSave },
        { id: 'saveAs', icon: 'save', label: t('fileMenu.saveAs'), shortcut: binding('saveAs'), action: onSaveAs },
        { id: 'separator-3', separator: true },
        { id: 'plot', icon: 'plot', label: t('fileMenu.plot'), action: onPlot },
        { id: 'separator-4', separator: true },
        { id: 'settings', icon: 'gear', label: t('fileMenu.settings'), shortcut: keys('MOD+,'), action: () => onOpenSettings() },
    ];
    return (
        <header className="drawing-editor-header">
            <div className="lumcad-brand" aria-label="LUMCAD">
                <img className="lumcad-brand-mark" src="/lumcad-icon.svg" alt="" aria-hidden="true" />
            </div>
            <DrawingFileMenu ref={fileMenuRef} items={fileMenuItems} onExport={onExport} desktop={isTauriRuntime()} />
            <div className="drawing-editor-title">
                <Input value={name} onChange={event => onNameChange(event.target.value)} aria-label={t('header.drawingName')} title={t('header.renameHint')} />
                <span
                    className={`drawing-save-status is-${status.tone}`}
                    title={[statusLabel, filePath || t('header.noFile'), lastSavedAt && formatTime(lastSavedAt)].filter(Boolean).join(' · ')}
                >
                    <span className="drawing-save-status-label">{statusLabel}</span>
                    <span className="ui-visually-hidden">
                        , {pathLabel || t('header.noFile')}
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
                    <HeaderIconButton icon="save" label={saveLabel} onClick={onSave} />
                    <Button type="button" className="ui-button lumcad-plot-button" onClick={onPlot} title={t('header.plotHint')} aria-label={t('header.plot')}>
                        <Icon name="plot" size="sm" /><span>{t('header.plot')}</span>
                    </Button>
                </div>
                <UpdateHeaderAction state={updateState} onClick={onInstallUpdate} t={t} />
                <div className="lumcad-header-group">
                    <HeaderIconButton icon="help" label={`${t('commandPalette.title')} (F1)`} onClick={onHelp} />
                    <HeaderIconButton icon="gear" label={settingsLabel} onClick={() => onOpenSettings()} />
                </div>
            </nav>
        </header>
    );
}

function HeaderIconButton({ icon, label, ...buttonProps }) {
    return (
        <Button type="button" className="ui-icon-button" aria-label={label} title={label} {...buttonProps}>
            <Icon name={icon} />
        </Button>
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
        <Button type="button" className="ui-button lumcad-update-button" disabled={checking || busy} onClick={onClick} title={state.phase === 'error' ? formatAppUpdateError(state.error, t) : label}>
            <Icon name="update" size="sm" />{label}
        </Button>
    );
}
