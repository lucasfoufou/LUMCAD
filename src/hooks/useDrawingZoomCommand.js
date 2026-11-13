import { drawingZoomWindowBounds, parseDrawingZoomInput } from '~utils/drawingZoomCommand';

// ZOOM [E|A|W|factor]: without an argument the next two picked points define a
// window, and Extents, Window or a factor can still be typed at the prompt.
export default function useDrawingZoomCommand({ canvasRef, operation, setOperation, setMessage, submitPoint, enabled, locale = 'en', t }) {
    const apply = (parsed, { keepPrompt = false } = {}) => {
        if (parsed.action === 'extents') {
            canvasRef.current?.fit();
            setOperation(null);
            setMessage(t('zoom.extentsDone'));
        } else if (parsed.action === 'factor') {
            canvasRef.current?.zoom(1 / parsed.factor);
            setOperation(null);
            setMessage(t('zoom.factorDone', { factor: new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(parsed.factor) }));
        } else {
            setOperation({ type: 'zoom', stage: 'zoom-first', first: null });
            setMessage(t(parsed.action === 'window' || keepPrompt ? 'zoom.windowFirstPrompt' : 'zoom.prompt'));
        }
    };
    const run = (command, input) => {
        if (command !== 'zoom') return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const parsed = parseDrawingZoomInput(input);
        if (!parsed) { setMessage(t('zoom.syntax')); return true; }
        apply(parsed);
        return true;
    };
    const point = ({ point: picked }) => {
        if (operation?.type !== 'zoom') return false;
        if (!picked) return true;
        if (!operation.first) {
            setOperation({ ...operation, stage: 'zoom-second', first: { x: picked.x, y: picked.y } });
            setMessage(t('zoom.windowSecondPrompt'));
            return true;
        }
        const bounds = drawingZoomWindowBounds(operation.first, picked);
        if (!bounds) { setMessage(t('zoom.windowSecondPrompt')); return true; }
        canvasRef.current?.fitObjects([], bounds);
        setOperation(null);
        setMessage(t('zoom.windowDone'));
        return true;
    };
    const input = value => {
        if (operation?.type !== 'zoom') return false;
        const parsed = parseDrawingZoomInput(value);
        if (!String(value ?? '').trim()) { setOperation(null); setMessage(''); return true; }
        if (!parsed) {
            if (!submitPoint?.(value)) setMessage(t('zoom.syntax'));
            return true;
        }
        apply(parsed, { keepPrompt: true });
        return true;
    };
    return { run, point, input };
}
