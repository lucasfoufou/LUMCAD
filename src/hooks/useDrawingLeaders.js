import { useState } from 'react';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { createDrawingLeader, updateDrawingLeader, alignDrawingLeaders, collectDrawingLeaders, drawingLeaderLocalPoint, normalizeDrawingLeaderStyle, normalizeDrawingLeaderStyles, DEFAULT_LEADER_STYLE } from '~utils/drawingLeaders';

const COMMANDS = new Set(['leader', 'multiLeaderEdit', 'multiLeaderAlign', 'multiLeaderCollect', 'multiLeaderStyle']);

export default function useDrawingLeaders({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, blockEditing, t }) {
    const [style, setStyle] = useState(DEFAULT_LEADER_STYLE);
    const content = history.content;
    const finish = result => {
        if (result.error) { setMessage(t('leader.invalid')); return; }
        history.commit(result.content); setSelectedIds(result.selectedIds); setOperation(null); setMessage(t('leader.updated'));
    };
    const selected = () => selectedIds.length === 1 && content.entities.find(entity => entity.id === selectedIds[0] && entity.leader);
    const start = state => { setActiveTool('select'); setOperation({ type: 'leaderCreation', points: [], ...state }); setMessage(t('leader.pointPrompt')); };
    const point = point => {
        if (operation?.type !== 'leaderCreation') return false;
        if (!point) return true;
        if (operation.stage === 'anchor') {
            finish(createDrawingLeader(content, [operation.points], point, { text: operation.text, blockId: operation.blockId, style }));
        } else if (operation.stage === 'branch' && operation.points.length === 1) {
            const reference = content.entities.find(entity => entity.id === operation.referenceId);
            if (!reference) { setMessage(t('leader.invalid')); return true; }
            const branch = [...operation.points, point].map(p => drawingLeaderLocalPoint(reference, p));
            finish(updateDrawingLeader(content, reference.id, { branches: [...reference.leader.branches, branch] }));
        } else if (operation.points.length < 128) {
            const points = [...operation.points, point];
            setOperation({ ...operation, points }); setMessage(t(points.length >= 2 ? 'leader.donePrompt' : 'leader.pointPrompt'));
        }
        return true;
    };
    const input = value => {
        if (operation?.type !== 'leaderCreation') return false;
        const option = value.trim().toUpperCase();
        if (option === 'UNDO') { setOperation({ ...operation, points: operation.points.slice(0, -1) }); return true; }
        if ((!option || option === 'DONE') && operation.stage === 'points' && operation.points.length >= 2) {
            setOperation({ ...operation, stage: 'anchor' }); setMessage(t('leader.anchorPrompt')); return true;
        }
        return false;
    };
    const run = (command, input) => {
        if (!COMMANDS.has(command)) return false;
        if (blockEditing || !enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens) { setMessage(t('leader.invalid')); return true; }
        const invalid = () => setMessage(t('leader.invalid'));
        const reference = selected();
        if (command === 'leader') {
            let blockId = null; let text = '';
            if (tokens[0]?.toUpperCase() === 'BLOCK' && tokens.length === 2) {
                blockId = content.blocks.find(block => block.name.toLowerCase() === tokens[1].toLowerCase())?.id;
                if (!blockId) { invalid(); return true; }
            } else text = tokens.join(' ').replaceAll('\\n', '\n');
            start({ stage: 'points', text, blockId });
        } else if (command === 'multiLeaderEdit') {
            if (!reference) { invalid(); return true; }
            const [action, ...args] = tokens;
            switch (action?.toUpperCase()) {
            case 'TEXT': finish(updateDrawingLeader(content, reference.id, { text: args.join(' ').replaceAll('\\n', '\n') })); break;
            case 'BLOCK': {
                const block = args.length === 1 && content.blocks.find(block => block.name.toLowerCase() === args[0].toLowerCase());
                if (block) finish(updateDrawingLeader(content, reference.id, { blockId: block.id })); else invalid();
                break;
            }
            case 'ADD': if (!args.length) start({ stage: 'branch', referenceId: reference.id }); else invalid(); break;
            case 'REMOVE': {
                const index = Number(args[0]) - 1;
                if (args.length === 1 && Number.isInteger(index) && index >= 0 && index < reference.leader.branches.length && reference.leader.branches.length > 1)
                    finish(updateDrawingLeader(content, reference.id, { branches: reference.leader.branches.filter((_, i) => i !== index) }));
                else invalid();
                break;
            }
            default: invalid();
            }
        } else if (command === 'multiLeaderAlign') {
            if (tokens.length <= 2) finish(alignDrawingLeaders(content, selectedIds, tokens[0]?.toUpperCase() || 'X', tokens.length === 2 ? Number(tokens[1]) : null)); else invalid();
        } else if (command === 'multiLeaderCollect') {
            if (tokens.length <= 1) finish(collectDrawingLeaders(content, selectedIds, tokens.length ? Number(tokens[0]) : 0.5)); else invalid();
        } else {
            const [action = 'LIST', name, ...args] = tokens;
            const styles = normalizeDrawingLeaderStyles(content.leaderStyles);
            const existing = styles.find(item => item.name.toLowerCase() === name?.trim().toLowerCase());
            if (action.toUpperCase() === 'LIST' && tokens.length <= 1) setMessage(t('leader.styles', { names: styles.map(item => item.name).join(', ') }));
            else if (action.toUpperCase() === 'SAVE' && name?.trim() && name.length <= 128 && args.length === 4 && args.slice(0, 3).every(value => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 10000) && Number(args[0]) >= 0.01 && ['closed', 'open', 'none'].includes(args[3].toLowerCase()) && (existing || styles.length < 128)) {
                const next = { name: name.trim(), ...normalizeDrawingLeaderStyle({ textSize: Number(args[0]), arrowSize: Number(args[1]), landingLength: Number(args[2]), arrowType: args[3].toLowerCase() }) };
                history.commit({ ...content, leaderStyles: existing ? styles.map(item => item === existing ? next : item) : [...styles, next] });
                setStyle(next); setMessage(t('leader.updated'));
            } else if (action.toUpperCase() === 'USE' && existing && !args.length) { setStyle(existing); setMessage(t('leader.updated')); }
            else if (action.toUpperCase() === 'DELETE' && existing && !args.length) { history.commit({ ...content, leaderStyles: styles.filter(item => item !== existing) }); setMessage(t('leader.updated')); }
            else if (action.toUpperCase() === 'APPLY' && existing && !args.length && selectedIds.length) {
                let next = content;
                for (const id of selectedIds) { const result = updateDrawingLeader(next, id, { style: existing }); if (result.error) { invalid(); return true; } next = result.content; }
                finish({ content: next, selectedIds });
            } else invalid();
        }
        return true;
    };
    return { run, point, input };
}
