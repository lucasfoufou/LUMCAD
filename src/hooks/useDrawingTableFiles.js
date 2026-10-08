import { useRef } from 'react';
import { canEditEntity } from '~utils/drawingDocument';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { parseDrawingTableImport, prepareDrawingTableExport } from '~utils/drawingTableCommands';
import { importDrawingTableCsv } from '~utils/drawingTableImport';
import { exportDrawingText } from '~utils/drawingTextExport';
import { updateDrawingTableLinks } from '~utils/drawingTableLinks';
import { isTauriRuntime } from '~utils/lcadStorage';

export default function useDrawingTableFiles({ documentId, filePath, history, selectedIds, enabled, setSelectedIds, setOperation, setActiveTool, cancel, setMessage, t }) {
    const pending = useRef(false);
    const latest = useRef(null);
    latest.current = { documentId, history, enabled };
    const handles = (command, input) => ['tableExport', 'dataLink', 'dataLinkUpdate'].includes(command)
        || command === 'table' && /^CSV(?:\s|$)/i.test(input.trim());
    const run = async (command, input) => {
        if (!enabled) { setMessage(t('namedView.modelRequired')); return; }
        if (pending.current) { setMessage(t('table.fileBusy')); return; }
        pending.current = true;
        const initialContent = history.content;
        const current = () => {
            const value = latest.current;
            if (!value.enabled || value.documentId !== documentId || value.history.content !== initialContent) throw new Error('contextChanged');
            return value.history;
        };
        const report = key => setMessage(t(`table.${key}`));
        const finish = updates => {
            const live = current();
            const result = updateDrawingTableLinks(live.content, updates);
            if (result.error) throw new Error(result.error);
            live.commit(result.content); cancel(); setOperation(null); setActiveTool('select'); setSelectedIds(result.selectedIds); report('updated');
        };
        try {
            if (command === 'tableExport') {
                const result = prepareDrawingTableExport(initialContent, selectedIds, input);
                if (result.error) throw new Error(result.error);
                if (await exportDrawingText({ ...result, filterName: t('commands.tableExport') })) report('exported');
                return;
            }
            if (command === 'table') {
                const options = parseDrawingTableImport(input);
                if (!options) throw new Error('importSyntax');
                const table = await importDrawingTableCsv(options, t('commands.table'));
                if (table) { current(); cancel(); setActiveTool('select'); setOperation({ type: 'table', stage: 'point', table }); report('pointPrompt'); }
                return;
            }
            const tokens = tokenizeDrawingAttributeInput(input);
            if (!tokens) throw new Error('linkSyntax');
            const action = command === 'dataLinkUpdate' ? 'UPDATE' : (tokens.shift() || 'LIST').toUpperCase();
            const all = action === 'UPDATE' && tokens.length === 1 && tokens[0].toUpperCase() === 'ALL';
            if (action === 'LIST' && !tokens.length) {
                const linked = initialContent.entities.filter(entity => entity.table?.dataLink);
                setMessage(linked.length ? linked.map(entity => `${entity.id}: ${entity.table.dataLink.name} (${entity.table.dataLink.path || t('table.browserLink')})`).join('\n') : t('table.noLinks'));
                return;
            }
            if (!['ATTACH', 'DETACH', 'UPDATE'].includes(action) || action !== 'ATTACH' && tokens.length && !all) throw new Error('linkSyntax');
            const targets = all ? initialContent.entities.filter(entity => entity.table?.dataLink)
                : selectedIds.map(id => initialContent.entities.find(entity => entity.id === id));
            if (!targets.length || targets.some(entity => !entity?.table || !canEditEntity(initialContent, entity))
                || action === 'ATTACH' && targets.length !== 1 || action === 'UPDATE' && targets.some(entity => !entity.table.dataLink)) throw new Error('linkSelection');
            if (action === 'DETACH') { finish(targets.map(entity => ({ id: entity.id, detach: true }))); return; }
            if (action === 'ATTACH') {
                const options = parseDrawingTableImport(`CSV ${tokens.map(token => JSON.stringify(token)).join(' ')}`);
                if (!options) throw new Error('linkSyntax');
                const table = await importDrawingTableCsv({ ...options, linked: true }, t('commands.dataLink'));
                if (table) finish([{ id: targets[0].id, table }]);
                return;
            }
            const loaded = new Map(); const updates = [];
            for (const entity of targets) {
                const link = entity.table.dataLink;
                const key = JSON.stringify(link);
                if (!loaded.has(key)) {
                    const table = await importDrawingTableCsv({ ...link, path: isTauriRuntime() ? link.path : null, documentPath: filePath, linked: true }, t('commands.dataLink'));
                    if (!table) return;
                    current(); loaded.set(key, table);
                }
                updates.push({ id: entity.id, table: loaded.get(key) });
            }
            finish(updates);
        } catch (error) {
            const errors = ['exportSelection', 'exportSyntax', 'importSyntax', 'linkSyntax', 'linkSelection', 'invalid', 'contextChanged'];
            if (error.message === 'attributeExtractionDesktop') setMessage(t('attribute.error.attributeExtractionDesktop'));
            else report(errors.includes(error.message) ? error.message : command === 'tableExport' ? 'exportFailed' : 'importInvalid');
        } finally { pending.current = false; }
    };
    return { handles, run };
}
