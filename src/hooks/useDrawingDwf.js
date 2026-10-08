import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { canEditEntity, createDrawingId, updateSelectedEntities } from '~utils/drawingDocument';
import { parseDrawingBlockClipInput } from '~utils/drawingBlockClip';
import { parseDrawingDwfAttachInput } from '~utils/drawingDwfCommands';
import { openDrawingDwfSource } from '~utils/drawingDwfSourceFiles';
import { DWFX_SOURCE_MIME } from '~utils/drawingDwfxSource';
import { attachDrawingDwfUnderlay } from '~utils/drawingDwfUnderlay';
import { createLcadArchive } from '~utils/lcadArchive';
import { createLcadEnvelope } from '~utils/lcadDocument';

export default function useDrawingDwf({ document, history, selectedIds, setAssets, setSelectedIds, enabled, setMessage, t }) {
    const latest = useRef(null); const pending = useRef(false); const mounted = useRef(true);
    latest.current = { document, history, enabled };
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
    const run = async (command, input) => {
        if (!enabled) { setMessage(t('reference.modelRequired')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        const initial = document;
        pending.current = true;
        try {
            if (command === 'dwfClip') {
                const target = selectedIds.length === 1 && document.content.entities.find(entity => entity.id === selectedIds[0] && entity.dwfUnderlay);
                if (!target || !canEditEntity(document.content, target)) throw new Error('dwfxSelection');
                const result = parseDrawingBlockClipInput(input, target.blockClip);
                if (!result) throw new Error('dwfxClipSyntax');
                history.commit(updateSelectedEntities(document.content, [target.id], entity => ({ ...entity, ...result })));
                setMessage(t('dwf.updated')); return;
            }
            const options = parseDrawingDwfAttachInput(input);
            const source = await openDrawingDwfSource(options.path);
            if (!source || !mounted.current) return;
            const { readDrawingDwfxPage } = await import('~utils/drawingDwfxReader');
            const page = await readDrawingDwfxPage(source.bytes, options);
            if (!mounted.current) return;
            const live = latest.current;
            if (!live.enabled || live.document.id !== initial.id || live.document.content !== initial.content || live.document.assets !== initial.assets) throw new Error('dwfxContext');
            const asset = { id: createDrawingId('asset'), name: source.name, mimeType: DWFX_SOURCE_MIME, link: source.link, width: 1, height: 1 };
            const result = attachDrawingDwfUnderlay(live.document, page, asset, options);
            createLcadArchive(createLcadEnvelope(result));
            flushSync(() => {
                setAssets(result.assets); live.history.commit(result.content); setSelectedIds(result.selectedIds);
                setMessage(t('dwf.attached', { page: page.pageNumber, count: page.pageCount }));
            });
        } catch (error) {
            if (mounted.current && latest.current.document.id === initial.id) {
                const key = ['dwfxSyntax', 'dwfxDesktop', 'dwfxSelection', 'dwfxClipSyntax', 'dwfxContext', 'dwfxPage', 'dwfxLimit'].includes(error.message)
                    ? error.message : 'failed';
                setMessage(t(`dwf.error.${key}`));
            }
        } finally { pending.current = false; }
    };
    return { run };
}
