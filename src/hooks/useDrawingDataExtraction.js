import { createDrawingId } from '~utils/drawingDocument';
import { isTauriRuntime } from '~utils/lcadStorage';
import { createDrawingSpreadsheet } from '~utils/drawingSpreadsheetExport';
import { useRef } from 'react';
import { manageDrawingDataDefinition, parseDrawingDataInput, prepareDrawingDataReport, serializeDrawingDataReport, drawingDataReportCells, insertDrawingDataTable } from '~utils/drawingDataCommands';
import { exportDrawingText } from '~utils/drawingTextExport';

export default function useDrawingDataExtraction({ documentId, history, selectedIds, enabled, setSelectedIds, cancel, setMessage, t }) {
    const pending = useRef(false);
    const lastReport = useRef(null);
    const latest = useRef(documentId);
    if (latest.current !== documentId) { latest.current = documentId; lastReport.current = null; }
    const handles = command => ['dataExtract', 'countList', 'countTable'].includes(command);
    const run = async (command, input) => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t('table.fileBusy')); return; }
        const definition = command === 'dataExtract' ? manageDrawingDataDefinition(history.content, selectedIds, input) : null;
        if (definition?.error) { setMessage(t(`dataExtraction.${definition.error}`)); return; }
        if (definition?.content) { history.commit(definition.content); setMessage(t('dataExtraction.definitionSaved')); return; }
        if (definition?.definitions) {
            setMessage(definition.definitions.map(item => item.name).join('\n') || t('dataExtraction.noDefinitions')); return;
        }
        const options = definition?.options || parseDrawingDataInput(input, command);
        if (!options) { setMessage(t('dataExtraction.syntax')); return; }
        pending.current = true;
        try {
            const queryIds = definition?.selectedIds || selectedIds;
            const source = options.linked ? { ...history.content, entities: history.content.entities.filter(entity => !entity.table) } : history.content;
            const report = prepareDrawingDataReport(source, queryIds, options);
            lastReport.current = report;
            if (options.action === 'TABLE') {
                const result = insertDrawingDataTable(history.content, report, options.point, { quantityDefinition: options.linked ? {
                    id: createDrawingId('quantity'), name: t('commands.countTable'), nested: options.nested,
                    groupBy: options.groupBy, sums: options.sums, selectedIds: options.selected ? [...queryIds] : null,
                } : null, label: key => key.startsWith('attribute:')
                    ? t('dataExtraction.field.attribute', { tag: key.slice(10) }) : t(`dataExtraction.field.${key}`) });
                if (result.error) throw new Error(result.error);
                cancel(); history.commit(result.content); setSelectedIds(result.selectedIds);
                setMessage(t('dataExtraction.inserted'));
            } else if (['CSV', 'JSON', 'XLS'].includes(options.action)) {
                const bytes = options.action === 'XLS' ? await createDrawingSpreadsheet(drawingDataReportCells(report)) : null;
                const text = bytes ? null : serializeDrawingDataReport(report, options.action);
                if (latest.current !== documentId) return;
                const saved = await exportDrawingText({ text, bytes, format: options.action.toLowerCase(), path: options.path,
                    name: 'quantities', filterName: t('commands.dataExtract') });
                if (saved && latest.current === documentId) setMessage(t(isTauriRuntime() ? 'dataExtraction.exported' : 'dataExtraction.downloadStarted'));
            } else {
                setMessage(t('dataExtraction.report', { groups: report.rows.length, count: report.rows.reduce((sum, row) => sum + row.count, 0) })
                    + '\n' + report.rows.slice(0, 30).map(row => `${row.values.map(value => value ?? '—').join(' / ')}: ${row.count}`).join('\n'));
            }
        } catch (error) {
            if (latest.current !== documentId) return;
            const key = ['dataExtractionFields', 'dataExtractionLimit', 'dataExtractionDependency', 'dataExtractionEmpty', 'attributeExtractionDesktop', 'layer'].includes(error.message)
                ? error.message : 'failed';
            setMessage(t(`dataExtraction.${key}`));
        } finally { pending.current = false; }
    };
    return { handles, run, getReport: () => lastReport.current };
}
