import { beginDrawingSketch, appendDrawingSketch, commitDrawingSketch } from '~utils/drawingSketch';

export default function useDrawingSketch({ history, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const report = key => setMessage(t(`sketch.${key}`));
    const commit = sketch => {
        const result = commitDrawingSketch(history.content, sketch);
        if (result.error) report(result.error);
        else { history.commit(result.content); setSelectedIds(result.selectedIds); setOperation({ ...operation, sketch: null }); report('prompt'); }
    };
    const run = (command, input = '') => {
        if (command !== 'sketch') return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = input.trim().split(/\s+/).filter(Boolean);
        const increment = tokens.length ? Number(tokens[0]) : 0.01;
        const mode = (tokens[1] || 'polyline').toLowerCase();
        if (tokens.length > 2 || !beginDrawingSketch({ x: 0, y: 0 }, increment, mode)) { report('syntax'); return true; }
        setActiveTool('select'); setOperation({ type: 'sketch', stage: 'record', increment, mode, sketch: null }); report('prompt');
        return true;
    };
    const point = ({ point, sketch }) => {
        if (operation?.type !== 'sketch') return false;
        if (sketch) commit(sketch);
        else if (point) setOperation({ ...operation, sketch: operation.sketch ? appendDrawingSketch(operation.sketch, point) : beginDrawingSketch(point, operation.increment, operation.mode) });
        return true;
    };
    const input = value => {
        if (operation?.type !== 'sketch') return false;
        const option = value.trim().toUpperCase();
        if (['', 'END', 'RECORD'].includes(option)) {
            if (operation.sketch) commit(operation.sketch);
            else { setOperation(null); setActiveTool('select'); }
            return true;
        }
        return false;
    };
    return { run, point, input };
}
