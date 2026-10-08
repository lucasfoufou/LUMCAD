import { useRef } from 'react';
import { createDrawingSheetSet, editDrawingSheetSet } from '~utils/drawingSheetSets';
import { editDrawingSheetSetCommand } from '~utils/drawingSheetSetCommands';
import { readDrawingSheetSetFile, writeDrawingSheetSetFile } from '~utils/drawingSheetSetFiles';
import { loadNativeDrawingSheetSetSources } from '~utils/drawingSheetSetNative';
import { readLcadDocumentAtPath, isTauriRuntime } from '~utils/lcadStorage';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { createDrawingId } from '~utils/drawingDocument';
import useDrawingSheetSetPublication from './useDrawingSheetSetPublication';
import { exportNativeDrawingTransmittal } from '~utils/drawingTransmittalNative';

export default function useDrawingSheetSet({ sessionRef, document, filePath, present, setMessage, t }) {
    const fallback = useRef(null);
    const publication = useDrawingSheetSetPublication(t);
    const state = sessionRef || fallback;
    const dirty = () => state.current && JSON.stringify(state.current.sheetSet) !== state.current.savedKey;
    const report = () => state.current ? { mode: 'sheetSet', name: state.current.sheetSet.name, path: state.current.path,
        dirty: Boolean(dirty()), sheets: state.current.sheetSet.sheets, sources: state.current.sheetSet.sources,
        properties: state.current.sheetSet.properties, checked: Boolean(state.current.checked),
        publicationError: state.current.publicationError || null } : null;
    const show = () => { present(report()); setMessage(t('sheetSet.ready')); };
    const replace = (sheetSet, path, saved) => {
        state.current = { sheetSet, path, savedKey: saved ? JSON.stringify(sheetSet) : null, past: [], future: [], busy: false };
    };
    const commit = sheetSet => {
        const current = state.current;
        current.past = [...current.past.slice(-49), current.sheetSet];
        current.sheetSet = sheetSet; current.future = []; current.checked = false;
    };
    const run = async (command, input) => {
        if (state.busy) { setMessage(t('block.libraryBusy')); return; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('sheetSet.sheetSetSyntax')); return; }
        const action = command === 'newSheetSet' ? 'NEW' : command === 'openSheetSet' ? 'OPEN' : (tokens[0] || 'REPORT').toUpperCase();
        const args = ['newSheetSet', 'openSheetSet'].includes(command) ? tokens : tokens.slice(1);
        const current = state.current;
        state.busy = true;
        try {
            if (action === 'NEW' || action === 'OPEN') {
                if (dirty()) throw new Error('sheetSetDirty');
                if (action === 'NEW') {
                    if (args.length !== 1) throw new Error('sheetSetSyntax');
                    replace(createDrawingSheetSet(args[0]), null, false);
                } else {
                    if (args.length > 1) throw new Error('sheetSetSyntax');
                    const loaded = await readDrawingSheetSetFile(args[0], t('sheetSet.title'));
                    if (!loaded) return;
                    replace(loaded.sheetSet, loaded.path, true);
                }
                show(); return;
            }
            if (!current) throw new Error('sheetSetMissing');
            if (action === 'CLOSE' && (args.length === 0 || args.length === 1 && args[0].toUpperCase() === 'DISCARD')) {
                if (dirty() && !args.length) throw new Error('sheetSetDirty');
                state.current = null; present(null); setMessage(t('sheetSet.closed')); return;
            }
            if (action === 'REPORT' && !args.length) { show(); return; }
            if (['ARCHIVE', 'ETRANSMIT'].includes(action) && args.length <= 1) {
                const result = await exportNativeDrawingTransmittal(current.sheetSet, current.path, args[0], t('sheetSet.archiveTitle'));
                if (result) { show(); setMessage(t('sheetSet.archived', { count: result.files.length })); }
                return;
            }
            if (action === 'SAVE' && args.length <= 1) {
                const result = await writeDrawingSheetSetFile(current.sheetSet, current.path, args[0] || current.path, t('sheetSet.title'));
                if (!result) return;
                // Rebased paths and their undo history must share the new index location.
                current.sheetSet = result.sheetSet; current.path = result.path;
                current.savedKey = JSON.stringify(result.sheetSet); current.past = []; current.future = []; current.checked = false;
                show(); setMessage(t(isTauriRuntime() ? 'sheetSet.saved' : 'sheetSet.downloadRequested')); return;
            }
            if (action === 'CHECK' && !args.length) {
                current.checked = false;
                present(report());
                await loadNativeDrawingSheetSetSources(current.sheetSet, current.path);
                current.checked = true; show(); return;
            }
            if (action === 'PUBLISH' && args.length >= 1 && args.length <= 2 && ['PDF', 'DWFX'].includes(args[0].toUpperCase())) {
                current.publicationError = null;
                current.checked = false; present(report());
                const loaded = await loadNativeDrawingSheetSetSources(current.sheetSet, current.path);
                current.checked = true;
                const result = await publication.publish(loaded, args[0].toLowerCase(), args[1] || null);
                show();
                setMessage(t(result ? 'publish.exported' : 'publish.cancelled', { count: loaded.pages.length, format: args[0].toUpperCase() }));
                return;
            }
            if (['UNDO', 'REDO'].includes(action) && !args.length) {
                const from = action === 'UNDO' ? 'past' : 'future'; const to = action === 'UNDO' ? 'future' : 'past';
                if (!current[from].length) throw new Error('sheetSetHistory');
                current[to].push(current.sheetSet); current.sheetSet = current[from].pop(); current.checked = false;
                show(); return;
            }
            if (action === 'ADD' && args.length === 4) {
                const loaded = args[0].toUpperCase() === 'CURRENT' ? { envelope: { document }, path: filePath } : await readLcadDocumentAtPath(args[0]);
                if (!loaded.path) throw new Error('sheetSetSavedSource');
                const sourceDocument = loaded.envelope.document;
                const layouts = sourceDocument.layouts.filter(layout => layout.id === args[1] || layout.name.toLowerCase() === args[1].toLowerCase());
                if (layouts.length !== 1) throw new Error('sheetSetLayoutMissing');
                const existing = current.sheetSet.sources.find(source => source.path === loaded.path);
                if (existing && existing.documentId !== sourceDocument.id) throw new Error('sheetSetSourceChanged');
                const source = existing || { id: createDrawingId('sheet-source'), path: loaded.path, documentId: sourceDocument.id };
                commit(editDrawingSheetSet(current.sheetSet, [{ type: 'source', source }, { type: 'sheet', sheet: {
                    id: createDrawingId('sheet'), sourceId: source.id, layoutId: layouts[0].id, number: args[2], title: args[3], properties: {},
                } }]));
            } else commit(editDrawingSheetSetCommand(current.sheetSet, [action, ...args]));
            show();
        } catch (error) {
            if (action === 'PUBLISH' && current) {
                current.publicationError = String(error?.message || error).slice(0, 1024);
                present(report());
            }
            const code = typeof error?.message === 'string' && /^sheetSet[A-Z]/.test(error.message) ? error.message : 'failed';
            setMessage(t(`sheetSet.${code}`));
        } finally { state.busy = false; }
    };
    return { run, getReport: report, publication };
}
