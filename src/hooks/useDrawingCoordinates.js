import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { DRAWING_UNITS, normalizeDrawingUnits, normalizeDrawingUcs, normalizeDrawingNamedUcs, normalizeDrawingLimits } from '~utils/drawingCoordinates';

export default function useDrawingCoordinates({ history, setMessage, enabled, t }) {
    const run = (command, input) => {
        if (!['drawingUnits', 'ucs', 'ucsIcon', 'drawingLimits'].includes(command)) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const content = history.content;
        const tokens = tokenizeDrawingAttributeInput(input);
        const invalid = () => setMessage(t('coordinates.invalid'));
        if (!tokens) { invalid(); return true; }
        const commit = patch => { history.commit({ ...content, ...patch }); setMessage(t('coordinates.updated')); };
        const settings = patch => commit({ settings: { ...content.settings, ...patch } });
        if (command === 'drawingUnits') {
            const units = normalizeDrawingUnits(content.settings.units);
            if (!tokens.length) { setMessage(t('coordinates.units', units)); return true; }
            if (tokens.length % 2) { invalid(); return true; }
            for (let i = 0; i < tokens.length; i += 2) {
                const key = { DISPLAY: 'display', PRECISION: 'precision', ANGLE: 'angle', ANGLEPRECISION: 'anglePrecision', CLOCKWISE: 'clockwise', BASE: 'angleBase', ALTERNATE: 'alternate', INSERTION: 'insertion' }[tokens[i].toUpperCase()];
                const value = tokens[i + 1].toLowerCase();
                if (!key) { invalid(); return true; }
                if (['display', 'insertion', 'alternate'].includes(key)) {
                    if (key === 'alternate' && value === 'off') units[key] = null;
                    else if (Object.hasOwn(DRAWING_UNITS, value)) units[key] = value;
                    else { invalid(); return true; }
                } else if (key === 'angle') {
                    if (!['degrees', 'radians', 'gradians'].includes(value)) { invalid(); return true; }
                    units.angle = value;
                } else if (key === 'clockwise') {
                    if (!['on', 'off'].includes(value)) { invalid(); return true; }
                    units.clockwise = value === 'on';
                } else {
                    const number = Number(value);
                    if (!Number.isFinite(number) || key !== 'angleBase' && (!Number.isInteger(number) || number < 0 || number > 8)) { invalid(); return true; }
                    units[key] = number;
                }
            }
            settings({ units: normalizeDrawingUnits(units) });
        } else if (command === 'ucsIcon') {
            if (tokens.length === 1 && ['ON', 'OFF'].includes(tokens[0].toUpperCase())) settings({ ucsIcon: tokens[0].toUpperCase() === 'ON' }); else invalid();
        } else if (command === 'drawingLimits') {
            if (tokens.length === 1 && ['ON', 'OFF'].includes(tokens[0].toUpperCase()) && content.settings.limits) settings({ limits: { ...content.settings.limits, enabled: tokens[0].toUpperCase() === 'ON' } });
            else if (tokens.length === 4 && tokens.every(value => Number.isFinite(Number(value)))) {
                const [minX, minY, maxX, maxY] = tokens.map(Number);
                const limits = normalizeDrawingLimits({ minX, minY, maxX, maxY, enabled: true });
                if (limits) settings({ limits }); else invalid();
            } else invalid();
        } else {
            const [action = 'LIST', ...args] = tokens;
            const ucs = normalizeDrawingUcs(content.settings.ucs);
            const named = normalizeDrawingNamedUcs(content.namedUcs);
            const existing = named.find(item => item.name.toLowerCase() === args[0]?.trim().toLowerCase());
            if (action.toUpperCase() === 'WORLD' && !args.length) settings({ ucs: normalizeDrawingUcs() });
            else if (action.toUpperCase() === 'LIST' && !args.length) setMessage(t('coordinates.ucs', { x: ucs.x, y: ucs.y, rotation: ucs.rotation, names: named.map(item => item.name).join(', ') }));
            else if (action.toUpperCase() === 'SET' && args.length === 3 && args.every(value => Number.isFinite(Number(value)) && Math.abs(Number(value)) <= 1e9)) settings({ ucs: normalizeDrawingUcs({ x: Number(args[0]), y: Number(args[1]), rotation: Number(args[2]) }) });
            else if (action.toUpperCase() === 'SAVE' && args.length === 1 && args[0].trim() && args[0].length <= 128 && (existing || named.length < 128)) {
                const item = { name: args[0].trim(), ...ucs };
                commit({ namedUcs: existing ? named.map(frame => frame === existing ? item : frame) : [...named, item] });
            } else if (existing && args.length === 1 && action.toUpperCase() === 'RESTORE') settings({ ucs: normalizeDrawingUcs(existing) });
            else if (existing && args.length === 1 && action.toUpperCase() === 'DELETE') commit({ namedUcs: named.filter(item => item !== existing) });
            else invalid();
        }
        return true;
    };
    return { run };
}
