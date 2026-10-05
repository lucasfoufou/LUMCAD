import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { canEditEntity, DRAWING_LINE_WEIGHT_OPTIONS } from '~utils/drawingDocument';
import { normalizeDrawingPlotStyles, convertDrawingPlotStyles } from '~utils/drawingPlotStyles';

export default function useDrawingPlotStyles({ history, selectedIds, setMessage, setSidebarPanel, enabled, t }) {
    const run = (command, input) => {
        if (!['plotStyle', 'styleManager', 'convertPlotStyles', 'convertColorTable'].includes(command)) return false;
        if (!enabled) { setMessage(t('block.error.closeFirst')); return true; }
        setSidebarPanel('plotStyles');
        if (command === 'styleManager' && !input.trim()) return true;
        const content = history.content;
        const tokens = tokenizeDrawingAttributeInput(input);
        const invalid = () => setMessage(t('plotStyle.invalid'));
        if (!tokens) { invalid(); return true; }
        const styles = normalizeDrawingPlotStyles(content.plotStyles);
        const commit = next => { history.commit(next); setMessage(t('plotStyle.updated')); };
        if (command === 'convertPlotStyles' || command === 'convertColorTable') {
            const mode = command === 'convertColorTable' ? 'named' : (tokens[0] || 'named').toLowerCase();
            if (tokens.length > (command === 'convertColorTable' ? 0 : 1)) { invalid(); return true; }
            const result = convertDrawingPlotStyles(content, mode);
            if (result.error) invalid(); else commit(result.content);
            return true;
        }
        const [action = 'LIST', name, ...args] = tokens;
        const existing = styles.find(style => style.name.toLowerCase() === name?.trim().toLowerCase());
        if (action.toUpperCase() === 'LIST' && tokens.length <= 1) setMessage(t('plotStyle.list', { names: styles.map(style => style.name).join(', ') }));
        else if (action.toUpperCase() === 'SAVE' && name?.trim() && name.length <= 128 && args.length === 5
            && [args[0], args[1]].every(value => value === '-' || /^#[0-9a-f]{6}$/i.test(value))
            && (args[2] === '-' || DRAWING_LINE_WEIGHT_OPTIONS.includes(Number(args[2])))
            && Number.isFinite(Number(args[3])) && Number(args[3]) >= 0 && Number(args[3]) <= 100
            && ['-', 'continuous', 'dashed', 'dotted'].includes(args[4]) && (existing || styles.length < 256)) {
            const style = normalizeDrawingPlotStyles([{ name, sourceColor: args[0], color: args[1], lineWeight: args[2] === '-' ? null : Number(args[2]), screening: Number(args[3]), lineType: args[4] }])[0];
            commit({ ...content, plotStyles: existing ? styles.map(item => item === existing ? style : item) : [...styles, style] });
        } else if (action.toUpperCase() === 'DELETE' && existing && !args.length) commit({ ...content, plotStyles: styles.filter(style => style !== existing) });
        else if (action.toUpperCase() === 'APPLY' && !args.length && (existing || name === '-') && selectedIds.length) {
            const ids = new Set(selectedIds);
            if (content.entities.some(entity => ids.has(entity.id) && !canEditEntity(content, entity))) { invalid(); return true; }
            commit({ ...content, entities: content.entities.map(entity => ids.has(entity.id) ? { ...entity, plotStyleName: existing?.name || null } : entity) });
        } else if (action.toUpperCase() === 'LAYER' && args.length === 1) {
            const layer = content.layers.find(layer => layer.name.toLowerCase() === name?.toLowerCase());
            const style = styles.find(style => style.name.toLowerCase() === args[0]?.toLowerCase());
            if (!layer || layer.locked || !style && args[0] !== '-') invalid();
            else commit({ ...content, layers: content.layers.map(item => item === layer ? { ...item, plotStyleName: style?.name || null } : item) });
        } else invalid();
        return true;
    };
    return { run };
}
