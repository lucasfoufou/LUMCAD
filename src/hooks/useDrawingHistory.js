import { commitDrawingHistoryState, undoDrawingHistoryState, redoDrawingHistoryState, updateDrawingHistoryMetadata } from '~utils/drawingHistory';
import { useCallback, useState } from 'react';

const NO_PAGE_SETUPS = Object.freeze([]);

export default function useDrawingHistory(initialContent) {
    const documentMode = isDocumentHistoryState(initialContent);
    const [history, setHistory] = useState({ past: [], present: initialContent, future: [], coalesceKey: null });

    const commitPresent = useCallback((nextOrUpdater, { coalesceKey = null, applyCreationStyles = true, preserveConstraintSnapshot = false } = {}) => {
        setHistory(current => {
            const next = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(current.present)
                : nextOrUpdater;
            return commitDrawingHistoryState(current, next, { coalesceKey, applyCreationStyles, preserveConstraintSnapshot });
        });
    }, []);

    const commit = useCallback((nextOrUpdater, { coalesceKey = null } = {}) => {
        commitPresent(current => {
            if (!documentMode) {
                return typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
            }
            const nextContent = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(current.content)
                : nextOrUpdater;
            return !nextContent || nextContent === current.content
                ? current
                : { ...current, content: nextContent };
        }, { coalesceKey });
    }, [commitPresent, documentMode]);

    const commitLayouts = useCallback((nextOrUpdater, options = {}) => {
        if (!documentMode) return;
        commitPresent(current => {
            const nextLayouts = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(current.layouts)
                : nextOrUpdater;
            return !Array.isArray(nextLayouts) || nextLayouts === current.layouts
                ? current
                : { ...current, layouts: nextLayouts };
        }, options);
    }, [commitPresent, documentMode]);

    const commitPageSetups = useCallback((nextOrUpdater, options = {}) => {
        if (!documentMode) return;
        commitPresent(current => {
            const nextPageSetups = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(current.pageSetups || [])
                : nextOrUpdater;
            return !Array.isArray(nextPageSetups) || nextPageSetups === current.pageSetups
                ? current
                : { ...current, pageSetups: nextPageSetups };
        }, options);
    }, [commitPresent, documentMode]);

    const endCoalescing = useCallback(() => {
        setHistory(current => current.coalesceKey ? { ...current, coalesceKey: null } : current);
    }, []);

    const undo = useCallback(() => {
        setHistory(undoDrawingHistoryState);
    }, []);

    const redo = useCallback(() => {
        setHistory(redoDrawingHistoryState);
    }, []);

    const updateMetadata = useCallback((field, updater) => setHistory(current => updateDrawingHistoryMetadata(current, field, updater)), []);

    const reset = useCallback(present => setHistory({ past: [], present, future: [], coalesceKey: null }), []);

    return {
        reset,
        updateMetadata,
        content: documentMode ? history.present.content : history.present,
        layouts: documentMode ? history.present.layouts : null,
        pageSetups: documentMode ? history.present.pageSetups || NO_PAGE_SETUPS : null,
        documentState: documentMode ? history.present : null,
        commit,
        commitDocument: commitPresent,
        commitLayouts,
        commitPageSetups,
        endCoalescing,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
        rejection: history.rejection,
    };
}

function isDocumentHistoryState(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.content
        && Array.isArray(value.layouts);
}
