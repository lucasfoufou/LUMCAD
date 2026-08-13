import { useEffect } from 'react';

import useLatestRef from '~hooks/useLatestRef';

export default function useDrawingEditorShortcuts({ actions, commandBarRef }) {
    const actionsRef = useLatestRef(actions);
    useEffect(() => {
        const onKeyDown = event => {
            const targetIsInput = isTextInput(event.target);
            const modifier = event.ctrlKey || event.metaKey;
            if (event.key === 'Escape') {
                actionsRef.current.cancel();
                return;
            }
            if (modifier && event.key.toLowerCase() === 's') {
                event.preventDefault();
                if (event.shiftKey) actionsRef.current.saveAs().catch(() => {});
                return;
            }
            if (modifier && event.key.toLowerCase() === 'o') {
                event.preventDefault();
                actionsRef.current.open().catch(() => {});
                return;
            }
            if (modifier && event.key.toLowerCase() === 'n') {
                event.preventDefault();
                actionsRef.current.newDocument().catch(() => {});
                return;
            }
            if (targetIsInput) return;
            if (!modifier && event.key === 'Enter') {
                event.preventDefault();
                actionsRef.current.enter().catch(() => {});
            } else if (modifier && event.key.toLowerCase() === 'z') {
                event.preventDefault();
                event.shiftKey ? actionsRef.current.redo() : actionsRef.current.undo();
            } else if (modifier && event.key.toLowerCase() === 'y') {
                event.preventDefault();
                actionsRef.current.redo();
            } else if (modifier && event.key.toLowerCase() === 'c') {
                event.preventDefault();
                actionsRef.current.copy();
            } else if (modifier && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                actionsRef.current.paste();
            } else if (event.key === 'Delete' || event.key === 'Backspace') {
                event.preventDefault();
                actionsRef.current.delete();
            } else if (event.key === 'F3') {
                event.preventDefault();
                actionsRef.current.toggleSnaps();
            } else if (!modifier && !event.altKey && event.key.length === 1 && /[a-zA-Z0-9.,+\-]/.test(event.key)) {
                event.preventDefault();
                commandBarRef.current?.focus(event.key);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [actionsRef, commandBarRef]);
}

function isTextInput(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
}
