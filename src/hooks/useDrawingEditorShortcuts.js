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
            if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 's') { event.preventDefault(); return; }
            if (event.key === 'Escape') { actionsRef.current.cancel(); return; }
            const binding = preferencesRef.current.find(row => row.shortcut === drawingShortcutFromEvent(event));
            if (binding && (!targetIsInput || ['@saveAs', '@open', '@newDocument'].includes(binding.command))) {
                event.preventDefault();
                if (event.repeat) return;
                const action = binding.command.startsWith('@') ? actionsRef.current[binding.command.slice(1)]
                    : () => actionsRef.current.command(getDrawingCommandDefinition(binding.command).name);
                Promise.resolve().then(action).catch(() => {});
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
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [actionsRef, commandBarRef, preferencesRef]);
}

function isTextInput(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}
