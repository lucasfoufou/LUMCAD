import { useCallback } from 'react';

import useLatestRef from '~hooks/useLatestRef';
import { getDrawingCommandInput } from '~utils/drawingCommands';
import {
    getDrawingImportExtensions,
    resolveDrawingExportFormat,
    resolveDrawingImportFormat,
} from '~utils/drawingFileFormats';
import { withPreselectedDrawingFile } from '~utils/drawingFileSelection';
import { chooseBrowserFile, getLcadPathLabel, isTauriRuntime } from '~utils/lcadStorage';
import { open } from '~utils/nativeDialogs';

/**
 * IMPORT and EXPORT: choose a file or a format once, then run the existing
 * command for it (DWGIN, DXFIN, PNGOUT...). `runCommand` submits a command
 * line; `importImageFile` takes a browser File for the local image import.
 */
export default function useDrawingFileTransfer({ runCommand, importImageFile, onChooseExport, setMessage, t }) {
    const latest = useLatestRef({ runCommand, importImageFile, onChooseExport, setMessage, t });

    const importFile = useCallback(async (input = '') => {
        const { runCommand: run, importImageFile: importImage, setMessage: report, t: translate } = latest.current;
        const desktop = isTauriRuntime();
        const path = getDrawingCommandInput(`IMPORT ${input}`).replace(/^"(.*)"$/, '$1').trim();
        let selection = null;
        if (path) {
            if (!desktop) { report(translate('import.pathDesktop')); return; }
            selection = { kind: 'path', value: path, name: getLcadPathLabel(path) };
        } else if (desktop) {
            const chosen = await open({ multiple: false, directory: false, filters: [
                { name: translate('fileDialog.importable'), extensions: getDrawingImportExtensions() },
            ] });
            if (chosen) selection = { kind: 'path', value: chosen, name: getLcadPathLabel(chosen) };
        } else {
            const accept = getDrawingImportExtensions({ desktop: false }).map(extension => `.${extension}`).join(',');
            const file = await chooseBrowserFile({ accept: `${accept},.dwg` });
            if (file) selection = { kind: 'file', value: file, name: file.name };
        }
        if (!selection) { report(translate('import.cancelled')); return; }
        const format = resolveDrawingImportFormat(selection.name);
        if (!format) { report(translate('import.unsupported', { name: selection.name })); return; }
        if (format.desktopOnly && !desktop) { report(translate('cad.error.cadDwgDesktop')); return; }
        if (format.id === 'image' && !desktop) {
            await importImage({ target: { files: [selection.value], value: '' } });
            return;
        }
        await withPreselectedDrawingFile(selection, () => run(format.command));
    }, [latest]);

    const exportFile = useCallback(async (input = '') => {
        const { runCommand: run, onChooseExport: chooseExport, setMessage: report, t: translate } = latest.current;
        const format = resolveDrawingExportFormat(String(input).trim().split(/\s+/)[0]);
        if (!format) {
            report(translate('export.chooseFormat'));
            chooseExport?.();
            return;
        }
        if (format.desktopOnly && !isTauriRuntime()) { report(translate('cad.error.cadDwgDesktop')); return; }
        await run(format.command);
    }, [latest]);

    return { importFile, exportFile };
}
