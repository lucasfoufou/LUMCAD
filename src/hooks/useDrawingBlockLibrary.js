import { useRef } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { createI18nError, localizeError } from '~i18n/translator';
import { createDrawingBlockLibrary, importDrawingBlockLibrary, parseBlockExportInput } from '~utils/drawingBlockLibrary';
import { createLcadEnvelope } from '~utils/lcadDocument';
import { exportLcadDocumentAs, isTauriRuntime, openLcadDocument, readLcadDocumentAtPath, writeLcadDocument } from '~utils/lcadStorage';

export default function useDrawingBlockLibrary({ document, history, assets, setAssets, selectedIds, blockEditing, filePath,
    setMessage, setSidebarPanel, setBlockSearch, setInteractiveOperation, setActiveTool, canvasRef }) {
    const { t } = useI18n();
    const pending = useRef(false);
    const latest = useRef(null);
    latest.current = { document, history, assets, blockEditing };
    const run = async (action, input = '', insert = false) => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        pending.current = true;
        const initialId = document.id;
        try {
            if (action === 'export') {
                const options = parseBlockExportInput(input);
                if (!options) throw createI18nError('block.error.exportSyntax');
                if (options.path && (!isTauriRuntime() || !/^(?:\/|[A-Za-z]:[\\/])/.test(options.path) || !/\.lcad$/i.test(options.path))) throw createI18nError('block.error.libraryPath');
                if (options.path && options.path === filePath) throw createI18nError('block.error.activeFile');
                const library = createDrawingBlockLibrary(document, { ...options, selectedIds });
                const envelope = createLcadEnvelope(library);
                const result = options.path ? await writeLcadDocument(options.path, envelope)
                    : await exportLcadDocumentAs(envelope, library.name, { filterName: t('fileDialog.lcadDrawing') });
                if (result) setMessage(t('block.exported'));
            } else {
                const path = String(input || '').trim().replace(/^"(.*)"$/, '$1');
                const loaded = path ? await readLcadDocumentAtPath(path) : await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
                if (!loaded) return;
                const current = latest.current;
                if (current.document.id !== initialId || current.blockEditing) return;
                const result = importDrawingBlockLibrary({ ...current.document, content: current.history.content, assets: current.assets }, loaded.envelope.document);
                setAssets(result.assets);
                current.history.commit(result.content);
                canvasRef.current?.cancel?.();
                setActiveTool('select');
                setInteractiveOperation(insert ? { type: 'blockInsert', stage: 'insertion', name: result.entryBlockIds[0], scale: 1, angle: 0 } : null);
                setBlockSearch('');
                setSidebarPanel('blocks');
                setMessage(t(insert ? 'block.insertPrompt' : 'block.imported'));
            }
        } catch (error) {
            setMessage(localizeError(error, t, action === 'export' ? 'block.error.exportFailed' : 'block.error.importFailed'));
        } finally { pending.current = false; }
    };
    return { run };
}
