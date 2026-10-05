import { useCallback, useMemo, useState } from 'react';
import { drawingContentWithHiddenObjects, withoutDrawingObjectVisibility, updateDrawingObjectVisibility } from '~utils/drawingObjectVisibility';

const EMPTY_IDS = Object.freeze([]);

export default function useDrawingObjectVisibility(history, scope, enabled) {
    const [state, setState] = useState({ scope, ids: [] });
    const ids = state.scope === scope ? state.ids : EMPTY_IDS;
    const content = useMemo(() => enabled ? drawingContentWithHiddenObjects(history.content, ids) : history.content, [history.content, ids, enabled]);
    const commit = useCallback((nextOrUpdater, options) => history.commit(current => {
        const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
        return withoutDrawingObjectVisibility(next);
    }, options), [history.commit]);
    const update = (mode, selectedIds) => setState(current => ({ scope,
        ids: updateDrawingObjectVisibility(history.content, current.scope === scope ? current.ids : [], selectedIds, mode) }));
    return { history: { ...history, content, commit }, hiddenIds: ids, update };
}
