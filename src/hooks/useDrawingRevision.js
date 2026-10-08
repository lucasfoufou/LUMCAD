import { createDrawingRevision, editDrawingRevision } from '~utils/drawingRevisionCommands';

export default function useDrawingRevision({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const report = key => setMessage(t(`revision.${key}`));
    const commit = result => {
        if (result.error) { report(result.error); return false; }
        history.commit(result.content); setSelectedIds(result.selectedIds); setOperation(null); setActiveTool('select'); report('updated'); return true;
    };
    const run = (command, input = '') => {
        if (!['revisionCloud', 'revisionProperties', 'breakLine'].includes(command)) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = input.trim().split(/\s+/).filter(Boolean);
        if (command === 'revisionProperties') {
            const value = Number(tokens[0]);
            if (tokens.length < 1 || tokens.length > 2 || !Number.isFinite(value) || tokens[1] && !['NORMAL', 'REVERSE'].includes(tokens[1].toUpperCase())) report('syntax');
            else commit(editDrawingRevision(history.content, selectedIds, { arcLength: value, ...(tokens[1] ? { reverse: tokens[1].toUpperCase() === 'REVERSE' } : {}) }));
            return true;
        }
        if (command === 'breakLine') {
            const size = tokens.length ? Number(tokens[0]) : 0.5;
            const extension = tokens.length > 1 ? Number(tokens[1]) : size / 2;
            if (tokens.length > 2 || !Number.isFinite(size) || size <= 1e-6 || size > 1e6 || !Number.isFinite(extension) || extension < 0 || extension > 1e6) { report('syntax'); return true; }
            setActiveTool('select'); setOperation({ type: 'revision', kind: 'break', stage: 'points', points: [], size, extension }); report('breakPrompt'); return true;
        }
        const mode = ['RECT', 'POLYGON', 'OBJECT'].includes(tokens[0]?.toUpperCase()) ? tokens.shift().toUpperCase() : 'RECT';
        const arcLength = tokens.length ? Number(tokens.shift()) : 0.5;
        const reverseToken = tokens.shift();
        if (tokens.length || !Number.isFinite(arcLength) || arcLength <= 1e-6 || arcLength > 1e6 || reverseToken && reverseToken.toUpperCase() !== 'REVERSE') { report('syntax'); return true; }
        const options = { kind: 'cloud', arcLength, reverse: Boolean(reverseToken) };
        if (mode === 'OBJECT' && selectedIds.length === 1) commit(createDrawingRevision(history.content, options, selectedIds[0]));
        else { setActiveTool('select'); setOperation({ type: 'revision', ...options, mode, stage: mode === 'OBJECT' ? 'pick' : 'points', points: [] }); report(mode === 'OBJECT' ? 'pickPrompt' : 'cloudPrompt'); }
        return true;
    };
    const point = ({ point, targetId }) => {
        if (operation?.type !== 'revision') return false;
        if (operation.stage === 'pick') {
            if (targetId) commit(createDrawingRevision(history.content, operation, targetId));
            else report('pickPrompt');
            return true;
        }
        const points = [...operation.points, point];
        if (operation.kind === 'break' && points.length === 2) commit(createDrawingRevision(history.content, { ...operation, start: points[0], end: points[1] }));
        else if (operation.mode === 'RECT' && points.length === 2) {
            const [a, b] = points;
            const source = { type: 'polyline', closed: true, points: [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }] };
            commit(createDrawingRevision(history.content, { ...operation, source }));
        } else if (points.length <= 512) setOperation({ ...operation, points });
        else report('invalid');
        return true;
    };
    const input = value => {
        if (operation?.type !== 'revision') return false;
        const option = value.trim().toUpperCase();
        if (option === 'UNDO') { setOperation({ ...operation, points: operation.points.slice(0, -1) }); return true; }
        if (operation.mode === 'POLYGON' && ['', 'CLOSE', 'END'].includes(option)) {
            commit(createDrawingRevision(history.content, { ...operation, source: { type: 'polyline', closed: true, points: operation.points } })); return true;
        }
        return false;
    };
    return { run, point, input };
}
