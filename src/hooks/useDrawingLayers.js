import { useRef, useState } from 'react';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { drawingLayerSnapshot, normalizeDrawingLayerStates, saveDrawingLayerState, restoreDrawingLayerState, mergeDrawingLayers } from '~utils/drawingLayers';

const COMMANDS = new Set(['layerState', 'layerStateSave', 'layerIsolate', 'layerUnisolate', 'layerWalk', 'layerMerge', 'layerTranslate', 'layerFilter', 'layerFlags']);

export default function useDrawingLayers({ history, selectedIds, setMessage, setSidebarPanel, enabled, t }) {
    const isolation = useRef(null);
    const [filter, setFilter] = useState('');
    const run = (command, input) => {
        if (!COMMANDS.has(command)) return false;
        if (!enabled) { setMessage(t('block.error.closeFirst')); return true; }
        const content = history.content;
        const tokens = tokenizeDrawingAttributeInput(input);
        const invalid = () => setMessage(t('layerManager.invalid'));
        if (!tokens) { invalid(); return true; }
        const layer = name => content.layers.find(item => item.id === name || item.name.toLowerCase() === name?.toLowerCase());
        const finish = result => {
            if (result.error) { invalid(); return; }
            if (result.layouts) history.commitDocument(current => ({ ...current, content: result.content, layouts: result.layouts }));
            else history.commit(result.content);
            setMessage(t('layerManager.updated'));
        };
        if (command === 'layerFilter') { setFilter(input.trim()); setSidebarPanel('layers'); return true; }
        if (command === 'layerFlags') {
            const target = layer(tokens[0]); const field = { FREEZE: 'frozen', NEWVPFREEZE: 'newViewportFrozen', PLOT: 'plot', LOCK: 'locked', VISIBLE: 'visible' }[tokens[1]?.toUpperCase()];
            if (!target || !field || tokens.length !== 3 || !['ON', 'OFF'].includes(tokens[2].toUpperCase())) invalid();
            else finish({ content: { ...content, layers: content.layers.map(item => item.id === target.id ? { ...item, [field]: tokens[2].toUpperCase() === 'ON' } : item) } });
        } else if (command === 'layerMerge' || command === 'layerTranslate') {
            if (tokens.length < 2 || command === 'layerTranslate' && tokens.length % 2) { invalid(); return true; }
            let next = content; let layouts = history.layouts;
            const pairs = command === 'layerMerge' ? tokens.slice(0, -1).map(name => [name, tokens.at(-1)])
                : Array.from({ length: tokens.length / 2 }, (_, i) => tokens.slice(i * 2, i * 2 + 2));
            const sources = new Set();
            for (const [source, target] of pairs) {
                const from = layer(source); const to = layer(target);
                if (!from || !to || sources.has(from.id)) { invalid(); return true; }
                sources.add(from.id);
                const result = mergeDrawingLayers(next, [from.id], to.id, layouts);
                if (result.error) { invalid(); return true; }
                next = result.content; layouts = result.layouts;
            }
            finish({ content: next, layouts });
        } else if (['layerIsolate', 'layerUnisolate', 'layerWalk'].includes(command)) {
            if (command === 'layerUnisolate' || command === 'layerWalk' && tokens[0]?.toUpperCase() === 'END') {
                if (!isolation.current) { invalid(); return true; }
                finish(restoreDrawingLayerState(content, isolation.current)); isolation.current = null;
            } else {
                const selectedIdSet = new Set(selectedIds);
                const ids = tokens.length ? tokens.map(name => layer(name)?.id) : [...new Set(content.entities.filter(entity => selectedIdSet.has(entity.id)).map(entity => entity.layerId))];
                if (!ids.length || ids.some(id => !id)) { invalid(); return true; }
                if (!isolation.current) isolation.current = { name: 'Isolation', activeLayerId: content.activeLayerId, layers: content.layers.map(drawingLayerSnapshot) };
                finish({ content: { ...content, layers: content.layers.map(item => ({ ...item, visible: ids.includes(item.id), frozen: ids.includes(item.id) ? false : item.frozen })) } });
            }
        } else {
            const [action, name] = command === 'layerStateSave' ? ['SAVE', tokens[0]] : [tokens[0]?.toUpperCase() || 'LIST', tokens[1]];
            const states = normalizeDrawingLayerStates(content.layerStates);
            const existing = states.find(state => state.name.toLowerCase() === name?.trim().toLowerCase());
            if (action === 'LIST' && tokens.length <= 1) setMessage(t('layerManager.states', { names: states.map(state => state.name).join(', ') }));
            else if (tokens.length === (command === 'layerStateSave' ? 1 : 2)) {
                if (action === 'SAVE') finish(saveDrawingLayerState(content, name));
                else if (existing && action === 'RESTORE') finish(restoreDrawingLayerState(content, existing));
                else if (existing && action === 'DELETE') finish({ content: { ...content, layerStates: states.filter(state => state !== existing) } });
                else invalid();
            } else invalid();
        }
        return true;
    };
    return { run, filter, setFilter };
}
