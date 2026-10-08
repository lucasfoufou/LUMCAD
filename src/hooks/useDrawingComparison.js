import { createDrawingComparisonClouds } from '~utils/drawingComparisonClouds';
import { importDrawingComparison } from '~utils/drawingComparisonImport';
import { useRef } from 'react';
import { compareDrawingDocuments } from '~utils/drawingComparison';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { openLcadDocument, readLcadDocumentAtPath } from '~utils/lcadStorage';

export default function useDrawingComparison({ document, enabled, present, commitDocument, cancel, setSelectedIds, setMessage, t }) {
    const pending = useRef(false);
    const session = useRef(null);
    const latest = useRef(null);
    latest.current = { document, enabled };
    if (session.current && session.current.baseline.id !== document.id) session.current = null;
    const show = () => {
        if (!session.current) { setMessage(t('comparison.empty')); return; }
        const { report, path } = session.current;
        present({ mode: 'drawingCompare', path, counts: report.counts,
            changes: report.changes.map(({ scope, key, kind }, index) => ({ index: index + 1, scope, key, kind })) });
    };
    const run = async input => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('comparison.syntax')); return; }
        if (tokens[0]?.toUpperCase() === 'CLOUDS') {
            if (!session.current) { setMessage(t('comparison.empty')); return; }
            if (![1, 3].includes(tokens.length) || tokens.slice(1).some(value => !value.trim() || !Number.isFinite(Number(value)))) {
                setMessage(t('comparison.comparisonCloudOptions')); return;
            }
            try {
                const { baseline, incoming, report } = session.current;
                if (compareDrawingDocuments(baseline, document).changes.length) { setMessage(t('comparison.comparisonStale')); return; }
                const options = tokens.length === 3 ? { padding: Number(tokens[1]), arcLength: Number(tokens[2]) } : {};
                const result = createDrawingComparisonClouds(document.content, baseline, incoming, report, options);
                if (result.error) { setMessage(t(`comparison.${['layer', 'invalid'].includes(result.error) ? 'comparisonCloudBounds' : result.error}`)); return; }
                commitDocument({ ...document, content: result.content }, { applyCreationStyles: false });
                cancel(); setSelectedIds(result.selectedIds);
                setMessage(t('comparison.cloudsCreated', { count: result.selectedIds.length }));
            } catch { setMessage(t('comparison.comparisonLimit')); }
            return;
        }
        if (tokens.length === 1 && tokens[0].toUpperCase() === 'REPORT') { show(); return; }
        if (tokens.length === 1 && tokens[0].toUpperCase() === 'CLOSE') {
            session.current = null; present(null); setMessage(t('comparison.closed')); return;
        }
        if (tokens.length && (tokens.length !== 2 || tokens[0].toUpperCase() !== 'FROM' || !tokens[1])) { setMessage(t('comparison.syntax')); return; }
        pending.current = true;
        try {
            const baseline = structuredClone(document);
            const loaded = tokens.length ? await readLcadDocumentAtPath(tokens[1]) : await openLcadDocument({ filterName: t('fileDialog.lcadDrawing') });
            if (!loaded) return;
            if (!latest.current.enabled || latest.current.document.id !== baseline.id
                || compareDrawingDocuments(baseline, latest.current.document).changes.length) throw new Error('comparisonStale');
            const incoming = loaded.envelope.document;
            const report = compareDrawingDocuments(baseline, incoming);
            session.current = { baseline, incoming, report, path: loaded.path || null };
            show(); setMessage(t('comparison.ready', { count: report.changes.length }));
        } catch (error) {
            const key = ['comparisonStale', 'comparisonLimit', 'comparisonInvalid', 'comparisonIdentity'].includes(error.message) ? error.message : 'failed';
            setMessage(t(`comparison.${key}`));
        } finally { pending.current = false; }
    };
    const importChanges = input => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t('block.libraryBusy')); return; }
        if (!session.current) { setMessage(t('comparison.empty')); return; }
        const tokens = tokenizeDrawingAttributeInput(input);
        const indexes = tokens?.length === 1 && tokens[0].toUpperCase() === 'ALL'
            ? session.current.report.changes.map((_, index) => index)
            : tokens?.length && tokens.every(token => /^[1-9]\d*$/.test(token)) ? tokens.map(token => Number(token) - 1) : null;
        if (!indexes) { setMessage(t('comparison.importSyntax')); return; }
        try {
            const result = importDrawingComparison(document, session.current.baseline, session.current.incoming, indexes);
            if (result.error) { setMessage(t(`comparison.${result.error}`)); return; }
            commitDocument(result.document, { applyCreationStyles: false, preserveConstraintSnapshot: true });
            cancel(); setSelectedIds([]);
            // Keep the original numbered snapshot. Reimporting an already changed item rejects as stale.
            setMessage(t('comparison.imported', { count: result.applied }));
        } catch { setMessage(t('comparison.failed')); }
    };
    return { run, importChanges, preview: session.current, getReport: () => session.current ? { path: session.current.path, ...session.current.report } : null };
}
