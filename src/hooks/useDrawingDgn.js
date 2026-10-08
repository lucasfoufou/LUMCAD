import useDrawingVectorImport from './useDrawingVectorImport';
import { parseDrawingDgnInput, readDrawingDgnFile } from '~utils/drawingDgnFiles';
import { importDrawingDgn } from '~utils/drawingDgnImport';
import { readDrawingInterchangeSource } from '~utils/drawingInterchangeFiles';
import { drawingDgnDataUrl, DGN_SOURCE_MIME } from '~utils/drawingDgnSource';
import { attachDrawingDgnUnderlay } from '~utils/drawingDgnUnderlay';
import { canEditEntity, createDrawingId, updateSelectedEntities } from '~utils/drawingDocument';
import { parseDrawingBlockClipInput } from '~utils/drawingBlockClip';
import { createLcadArchive } from '~utils/lcadArchive';
import { createLcadEnvelope } from '~utils/lcadDocument';

const config = { prefix: 'dgn', labelKey: 'commands.dgnImport', parse: parseDrawingDgnInput,
    read: readDrawingDgnFile, convert: importDrawingDgn,
    errors: ['dgnSyntax', 'dgnDesktop', 'dgnLimit', 'dgnLayer', 'dgnEmpty', 'dgnContextChanged', 'dgnPlacement', 'dgnUnits', 'dgnUnsupported'] };

export default function useDrawingDgn(options) {
    const imported = useDrawingVectorImport(options, config);
    const attached = useDrawingVectorImport(options, { ...config, labelKey: 'commands.dgnAttach',
        read: (path, label) => readDrawingInterchangeSource(path, label, 'dgn'),
        convert: (document, source, placement) => {
            const asset = { id: createDrawingId('asset'), name: source.name, mimeType: DGN_SOURCE_MIME,
                width: 1, height: 1, link: drawingDgnDataUrl(source.bytes) };
            const result = attachDrawingDgnUnderlay(document, asset, placement);
            createLcadArchive(createLcadEnvelope(result));
            return { ...result, report: { ...result.report, imported: 1 } };
        } });
    const clip = input => {
        const { enabled, history, selectedIds, setMessage, t } = options;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        const target = selectedIds.length === 1 && history.content.entities.find(entity => entity.id === selectedIds[0] && entity.dgnUnderlay);
        if (!target || !canEditEntity(history.content, target)) { setMessage(t('dgn.error.selection')); return; }
        const patch = parseDrawingBlockClipInput(input, target.blockClip);
        if (!patch) { setMessage(t('dgn.error.clipSyntax')); return; }
        history.commit(updateSelectedEntities(history.content, [target.id], entity => ({ ...entity, ...patch })));
        setMessage(t('dgn.updated'));
    };
    return { ...imported, attach: attached.run, clip };
}
