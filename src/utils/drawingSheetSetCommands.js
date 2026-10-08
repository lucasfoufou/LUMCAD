import { editDrawingSheetSet } from './drawingSheetSets.js';

/** Indices are one-based positions in the current report, independent of sheet numbers. */
export function editDrawingSheetSetCommand(set, tokens) {
    const [action, ...args] = tokens;
    const sheet = value => /^[1-9]\d*$/.test(value || '') ? set.sheets[Number(value) - 1] : null;
    if (action === 'REMOVE' && args.length === 1 && sheet(args[0])) return editDrawingSheetSet(set, [{ type: 'removeSheet', id: sheet(args[0]).id }]);
    if (['NUMBER', 'TITLE'].includes(action) && args.length === 2 && sheet(args[0])) {
        return editDrawingSheetSet(set, [{ type: 'sheet', sheet: { ...sheet(args[0]), [action === 'NUMBER' ? 'number' : 'title']: args[1] } }]);
    }
    if (action === 'ORDER' && args.length && args.every(value => sheet(value))) return editDrawingSheetSet(set, [{ type: 'order', ids: args.map(value => sheet(value).id) }]);
    if (action === 'PROPERTY' && args.length === 3) {
        const target = args[0].toUpperCase();
        const ids = target === 'PROJECT' ? null : target === 'ALL' ? set.sheets.map(value => value.id) : sheet(args[0]) ? [sheet(args[0]).id] : [];
        return editDrawingSheetSet(set, [{ type: 'properties', ids, properties: Object.fromEntries([[args[1], args[2]]]) }]);
    }
    throw new Error('sheetSetSyntax');
}
