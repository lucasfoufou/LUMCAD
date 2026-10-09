import useDrawingVectorImport from './useDrawingVectorImport';
import { exportDrawingDxf, importDrawingDxf } from '~utils/drawingDxf';
import { parseDrawingCadInput, readDrawingCadFile, saveDrawingCadFile } from '~utils/drawingCadFiles';

const errors = ['cadSyntax', 'cadDesktop', 'cadDwgDesktop', 'cadLimit', 'cadUnits', 'cadEmpty', 'cadContextChanged',
    'cadUnsupported', 'cadUnsupportedObjects', 'cadEncoding', 'cadConverterMissing', 'cadConversionFailed', 'cadConversionTimeout'];

export default function useDrawingCad(options, format) {
    const { enabled, history, name, setMessage, t, documentId } = options;
    const labelKey = `commands.${format}Import`;
    const imported = useDrawingVectorImport(options, { prefix: 'cad', labelKey, parse: parseDrawingCadInput,
        read: (path, label) => readDrawingCadFile(path, label, format), convert: (...args) => {
            const result = importDrawingDxf(...args);
            if (format === 'dwg') result.report.warnings.push('dwg');
            return result;
        }, errors, summarize: report => [
            ...(report.skipped ? [t('cad.skipped', { count: report.skippedCount, detail: report.skipped })] : []),
            ...(report.paperSpace ? [t('cad.paperSpaceIgnored', { count: report.paperSpace })] : []),
        ] });
    const exportFile = async input => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (imported.pending.current) { setMessage(t('cad.busy')); return; }
        imported.pending.current = true;
        const initial = history.content;
        try {
            const { path } = parseDrawingCadInput(input, true);
            if (!initial.entities.length) throw new Error('cadEmpty');
            const result = exportDrawingDxf(initial, { legacy: format === 'dwg' });
            if (format === 'dwg') result.report.warnings.push('dwg');
            const saved = await saveDrawingCadFile({ text: result.text, path, name, format, label: t(`commands.${format}Export`) });
            if (!saved || !imported.mounted.current || imported.latest.current.documentId !== documentId) return;
            const warnings = result.report.warnings.map(key => t(`cad.warning.${key}`)).join('; ');
            setMessage(t('cad.exported', { count: result.report.exported }) + ` ${t('cad.warnings', { warnings })}`);
        } catch (error) {
            if (imported.mounted.current && imported.latest.current.documentId === documentId) {
                const code = typeof error === 'string' ? error : error.message;
                setMessage(t(`cad.error.${errors.includes(code) ? code : 'cadInvalid'}`));
            }
        } finally { imported.pending.current = false; }
    };
    return { run: imported.run, exportFile };
}
