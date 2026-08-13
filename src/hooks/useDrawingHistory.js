import { useCallback, useState } from 'react';

const HISTORY_LIMIT = 100;

export default function useDrawingHistory(initialContent) {
    const [history, setHistory] = useState({ past: [], present: initialContent, future: [], coalesceKey: null });

    const commit = useCallback((nextOrUpdater, { coalesceKey = null } = {}) => {
        setHistory(current => {
            const next = typeof nextOrUpdater === 'function'
                ? nextOrUpdater(current.present)
                : nextOrUpdater;
            if (!next || next === current.present) return current;
            return {
                past: coalesceKey && current.coalesceKey === coalesceKey
                    ? current.past
                    : [...current.past, current.present].slice(-HISTORY_LIMIT),
                present: next,
                future: [],
                coalesceKey,
            };
        });
    }, []);

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

    return {
        content: history.present,
        commit,
        endCoalescing,
        undo,
        redo,
        canUndo: history.past.length > 0,
        canRedo: history.future.length > 0,
    };
}
