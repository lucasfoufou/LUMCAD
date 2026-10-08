import { useCallback, useEffect, useRef, useState } from 'react';
import { drawingSheetSetRenderEntries } from '~utils/drawingSheetSetPublication';
import { createDrawingPdf, createDrawingDwfx, writeDrawingPublishFile } from '~utils/drawingPublish';

export default function useDrawingSheetSetPublication(t) {
    const [request, setRequest] = useState(null);
    const pending = useRef(null);
    useEffect(() => () => {
        pending.current?.reject(new Error('sheetSetCancelled'));
        pending.current = null;
    }, []);
    const onReady = useCallback(pages => {
        const job = pending.current;
        if (!job || job.rendered) return;
        job.rendered = true;
        if (pages.length !== job.count) job.reject(new Error('sheetSetRenderIncomplete'));
        else job.resolve(pages);
    }, []);
    const publish = async (loaded, format, path) => {
        if (pending.current) throw new Error('sheetSetBusy');
        const entries = drawingSheetSetRenderEntries(loaded.sheetSet, loaded.sources);
        try {
            const pages = await new Promise((resolve, reject) => {
                pending.current = { resolve, reject, count: entries.length, rendered: false };
                setRequest({ entries });
            });
            const options = { title: loaded.sheetSet.name };
            const bytes = format === 'dwfx' ? await createDrawingDwfx(pages, options) : await createDrawingPdf(pages, options);
            // A drawing/session switch may unmount the renderer while generation is pending.
            if (!pending.current) throw new Error('sheetSetCancelled');
            return await writeDrawingPublishFile({ bytes, format, explicitPath: path,
                defaultName: loaded.sheetSet.name, filterName: t(format === 'dwfx' ? 'fileDialog.dwfxDrawing' : 'fileDialog.pdfDrawing') });
        } finally {
            pending.current = null;
            setRequest(null);
        }
    };
    return { publish, request, onReady };
}
