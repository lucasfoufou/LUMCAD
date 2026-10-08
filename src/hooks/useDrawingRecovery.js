import { useRef, useState } from 'react';
import { localizeError } from '~i18n/translator';
import { recoverLcadDocument, recoverLcadDocumentTree, listLcadRecoveryHistory, recordLcadRecoveryHistory, forgetLcadRecoveryHistory } from '~utils/lcadStorage';
import { lcadRecoveryReport, parseLcadRecoveryInput, parseLcadRecoveryManagerInput } from '~utils/lcadRecovery';
import { lcadRecoveryGraphReport } from '~utils/lcadRecoveryGraph';
import { recordRecoveredCopyPath, prepareRecoveredReferencePaths } from '~utils/lcadRecoveryReferences';
import { createLcadRecoveryHistoryEntry } from '~utils/lcadRecoveryHistory';

export default function useDrawingRecovery({ filePath, document, commitDocument, blockEditing, present, openRecoveredDrawing, setMessage, t, initialReport = null, initialGraph = null }) {
    const [candidate, setCandidate] = useState(null);
    const candidateRef = useRef(null);
    const [graph, setGraph] = useState(initialGraph);
    const graphRef = useRef(initialGraph);
    const historyRef = useRef(null);
    const busy = useRef(false);
    const showHistory = async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            historyRef.current = await listLcadRecoveryHistory();
            present({ mode: 'recoveryHistory', entries: historyRef.current.entries });
        } catch (error) { setMessage(localizeError(error, t, 'recovery.historyFailed')); }
        finally { busy.current = false; }
    };
    const showManager = async () => {
        if (graphRef.current) present(lcadRecoveryGraphReport(graphRef.current));
        else await showHistory();
    };
    const remember = async (result, batch) => {
        try {
            historyRef.current = await recordLcadRecoveryHistory(createLcadRecoveryHistoryEntry(result, { batch }));
            return true;
        } catch { return false; }
    };
    const retry = async id => {
        if (busy.current) return;
        const entry = historyRef.current?.entries.find(entry => entry.id === id);
        if (!entry) { setMessage(t('recovery.historyMissing')); return; }
        await run(entry.sourcePath ? `FROM ${JSON.stringify(entry.sourcePath)}` : '', { all: entry.kind === 'batch' });
    };
    const forget = async id => {
        if (busy.current || !historyRef.current?.entries.some(entry => entry.id === id)) return;
        busy.current = true;
        try {
            historyRef.current = await forgetLcadRecoveryHistory(id);
            present({ mode: 'recoveryHistory', entries: historyRef.current.entries });
        } catch (error) { setMessage(localizeError(error, t, 'recovery.historyFailed')); }
        finally { busy.current = false; }
    };
    const select = id => {
        if (busy.current) return;
        const entry = graphRef.current?.entries.find(entry => entry.id === id);
        if (!entry?.result) { setMessage(t('recovery.noCandidate')); return; }
        candidateRef.current = entry.result;
        setCandidate(entry.result);
        present(lcadRecoveryReport(entry.result));
    };
    const open = async id => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return; }
        const current = typeof id === 'string' ? graphRef.current?.entries.find(entry => entry.id === id)?.result : candidateRef.current;
        if (!current?.ready) { setMessage(t('recovery.noCandidate')); return; }
        if (busy.current) return;
        busy.current = true;
        try { await openRecoveredDrawing(current, () => graphRef.current); }
        catch (error) { setMessage(localizeError(error, t, 'recovery.failed')); }
        finally { busy.current = false; }
    };
    const relink = () => {
        if (busy.current) return;
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return; }
        if (!initialReport?.opened || !graphRef.current?.entries.some(entry => entry.sourcePath === initialReport.path)) {
            setMessage(t('recovery.relinkUnavailable')); return;
        }
        const result = prepareRecoveredReferencePaths(document, initialReport.path, graphRef.current);
        if (result.changes.length) commitDocument(current => ({ ...current, content: result.document.content, layouts: result.document.layouts }));
        present({ mode: 'recoveryRelink', changes: result.changes, unresolved: result.unresolved });
        setMessage(t('recovery.relinkResult', { count: result.changes.length }));
    };
    const run = async (input, { all = false, manager = false } = {}) => {
        if (blockEditing) { setMessage(t('block.error.closeFirst')); return; }
        const request = manager ? parseLcadRecoveryManagerInput(input) : parseLcadRecoveryInput(input);
        if (!request) { setMessage(t(manager ? 'recovery.managerSyntax' : 'recovery.syntax')); return; }
        if (request.action === 'open') { await open(request.id); return; }
        if (busy.current) return;
        if (request.action === 'relink') { relink(); return; }
        if (request.action === 'history') { await showHistory(); return; }
        if (['retry', 'remove'].includes(request.action)) {
            if (!historyRef.current) {
                try { historyRef.current = await listLcadRecoveryHistory(); }
                catch (error) { setMessage(localizeError(error, t, 'recovery.historyFailed')); return; }
            }
            const id = historyRef.current.entries[request.index]?.id;
            if (!id) { setMessage(t('recovery.historyMissing')); return; }
            await (request.action === 'retry' ? retry : forget)(id);
            return;
        }
        if (request.action === 'select') { select(request.id); return; }
        if (request.action === 'report') {
            if (all || manager) { await showManager(); return; }
            if (candidateRef.current) present(lcadRecoveryReport(candidateRef.current));
            else if (initialReport) present(initialReport);
            else setMessage(t('recovery.noCandidate'));
            return;
        }
        busy.current = true;
        // A failed new request must not leave an older candidate available to OPEN.
        candidateRef.current = null;
        setCandidate(null);
        graphRef.current = null;
        setGraph(null);
        try {
            const result = await (all ? recoverLcadDocumentTree : recoverLcadDocument)({ path: request.path, protectedPath: filePath,
                filterName: t('fileDialog.lcadDrawing'), recoveredLayerName: t('audit.recoveredLayer') });
            if (!result) { setMessage(t('recovery.cancelled')); return; }
            if (all) {
                graphRef.current = result;
                setGraph(result);
                candidateRef.current = result.entries[0]?.result || null;
                setCandidate(candidateRef.current);
                await showManager();
                const saved = await remember(result, true);
                setMessage(t(saved ? result.complete ? 'recovery.batchComplete' : 'recovery.batchPartial' : 'recovery.historySaveFailed', { count: result.entries.length }));
                return;
            }
            if (result.error) { setMessage(t(`audit.${result.error}`)); return; }
            candidateRef.current = result;
            setCandidate(result);
            present(lcadRecoveryReport(result));
            const saved = await remember(result, false);
            setMessage(t(saved ? result.ready ? 'recovery.ready' : 'recovery.unresolved' : 'recovery.historySaveFailed'));
        } catch (error) { setMessage(localizeError(error, t, 'recovery.failed')); }
        finally { busy.current = false; }
    };
    const recordSavedCopy = path => {
        const next = recordRecoveredCopyPath(graphRef.current, initialReport?.path, path);
        if (next !== graphRef.current) { graphRef.current = next; setGraph(next); }
    };
    return { run, open, select, relink, canRelink: Boolean(initialReport?.opened && graph?.entries.some(entry => entry.sourcePath === initialReport.path)), recordSavedCopy, showManager, showHistory, retry, forget, hasGraph: Boolean(graph), canOpen: Boolean(candidate?.ready) };
}
