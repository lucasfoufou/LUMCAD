import { drawingComparisonValue } from './drawingComparison.js';
import { drawingLayerSnapshot } from './drawingLayers.js';
import { normalizeDimensionStyleValues } from './drawingDimensionStyles.js';
import { normalizeDrawingTextStyle } from './drawingText.js';
import { normalizeDrawingLeaderStyle } from './drawingLeaders.js';
import { normalizeMultilineStyle } from './drawingLinework.js';
import { normalizeDrawingTableStyle } from './drawingTables.js';

const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const layerFields = ['plot', 'color', 'lineType', 'lineWeight', 'transparency'];
const textFields = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'underline', 'strikethrough', 'lineHeight'];
const withoutName = value => value && Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'name'));
const catalogs = Object.freeze({
    layers: value => pick(drawingLayerSnapshot(value), layerFields),
    textStyles: value => pick(normalizeDrawingTextStyle(value), textFields),
    dimensionStyles: normalizeDimensionStyleValues,
    leaderStyles: normalizeDrawingLeaderStyle,
    multilineStyles: value => withoutName(normalizeMultilineStyle(value)),
    tableStyles: value => withoutName(normalizeDrawingTableStyle(value)),
});
const equal = (a, b) => JSON.stringify(drawingComparisonValue(a)) === JSON.stringify(drawingComparisonValue(b));
const keyOf = name => name.toLowerCase();

function checkedName(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\u0000-\u001f]/.test(value)) throw new Error('standardsName');
    return value.trim();
}

function catalogEntries(scope, source, packed = false) {
    if (!Array.isArray(source) || source.length > (scope === 'layers' ? 2048 : 128)) throw new Error('standardsLimit');
    const names = new Set(); const ids = new Set();
    return source.map(entry => {
        const name = checkedName(entry?.name); const key = keyOf(name);
        if (names.has(key)) throw new Error('standardsIdentity');
        names.add(key);
        if (!packed && entry.id !== undefined) {
            if (typeof entry.id !== 'string' || !entry.id || ids.has(entry.id)) throw new Error('standardsIdentity');
            ids.add(entry.id);
        }
        const values = catalogs[scope](packed ? entry.values : entry);
        if (!values || packed && (!equal(values, entry.values) || Object.keys(entry).some(field => !['name', 'values'].includes(field)))) throw new Error('standardsInvalid');
        return { name, values: drawingComparisonValue(values) };
    });
}

/** Portable standards deliberately exclude IDs, geometry, locks and viewport visibility. */
export function createDrawingStandards(content, name = 'Standard') {
    if (!content || typeof content !== 'object') throw new Error('standardsInvalid');
    return { format: 'lumcad-standards', version: 1, name: checkedName(name),
        catalogs: Object.fromEntries(Object.keys(catalogs).map(scope => [scope, catalogEntries(scope, content[scope] ?? [])])) };
}

/** Strict round-trip validation prevents silently accepting a malformed standards file. */
export function parseDrawingStandards(input) {
    if (typeof input === 'string' && input.length > 4 * 1024 * 1024) throw new Error('standardsLimit');
    const source = drawingComparisonValue(typeof input === 'string' ? JSON.parse(input) : input);
    if (source?.format !== 'lumcad-standards' || source.version !== 1 || !source.catalogs
        || Object.keys(source).some(key => !['format', 'version', 'name', 'catalogs'].includes(key))
        || Object.keys(source.catalogs).some(key => !Object.hasOwn(catalogs, key))) throw new Error('standardsInvalid');
    return { format: source.format, version: 1, name: checkedName(source.name),
        catalogs: Object.fromEntries(Object.keys(catalogs).map(scope => [scope, catalogEntries(scope, source.catalogs[scope], true)])) };
}

/** Read-only, name-based checks also report extra definitions and absent required definitions. */
export function checkDrawingStandards(content, input) {
    const standard = parseDrawingStandards(input);
    const current = createDrawingStandards(content);
    const issues = [];
    for (const scope of Object.keys(catalogs)) {
        const expected = new Map(standard.catalogs[scope].map(entry => [keyOf(entry.name), entry]));
        const actual = new Map(current.catalogs[scope].map(entry => [keyOf(entry.name), entry]));
        for (const [key, entry] of actual) {
            const target = expected.get(key);
            if (!target) issues.push({ scope, name: entry.name, kind: 'nonstandard', actual: entry.values, expected: null, fields: [] });
            else {
                const fields = Object.keys(target.values).filter(field => !equal(entry.values[field], target.values[field]));
                if (fields.length) issues.push({ scope, name: entry.name, kind: 'properties', actual: entry.values, expected: target.values, fields });
            }
        }
        for (const [key, entry] of expected) if (!actual.has(key)) issues.push({ scope, name: entry.name, kind: 'missing', actual: null, expected: entry.values, fields: [] });
    }
    return { version: 1, name: standard.name, issues, compliant: !issues.length };
}
