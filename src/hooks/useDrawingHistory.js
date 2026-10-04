import { applyCurrentStyleToNewDimensions } from '~utils/drawingDimensionStyles';
import { refreshDrawingHatches } from '~utils/drawingHatches';
import { refreshPathArrays } from '~utils/drawingPathArray';
import { useCallback, useState } from 'react';

const HISTORY_LIMIT = 100;

export default function useDrawingHistory(initialContent) {
    const documentMode = isDocumentHistoryState(initialContent);
    const [history, setHistory] = useState({ past: [], present: initialContent, future: [], coalesceKey: null });

    const commitPresent = useCallback((nextOrUpdater, { coalesceKey = null, applyCreationStyles = true } = {}) => {
        setHistory(current => {
            const next = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(current.present)
                : nextOrUpdater;
            if (!next || next === current.present) return current;
            return {
                past: coalesceKey && current.coalesceKey === coalesceKey
                    ? current.past
                    : [...current.past, current.present].slice(-HISTORY_LIMIT),
                present: next.content
                    ? { ...next, content: refreshDrawingHatches(refreshPathArrays((applyCreationStyles ? applyCurrentStyleToNewDimensions(next.content, current.present.content) : next.content), current.present.content), current.present.content) }
                    : refreshDrawingHatches(refreshPathArrays((applyCreationStyles ? applyCurrentStyleToNewDimensions(next, current.present) : next), current.present), current.present),
                future: [],
                coalesceKey,
            };
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
        setHistory(current => {
            if (current.past.length === 0) return current;
            return {
                past: current.past.slice(0, -1),
                present: current.past[current.past.length - 1],
                future: [current.present, ...current.future],
                coalesceKey: null,
            };
        });
    }, []);

    const redo = useCallback(() => {
        setHistory(current => {
            if (current.future.length === 0) return current;
            return {
                past: [...current.past, current.present].slice(-HISTORY_LIMIT),
                present: current.future[0],
                future: current.future.slice(1),
                coalesceKey: null,
            };
        });
    }, []);

    const reset = useCallback(present => setHistory({ past: [], present, future: [], coalesceKey: null }), []);

    return {
        reset,
        content: documentMode ? history.present.content : history.present,
        layouts: documentMode ? history.present.layouts : null,
        pageSetups: documentMode ? history.present.pageSetups || [] : null,
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
    };
}

function isDocumentHistoryState(value) {
    return Boolean(value)
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.content
        && Array.isArray(value.layouts);
}
