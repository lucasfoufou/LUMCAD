import { listen } from '@tauri-apps/api/event';
import { isTauriRuntime } from '~utils/lcadStorage';
import { useAppSettings } from '~settings/AppSettingsProvider';
import { drawingShortcutFromEvent } from '~utils/drawingCommandPreferences';
import { getDrawingCommandDefinition } from '~utils/drawingCommands';
import { useEffect } from 'react';

import useLatestRef from '~hooks/useLatestRef';

export default function useDrawingEditorShortcuts({ actions, commandBarRef }) {
    const actionsRef = useLatestRef(actions);
    const { settings } = useAppSettings();
    const preferencesRef = useLatestRef(settings.commandShortcuts);
    useEffect(() => {
        const onKeyDown = event => {
            if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const targetIsInput = isTextInput(event.target);
            const modifier = event.ctrlKey || event.metaKey;
            // Fixed shortcuts, not rebindable: Save, Settings (as in every desktop app).
            if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (!event.repeat) Promise.resolve().then(actionsRef.current.save).catch(() => {});
                return;
            }
            if (modifier && !event.altKey && event.key === ',') {
                event.preventDefault();
                actionsRef.current.openSettings?.();
                return;
            }
            if (event.key === 'Escape') { actionsRef.current.cancel(); return; }
            const shortcut = drawingShortcutFromEvent(event);
            const binding = preferencesRef.current.find(row => row.shortcut === shortcut)
                || legacySelectAllBinding(preferencesRef.current, shortcut);
            // Ctrl/Cmd+A selects all objects from an empty command line, as in AutoCAD; in any
            // other text field it keeps selecting the text.
            const emptyCommandLine = event.target?.closest?.('.drawing-command-bar') && !event.target.value;
            if (binding && (!targetIsInput || ['@saveAs', '@open', '@newDocument'].includes(binding.command)
                || (binding.command === '@selectAll' && emptyCommandLine))) {
                event.preventDefault();
                if (event.repeat) return;
                const action = binding.command.startsWith('@') ? actionsRef.current[binding.command.slice(1)]
                    : () => actionsRef.current.command(getDrawingCommandDefinition(binding.command).name);
                Promise.resolve().then(action).catch(() => {});
                return;
            }
            // F1 opens the command list unless the user bound it to something else.
            if (event.key === 'F1' && !modifier && !event.altKey && !event.shiftKey) {
                event.preventDefault();
                actionsRef.current.help?.();
                return;
            }
            if (targetIsInput) return;
            if (!modifier && !event.altKey && event.key === 'Enter') {
                event.preventDefault();
                actionsRef.current.enter().catch(() => {});
            } else if (!modifier && !event.altKey && event.key.length === 1 && /[a-zA-Z0-9.,;@#<>()>+\-*\/%^=_'"°]/.test(event.key)) {
                event.preventDefault();
                commandBarRef.current?.focus(event.key);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        let disposed = false;
        let unlisten = null;
        if (isTauriRuntime()) listen('lumcad://drawing-action', ({ payload }) => {
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
            const allowed = ['newDocument', 'open', 'save', 'saveAs', 'import', 'export', 'plot', 'undo', 'redo', 'copy', 'cut', 'paste', 'delete'];
            if (!allowed.includes(payload)) return;
            Promise.resolve().then(() => actionsRef.current[payload]?.()).catch(() => {});
        }).then(cleanup => { if (disposed) cleanup(); else unlisten = cleanup; }).catch(() => {});
        return () => {
            disposed = true;
            unlisten?.();
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [actionsRef, commandBarRef, preferencesRef]);
}

// Shortcut lists saved before Ctrl/Cmd+A existed keep it unless the key is taken.
function legacySelectAllBinding(preferences, shortcut) {
    if (shortcut !== 'MOD+A' || preferences.some(row => row.command === '@selectAll' || row.shortcut === 'MOD+A')) return null;
    return { shortcut, command: '@selectAll' };
}

function isTextInput(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}
