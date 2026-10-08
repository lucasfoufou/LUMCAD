import { useRef, useState } from 'react';

import { useI18n } from '~i18n/I18nProvider';
import { createI18nError, localizeError } from '~i18n/translator';
import { createDrawingBlockLibrary, importDrawingBlockLibrary, inspectDrawingBlockLibrary, selectDrawingLibraryEntry, parseBlockExportInput } from '~utils/drawingBlockLibrary';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { prepareLcadTemplate } from '~utils/lcadTemplates';
import { createLcadEnvelope } from '~utils/lcadDocument';
import { exportLcadDocumentAs, isTauriRuntime, openLcadDocument, readLcadDocumentAtPath } from '~utils/lcadStorage';

export default function useDrawingBlockLibrary({ document, history, assets, setAssets, selectedIds, blockEditing, filePath, protectedPaths = [],
    setMessage, setSidebarPanel, setBlockSearch, setInteractiveOperation, setActiveTool, canvasRef }) {
    const { t } = useI18n();
    const pending = useRef(false);
    const latest = useRef(null);
    const [browser, setBrowser] = useState(null);
    const browserRef = useRef(null);
    const updateBrowser = value => { browserRef.current = value; setBrowser(value); };
    latest.current = { document, history, assets, blockEditing };
    const applyLibrary = (source, insert) => {
        const current = latest.current;
        const result = importDrawingBlockLibrary({ ...current.document, content: current.history.content, assets: current.assets }, source);
        setAssets(result.assets);
        current.history.commit(result.content);
        canvasRef.current?.cancel?.();
        setActiveTool('select');
        setInteractiveOperation(insert ? { type: 'blockInsert', stage: 'insertion', name: result.entryBlockIds[0], scale: 1, angle: 0 } : null);
        setBlockSearch('');
        setSidebarPanel('blocks');
        setMessage(t(insert ? 'block.insertPrompt' : 'block.imported'));
    };
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
                const prepared = prepareLcadTemplate(document, filePath);
                const library = createDrawingBlockLibrary(prepared.document, { ...options, selectedIds });
                const envelope = createLcadEnvelope(library);
                const result = await exportLcadDocumentAs(envelope, library.name, {
                    filterName: t('fileDialog.lcadDrawing'), destinationPath: options.path,
                    protectedPath: filePath, protectedPaths,
                });
                if (result) setMessage(t('block.exported'));
            } else {
                const path = String(input || '').trim().replace(/^"(.*)"$/, '$1');
                const loaded = path ? await readLcadDocumentAtPath(path) : await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
                if (!loaded) return;
                const current = latest.current;
                if (current.document.id !== initialId || current.blockEditing) return;
                applyLibrary(loaded.envelope.document, insert);
            }
        } catch (error) {
            setMessage(localizeError(error, t, action === 'export' ? 'block.error.exportFailed' : 'block.error.importFailed'));
        } finally { pending.current = false; }
    };
    const browse = async (input = '') => {
        if (latest.current.blockEditing) { setMessage(t('block.error.closeFirst')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('contentBrowser.syntax')); return; }
        const action = tokens[0]?.toUpperCase() || 'SHOW';
        const currentBrowser = browserRef.current;
        try {
            if (['SELECT', 'IMPORT', 'INSERT'].includes(action) && tokens.length === 2 && /^[1-9]\d*$/.test(tokens[1])) {
                const entry = currentBrowser?.entries[Number(tokens[1]) - 1];
                if (!entry) throw createI18nError('block.error.missing');
                if (action === 'SELECT') updateBrowser({ ...currentBrowser, selectedKey: entry.key });
                else applyLibrary(selectDrawingLibraryEntry(currentBrowser, entry.key), action === 'INSERT');
                setSidebarPanel('blocks');
                return;
            }
            if (action === 'CLOSE' && tokens.length === 1) { updateBrowser(null); return; }
            if (action === 'SHOW' && tokens.length <= 1 && currentBrowser) { setSidebarPanel('blocks'); return; }
            if (!(['SHOW', 'OPEN'].includes(action) && tokens.length <= (action === 'OPEN' ? 2 : 1))) {
                setMessage(t('contentBrowser.syntax')); return;
            }
            pending.current = true;
            const initialId = document.id;
            const path = tokens[1];
            const loaded = path ? await readLcadDocumentAtPath(path) : await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
            if (!loaded || latest.current.document.id !== initialId || latest.current.blockEditing) return;
            const prepared = prepareLcadTemplate(loaded.envelope.document, loaded.path);
            const inspected = inspectDrawingBlockLibrary(prepared.document);
            updateBrowser({ ...inspected, path: loaded.path, selectedKey: inspected.entries[0].key, unresolvedReferences: prepared.unresolved });
            setSidebarPanel('blocks');
            setMessage(t('contentBrowser.loaded', { count: inspected.entries.length }));
        } catch (error) { setMessage(localizeError(error, t, 'block.error.importFailed')); }
        finally { pending.current = false; }
    };
    return { run, browse, browser,
        getBrowserReport: () => browserRef.current ? { name: browserRef.current.document.name, path: browserRef.current.path,
            entries: browserRef.current.entries, selectedKey: browserRef.current.selectedKey,
            unresolvedReferences: browserRef.current.unresolvedReferences } : null };
}
