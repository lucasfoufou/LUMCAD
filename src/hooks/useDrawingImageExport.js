import { useEffect, useRef } from 'react';
import { save } from '../utils/nativeDialogs.js';
import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from '~utils/lcadStorage';
import { downloadBrowserBlob } from '~utils/browserDownload';
import { parseDrawingImageExport, drawingImageExportBytes } from '~utils/drawingImageExport';
import useDrawingRasterExport from './useDrawingRasterExport';

export default function useDrawingImageExport({ documentId, name, content, assets, enabled, setMessage, t }) {
    const renderer = useDrawingRasterExport();
    const busy = useRef(false); const alive = useRef(true);
    const latest = useRef(null); latest.current = { documentId, enabled, content, assets };
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const run = async (format, input) => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (busy.current) { setMessage(t('imageExport.busy')); return; }
        const valid = () => alive.current && latest.current.documentId === documentId && latest.current.enabled
            && latest.current.content === content && latest.current.assets === assets;
        busy.current = true;
        try {
            const options = parseDrawingImageExport(input, format);
            if (options.path && !isTauriRuntime()) throw new Error('desktop');
            const result = await renderer.render({ content, assets }, options);
            if (!valid()) throw new Error('changed');
            const bytes = drawingImageExportBytes(result, format);
            if (isTauriRuntime()) {
                const path = options.path || await save({ defaultPath: `${name}.${format}`, filters: [{ name: t('imageExport.title'), extensions: [format] }] });
                if (!path) { setMessage(t('imageExport.cancelled')); return; }
                if (!valid()) throw new Error('changed');
                await invoke('write_drawing_image', { path, bytes: Array.from(bytes), format });
            } else downloadBrowserBlob(new Blob([bytes], { type: { png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml' }[format] }), `${name}.${format}`);
            if (valid()) setMessage(t(isTauriRuntime() ? 'imageExport.saved' : 'imageExport.downloaded', { format: format.toUpperCase(), width: result.width, height: result.height }));
        } catch (error) {
            if (alive.current && latest.current.documentId === documentId) {
                const key = ['syntax', 'desktop', 'changed', 'limit'].includes(error.message) ? error.message
                    : error.message === 'wmfEmpty' ? 'empty' : 'failed';
                setMessage(t(`imageExport.${key}`));
            }
        } finally { busy.current = false; }
    };
    return { run, request: renderer.request };
}
