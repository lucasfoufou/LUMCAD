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
        if (session.referenceSource) return { error: 'referenceSource' };
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
    const beginReference = (reference, loaded) => {
        if (session) return { error: 'editing' };
        const source = loaded.envelope.document;
        const draft = { blockId: reference.blockId, name: source.name, content: source.content,
            referenceSource: { referenceId: reference.id, reference, path: loaded.path, revision: loaded.revision, document: source } };
        draftHistory.reset({ content: source.content, layouts: source.layouts, pageSetups: source.pageSetups });
        setDraftAssets(source.assets);
        setSession({ ...draft, baseline: source.content, assets: source.assets });
        return draft;
    };
    const acceptReferenceSave = (reference, loaded, close, preserveDraft = false) => {
        if (close) setSession(null);
        else {
            const source = loaded.envelope.document;
            if (!preserveDraft) {
                draftHistory.reset({ content: source.content, layouts: source.layouts, pageSetups: source.pageSetups });
                setDraftAssets(source.assets);
            }
            setSession({ blockId: reference.blockId, name: source.name, content: source.content,
                referenceSource: { referenceId: reference.id, reference, path: loaded.path, revision: loaded.revision, document: source },
                baseline: source.content, assets: source.assets });
        }
    };
    return {
        session, dirty, begin, save, discard, beginReference, acceptReferenceSave,
        history: session ? draftHistory : modelHistory,
        assets: session ? draftAssets : modelAssets,
        setAssets: session ? setDraftAssets : setModelAssets,
    };
}
