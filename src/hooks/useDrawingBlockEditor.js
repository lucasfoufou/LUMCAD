import { useMemo, useState } from 'react';

import useDrawingHistory from '~hooks/useDrawingHistory';
import { createDrawingBlockEditDraft, saveDrawingBlockEdit } from '~utils/drawingBlockEditing';

export default function useDrawingBlockEditor({ modelHistory, modelAssets, setModelAssets }) {
    const [session, setSession] = useState(null);
    const [draftAssets, setDraftAssets] = useState([]);
    const draftHistory = useDrawingHistory({ content: modelHistory.content, layouts: [], pageSetups: [] });
    const dirty = useMemo(() => Boolean(session) && (
        JSON.stringify(draftHistory.content) !== JSON.stringify(session.baseline)
        || JSON.stringify(draftAssets) !== JSON.stringify(session.assets)
    ), [session, draftHistory.content, draftAssets]);

    const begin = nameOrId => {
        if (session) return { error: 'editing' };
        const draft = createDrawingBlockEditDraft(modelHistory.content, nameOrId);
        if (draft.error) return draft;
        draftHistory.reset({ content: draft.content, layouts: [], pageSetups: [] });
        setDraftAssets(modelAssets);
        setSession({ ...draft, baseline: draft.content, assets: modelAssets });
        return draft;
    };
    const save = ({ close = false } = {}) => {
        if (!session) return { error: 'notEditing' };
        const result = saveDrawingBlockEdit(modelHistory.content, session.blockId, draftHistory.content);
        if (result.error) return result;
        if (result.changed) modelHistory.commit(result.content);
        setModelAssets(draftAssets);
        if (close) setSession(null);
        else {
            const draft = createDrawingBlockEditDraft(result.content, session.blockId);
            draftHistory.reset({ content: draft.content, layouts: [], pageSetups: [] });
            setSession({ ...draft, baseline: draft.content, assets: draftAssets });
        }
        return result;
    };
    const discard = () => {
        if (!session) return { error: 'notEditing' };
        setSession(null);
        return {};
    };
    return {
        session, dirty, begin, save, discard,
        history: session ? draftHistory : modelHistory,
        assets: session ? draftAssets : modelAssets,
        setAssets: session ? setDraftAssets : setModelAssets,
    };
}
