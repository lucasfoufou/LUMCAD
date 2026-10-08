import { exportDrawingWmfWithAssets } from '~utils/drawingWmfExport';
import { exportDrawingWmfRaster } from '~utils/drawingWmfRasterExport';
import useDrawingRasterExport from './useDrawingRasterExport';
import useDrawingVectorImport from './useDrawingVectorImport';
import { parseDrawingWmfInput, readDrawingWmfFile, parseDrawingWmfExportInput, saveDrawingWmfFile } from '~utils/drawingWmfFiles';
import { importDrawingWmf } from '~utils/drawingWmfImport';

export default function useDrawingWmf({ documentId, name = 'drawing', locale = 'en', assets, setAssets, history, enabled, setSelectedIds, cancel, setMessage, t }) {
    const { run, pending, mounted, latest } = useDrawingVectorImport(
        { documentId, assets, setAssets, history, enabled, setSelectedIds, cancel, setMessage, t },
        { prefix: 'wmf', labelKey: 'commands.wmfImport', parse: parseDrawingWmfInput, read: readDrawingWmfFile,
            convert: importDrawingWmf, errors: ['wmfSyntax', 'wmfDesktop', 'wmfLimit', 'wmfLayer', 'wmfEmpty', 'wmfContextChanged', 'wmfPlacement'] });
    const raster = useDrawingRasterExport();
    const exportFile = async input => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t('wmf.busy')); return; }
        pending.current = true;
        try {
            const options = parseDrawingWmfExportInput(input);
            const result = options.mode === 'raster'
                ? await exportDrawingWmfRaster(await raster.render({ content: history.content, assets }, options))
                : await exportDrawingWmfWithAssets(history.content, assets, { locale });
            if (!mounted.current || latest.current.documentId !== documentId || !latest.current.enabled) return;
            const saved = await saveDrawingWmfFile({ ...options, bytes: result.bytes, name }, t('commands.wmfExport'));
            if (!saved || !mounted.current || latest.current.documentId !== documentId) return;
            const warnings = result.report.warnings.map(key => t(`wmf.exportWarning.${key}`)).join('; ');
            const summary = result.report.raster ? t('wmf.rasterExported', result.report.raster)
                : t('wmf.exported', { count: result.report.exported, x: result.report.origin.x, y: result.report.origin.y });
            setMessage(summary
                + (warnings ? ` ${t('wmf.warnings', { warnings })}` : ''));
        } catch (error) {
            if (mounted.current && latest.current.documentId === documentId) {
                const key = ['wmfExportSyntax', 'wmfDesktop', 'wmfLimit', 'wmfEmpty', 'wmfPlacement',
                    'wmfExportUnsupported', 'wmfExportTransparency', 'wmfUnsupportedCharset', 'wmfExportBlockCycle', 'wmfExportMissingBlock'].includes(error.message)
                    ? error.message : 'failed';
                setMessage(t(`wmf.exportError.${key}`));
            }
        } finally { pending.current = false; }
    };
    return { run, exportFile, renderRequest: raster.request };
}
