import { useRef } from 'react';
import { createDrawingStandards, checkDrawingStandards } from '~utils/drawingStandards';
import { repairDrawingStandards } from '~utils/drawingStandardsRepair';
import { replaceDrawingStandard } from '~utils/drawingStandardsReplacement';
import { readDrawingStandardsFile, writeDrawingStandardsFile } from '~utils/drawingStandardsFiles';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { isTauriRuntime } from '~utils/lcadStorage';

export default function useDrawingStandards({ document, enabled, present, commitDocument, setMessage, t }) {
    const session = useRef(null); const pending = useRef(false); const latest = useRef(null);
    latest.current = { document, enabled };
    const binding = document.content.standards;
    const bindingKey = binding ? JSON.stringify(binding) : null;
    if (!binding) session.current = null;
    else if (session.current?.documentId !== document.id || session.current?.bindingKey !== bindingKey) {
        session.current = { ...binding, documentId: document.id, bindingKey, report: checkDrawingStandards(document.content, binding.standard) };
    }
    const fail = error => setMessage(t(`standards.${['standardsDesktop', 'standardsStale', 'standardsLocked', 'standardsSelection',
        'standardsReplacementRequired', 'standardsLimit', 'standardsTarget', 'standardsProtected'].includes(error?.message || error) ? error.message || error : 'failed'}`));
    const show = report => {
        session.current.report = report;
        present({ mode: 'standards', path: session.current.path, ...report });
        setMessage(t('standards.result', { count: report.issues.length }));
    };
    const run = async (input, checking = false) => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('standards.syntax')); return; }
        const action = (tokens[0] || (checking ? 'CHECK' : 'REPORT')).toUpperCase();
        try {
            if (checking) {
                if (!session.current) { setMessage(t('standards.empty')); return; }
                if (!tokens.length || action === 'REPORT' && tokens.length === 1) {
                    show(checkDrawingStandards(document.content, session.current.standard)); return;
                }
                if (action === 'REPLACE' && tokens.length === 3 && /^[1-9]\d*$/.test(tokens[1])) {
                    const result = replaceDrawingStandard(document, session.current.standard, session.current.report, Number(tokens[1]) - 1, tokens[2]);
                    if (result.error) { fail(result.error); return; }
                    commitDocument(result.document, { applyCreationStyles: false, preserveConstraintSnapshot: true });
                    show(result.report); return;
                }
                if (action !== 'FIX' || tokens.length < 2) { setMessage(t('standards.syntax')); return; }
                const report = session.current.report;
                const indexes = tokens.length === 2 && tokens[1].toUpperCase() === 'ALL'
                    ? report.issues.map((_, index) => index)
                    : tokens.slice(1).every(value => /^[1-9]\d*$/.test(value)) ? tokens.slice(1).map(Number).map(value => value - 1) : null;
                const result = repairDrawingStandards(document, session.current.standard, report, indexes);
                if (result.error) { fail(result.error); return; }
                commitDocument(result.document, { applyCreationStyles: false, preserveConstraintSnapshot: true });
                show(result.report); return;
            }
            if (action === 'REPORT' && tokens.length <= 1) {
                if (!session.current) { setMessage(t('standards.empty')); return; }
                show(checkDrawingStandards(document.content, session.current.standard)); return;
            }
            if (action === 'DETACH' && tokens.length === 1) {
                if (binding) commitDocument({ ...document, content: { ...document.content, standards: null } }, { applyCreationStyles: false, preserveConstraintSnapshot: true });
                session.current = null; present(null); setMessage(t('standards.detached')); return;
            }
            if (!['LOAD', 'SAVE'].includes(action) || tokens.length > 2) { setMessage(t('standards.syntax')); return; }
            pending.current = true;
            const sourceId = document.id;
            if (action === 'SAVE') {
                const standard = createDrawingStandards(document.content, document.name || 'Standard');
                if (await writeDrawingStandardsFile(standard, tokens[1], t('standards.title')))
                    setMessage(t(isTauriRuntime() ? 'standards.saved' : 'standards.downloadRequested'));
            } else {
                const loaded = await readDrawingStandardsFile(tokens[1], t('standards.title'));
                if (!loaded) return;
                if (!latest.current.enabled || latest.current.document.id !== sourceId) throw new Error('standardsStale');
                const report = checkDrawingStandards(latest.current.document.content, loaded.standard);
                const attached = { version: 1, ...loaded };
                const current = latest.current.document;
                commitDocument({ ...current, content: { ...current.content, standards: attached } }, { applyCreationStyles: false, preserveConstraintSnapshot: true });
                session.current = { ...attached, documentId: sourceId, bindingKey: JSON.stringify(attached) };
                show(report);
            }
        } catch (error) { fail(error); }
        finally { pending.current = false; }
    };
    return { run, getReport: () => session.current ? { path: session.current.path, ...session.current.report } : null };
}
