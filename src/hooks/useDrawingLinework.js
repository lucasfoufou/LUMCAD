import { appendDrawingLineworkVertex, finishDrawingLineworkDefinition } from '~utils/drawingLinework';
import { createDrawingLinework, editDrawingLinework, parseDrawingLineworkEdit, parseMultilineCreation, runDrawingMultilineStyle } from '~utils/drawingLineworkCommands';

export default function useDrawingLinework({ history, selectedIds, setSelectedIds, operation, setOperation, setActiveTool, setMessage, enabled, t }) {
    const report = key => setMessage(t(`linework.${key}`));
    const commit = result => {
        if (result.error) { report(result.error); return false; }
        history.commit(result.content);
        if (result.selectedIds) setSelectedIds(result.selectedIds);
        report('updated');
        return true;
    };
    const run = (command, input = '') => {
        if (!['donut', 'multilineEdit', 'multiline', 'multilineStyle', 'widePolyline'].includes(command)) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        if (command === 'widePolyline') {
            const width = input.trim() ? parseDrawingLineworkEdit(`WIDTH ${input}`) : { start: 0, end: 0 };
            if (!width || width.segment !== undefined || width.start > 1e6 || width.end > 1e6) report('widthPrompt');
            else {
                setActiveTool('select');
                setOperation({ type: 'linework', kind: 'wide', stage: 'vertices', points: [], widths: [], bulges: [], nextBulge: 0, nextWidth: { start: width.start, end: width.end } });
                report('widePrompt');
            }
            return true;
        }
        if (command === 'multilineStyle') {
            const result = runDrawingMultilineStyle(history.content, input);
            if (result.names) setMessage(result.names.join(', '));
            else commit(result);
            return true;
        }
        if (command === 'multiline') {
            const options = parseMultilineCreation(input, history.content.multilineStyles);
            if (!options) report('multilineSyntax');
            else {
                setActiveTool('select');
                setOperation({ type: 'linework', kind: 'multiline', stage: 'vertices', points: [], ...options });
                report('verticesPrompt');
            }
            return true;
        }
        if (command === 'multilineEdit') {
            const edit = parseDrawingLineworkEdit(input);
            if (!edit) report('editSyntax');
            else commit(editDrawingLinework(history.content, selectedIds, edit));
            return true;
        }
        const values = input.trim() ? input.trim().split(/\s+/).map(Number) : [];
        if (values.length && (values.length !== 2 || !values.every(Number.isFinite) || values[0] < 0 || values[1] <= values[0] || values[1] > 1e6)) {
            report('diametersPrompt'); return true;
        }
        setActiveTool('select');
        setOperation({ type: 'linework', kind: 'donut', stage: values.length ? 'center' : 'diameters', innerDiameter: values[0], outerDiameter: values[1] });
        report(values.length ? 'centerPrompt' : 'diametersPrompt');
        return true;
    };
    const point = ({ point }) => {
        if (operation?.type !== 'linework') return false;
        if (operation.stage === 'vertices') {
            const next = appendDrawingLineworkVertex(operation, point);
            if (!next) report('invalid');
            else { setOperation(next); report(operation.kind === 'wide' ? 'widePrompt' : 'verticesPrompt'); }
            return true;
        }
        if (operation.stage !== 'center') { report('diametersPrompt'); return true; }
        commit(createDrawingLinework(history.content, [{ kind: 'donut', innerDiameter: operation.innerDiameter, outerDiameter: operation.outerDiameter,
            transform: { a: 1, b: 0, c: 0, d: 1, e: point.x, f: point.y } }]));
        return true;
    };
    const input = value => {
        if (operation?.type !== 'linework') return false;
        if (operation.stage === 'vertices') {
            const option = value.trim().toUpperCase();
            if (operation.kind === 'wide' && (option === 'LINE' || option.startsWith('ARC'))) {
                const tokens = option.split(/\s+/);
                const angle = tokens.length === 2 ? Number(tokens[1]) : NaN;
                if (option === 'LINE') setOperation({ ...operation, nextBulge: 0 });
                else if (tokens[0] === 'ARC' && Number.isFinite(angle) && Math.abs(angle) >= 0.001 && Math.abs(angle) <= 359) {
                    setOperation({ ...operation, nextBulge: Math.tan(angle * Math.PI / 720) });
                } else report('arcPrompt');
                return true;
            }
            if (option.startsWith('WIDTH') && operation.kind === 'wide') {
                const width = parseDrawingLineworkEdit(value);
                if (!width || width.action !== 'width' || width.segment !== undefined || width.start > 1e6 || width.end > 1e6) report('widthPrompt');
                else { setOperation({ ...operation, nextWidth: { start: width.start, end: width.end } }); report('widePrompt'); }
                return true;
            }
            if (option === 'UNDO') {
                setOperation({ ...operation, points: operation.points.slice(0, -1),
                    ...(operation.kind === 'wide' ? { widths: operation.widths.slice(0, Math.max(0, operation.widths.length - 1)), bulges: operation.bulges.slice(0, Math.max(0, operation.bulges.length - 1)) } : {}) });
                return true;
            }
            if (['', 'END', 'CLOSE'].includes(option)) {
                if (commit(createDrawingLinework(history.content, [finishDrawingLineworkDefinition(operation, option === 'CLOSE')]))) {
                    setOperation(null); setActiveTool('select');
                }
                return true;
            }
        }
        if (operation.stage === 'diameters') return run('donut', value);
        // Coordinate text is handled by the editor's shared UCS-aware point parser.
        return false;
    };
    return { run, point, input };
}
