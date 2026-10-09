import { DxfWriter, Units, point3d, aciHex } from '@tarikjabiri/dxf';
import { DEFAULT_DRAWING_COLOR, addLayer, createDrawingId, getEntityAppearance, normalizeDrawingContent } from './drawingDocument.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { drawingLineworkArc } from './drawingLinework.js';
import { DRAWING_IMPORT_UNITS } from './drawingCoordinates.js';
import { extractEntityPaths } from './drawingCurveKernel.js';
import { arcSweep } from './drawingGeometry.js';
import { rebuildDefinedSpline } from './drawingSplineCreation.js';
import { CAD_FILE_LIMIT, DXF_MAX_ENTITIES, failDxf, readDrawingDxf } from './drawingDxfReader.js';

export { CAD_FILE_LIMIT };

const TAU = Math.PI * 2;
const MAX_COORDINATE = 1e9;
const MAX_IMPORTED_LAYERS = 4096;
const MAX_BLOCK_DEFINITIONS = 1024;
const MAX_BLOCK_DEPTH = 16;
// $INSUNITS codes with a physical length, in metres.
const DXF_UNIT_METRES = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 7: 1000, 10: 0.9144, 21: DRAWING_IMPORT_UNITS['us-ft'] };
const BY_LAYER = 256;
const BY_BLOCK = 0;
// ACI 7 is drawn black on light sheets and white on dark ones: it is the default ink.
const ACI_DEFAULT_INK = 7;
const INVALID_NAME_CHARACTERS = /[<>/\\":;?*|=\r\n]/g;

const degrees = radians => radians * 180 / Math.PI;
const radians = value => value * Math.PI / 180;
const decodeUnicode = value => String(value).replace(/\\U\+([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
const rgbHex = value => `#${(value >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

function aciColor(index) {
    return index === ACI_DEFAULT_INK ? DEFAULT_DRAWING_COLOR : `#${aciHex(index).toLowerCase()}`;
}

const aciPalette = Array.from({ length: 255 }, (_, index) => parseInt(aciHex(index + 1), 16));
const nearestAciCache = new Map();

function nearestAci(hex) {
    if (hex.toLowerCase() === DEFAULT_DRAWING_COLOR) return ACI_DEFAULT_INK;
    if (nearestAciCache.has(hex)) return nearestAciCache.get(hex);
    const rgb = parseInt(hex.slice(1), 16);
    let best = ACI_DEFAULT_INK;
    let bestDistance = Infinity;
    aciPalette.forEach((candidate, index) => {
        const distance = [0, 8, 16].reduce((sum, shift) => sum + (((rgb >> shift) & 255) - ((candidate >> shift) & 255)) ** 2, 0);
        if (distance < bestDistance) { best = index + 1; bestDistance = distance; }
    });
    if (nearestAciCache.size < 4096) nearestAciCache.set(hex, best);
    return best;
}

function finite(value) {
    if (!Number.isFinite(value) || Math.abs(value) > MAX_COORDINATE) failDxf('cadInvalid');
    return value;
}

function planarPoint(value) {
    if (!value) failDxf('cadInvalid');
    if (Math.abs(value.z || 0) > 1e-9) failDxf('cadUnsupported', '3D');
    return { x: finite(value.x), y: finite(value.y) };
}

export function decodeDrawingDxf(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > CAD_FILE_LIMIT) failDxf('cadLimit');
    if (new TextDecoder().decode(bytes.subarray(0, 22)).startsWith('AutoCAD Binary DXF')) failDxf('cadUnsupported', 'Binary DXF');
    const probe = new TextDecoder('windows-1252').decode(bytes);
    // AutoCAD 2007 (AC1021) and later write UTF-8; older files declare their ANSI code page.
    const modern = /AC10(?:2[1-9]|[3-9]\d)/.test(probe.slice(0, 8192));
    const codepage = probe.match(/\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/)?.[1];
    const encoding = modern ? 'utf-8' : codepage ? `windows-${codepage}` : 'windows-1252';
    try {
        return new TextDecoder(encoding, { fatal: true }).decode(bytes);
    } catch {
        return failDxf('cadEncoding');
    }
}

// --- Import -----------------------------------------------------------------

/**
 * Paper-space objects are always left out: the import targets model space.
 * Unsupported model objects refuse the whole import, listing them, unless
 * `skip` is set; then everything else is imported and the report lists them.
 */
export function importDrawingDxf(document, bytes, { unit = null, x = 0, y = 0, scale = 1, skip = false } = {}) {
    const text = typeof bytes === 'string' ? bytes : decodeDrawingDxf(bytes);
    const dxf = readDrawingDxf(text);
    finite(x); finite(y);
    const context = createImportContext(document, dxf, importFactor(dxf.header, unit, scale));
    const blocks = importBlockDefinitions(context);
    const entities = dxf.entities.map(source => importEntityOrSkip(context, source)).filter(Boolean)
        .map(entity => transformDrawingEntityAffine(entity, { a: 1, b: 0, c: 0, d: 1, e: x, f: y }));
    if (context.skipped.size && !skip) failDxf('cadUnsupportedObjects', describeSkipped(context.skipped));
    checkBlockGraph(blocks, entities);
    if (!entities.length) failDxf('cadEmpty');
    const existing = context.content.entities.length + context.content.blocks.reduce((sum, block) => sum + block.entities.length, 0);
    if (existing + context.converted > DXF_MAX_ENTITIES) failDxf('cadLimit');
    const content = normalizeDrawingContent({ ...context.content, activeLayerId: document.content.activeLayerId,
        blocks: [...context.content.blocks, ...blocks], entities: [...context.content.entities, ...entities] });
    return { content, assets: document.assets, selectedIds: entities.map(entity => entity.id),
        report: { imported: entities.length, warnings: [...context.warnings], paperSpace: context.paperSpace,
            skipped: context.skipped.size ? describeSkipped(context.skipped) : null,
            skippedCount: [...context.skipped.values()].reduce((sum, count) => sum + count, 0) } };
}

/** "HATCH ×12, DIMENSION ×3": DXF type names, most frequent first, language-neutral. */
function describeSkipped(skipped) {
    const rows = [...skipped].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const shown = rows.slice(0, 8).map(([type, count]) => `${type} ×${count}`);
    return rows.length > 8 ? `${shown.join(', ')}, …` : shown.join(', ');
}

/** Converts one entity, or records why it is left out: paper space, or an unsupported type/feature. */
function importEntityOrSkip(context, source, basePoint = null) {
    if (source.paperSpace) {
        context.paperSpace++;
        return null;
    }
    try {
        return importEntity(context, source, basePoint);
    } catch (error) {
        if (error.message !== 'cadUnsupported') throw error;
        context.skipped.set(source.type, (context.skipped.get(source.type) || 0) + 1);
        return null;
    }
}

function importFactor(header, unit, scale) {
    const factor = (unit ? DRAWING_IMPORT_UNITS[unit] : DXF_UNIT_METRES[Number(header.$INSUNITS)]) * scale;
    if (!Number.isFinite(factor) || factor <= 0 || factor > MAX_COORDINATE) failDxf('cadUnits');
    return factor;
}

function createImportContext(document, dxf, factor) {
    const context = { dxf, factor, content: document.content, warnings: new Set(['metadata']), converted: 0,
        layerIds: new Map(), layerNames: new Set(document.content.layers.map(layer => layer.name.toLowerCase())),
        blockNames: new Set(document.content.blocks.map(block => block.name.toLowerCase())), blockIds: new Map(),
        skipped: new Map(), paperSpace: 0 };
    for (const name of importedBlockNames(dxf)) context.blockIds.set(name, createDrawingId('block'));
    if (context.blockIds.size + (document.content.blocks?.length || 0) > MAX_BLOCK_DEFINITIONS) failDxf('cadLimit');
    return context;
}

/**
 * Named definitions are kept as reusable blocks. Anonymous ones (`*U`, `*D`…)
 * are internal artefacts: only those reachable from model INSERTs are kept.
 * External references are never imported, so their INSERTs are left out.
 */
function importedBlockNames(dxf) {
    const importable = block => block && !block.modelSpace && !block.paperSpace && !(block.flags & 4);
    const names = new Set([...dxf.blocks.values()].filter(block => importable(block) && !block.name.startsWith('*')).map(block => block.name));
    const pending = [...names, ...dxf.entities.filter(entity => entity.type === 'INSERT' && !entity.paperSpace).map(entity => entity.name)];
    while (pending.length) {
        const block = dxf.blocks.get(pending.pop());
        if (!importable(block)) continue;
        names.add(block.name);
        for (const child of block.entities) {
            if (child.type === 'INSERT' && !names.has(child.name)) pending.push(child.name);
        }
    }
    return names;
}

function uniqueName(base, names) {
    let name = base;
    for (let suffix = 2; names.has(name.toLowerCase()); suffix++) name = `${base} (${suffix})`;
    names.add(name.toLowerCase());
    return name;
}

/** Imported layers are always new, collision-safe layers retaining the source flags. */
function importLayer(context, name) {
    if (context.layerIds.has(name)) return context.layerIds.get(name);
    if (context.layerIds.size >= MAX_IMPORTED_LAYERS) failDxf('cadLimit');
    const source = context.dxf.layers.get(name);
    context.content = addLayer(context.content, uniqueName(decodeUnicode(name), context.layerNames));
    const id = context.content.activeLayerId;
    const color = source?.trueColor !== null && source?.trueColor !== undefined ? rgbHex(source.trueColor)
        : source ? aciColor(source.colorIndex) : DEFAULT_DRAWING_COLOR;
    context.content.layers = context.content.layers.map(layer => layer.id !== id ? layer : { ...layer, color,
        visible: source?.visible !== false, frozen: Boolean(source?.frozen), newViewportFrozen: Boolean(source?.newViewportFrozen),
        locked: Boolean(source?.locked), plot: source?.plot !== false, lineType: importLineType(source?.lineType, context.warnings) });
    context.layerIds.set(name, id);
    return id;
}

function importBlockDefinitions(context) {
    return [...context.blockIds].map(([name, id]) => {
        const block = context.dxf.blocks.get(name);
        const basePoint = planarPoint(block.basePoint);
        return { id, name: uniqueName(decodeUnicode(name), context.blockNames), basePoint: { x: 0, y: 0 },
            entities: block.entities.map(source => importEntityOrSkip(context, source, basePoint)).filter(Boolean) };
    });
}

/** Converts one DXF entity; block children are relative to `basePoint` and layer 0 inherits. */
function importEntity(context, source, basePoint = null) {
    if (++context.converted > DXF_MAX_ENTITIES) failDxf('cadLimit');
    if (source.unsupported) failDxf('cadUnsupported', source.type);
    checkImportableEntity(source);
    const origin = basePoint || { x: 0, y: 0 };
    const local = value => {
        const point = planarPoint(value);
        return { x: point.x - origin.x, y: point.y - origin.y };
    };
    const entity = convertEntity(context, source, local, importAppearance(source, context.warnings));
    // The layer is created last, so an object left out never leaves an empty layer behind.
    entity.layerId = basePoint && source.layer === '0' ? 'geometry' : importLayer(context, source.layer);
    return entity;
}

function convertEntity(context, source, local, appearance) {
    if (source.type === 'TEXT' || source.type === 'MTEXT') return importText(context, source, local, appearance);
    if (source.type === 'INSERT') return importInsert(context, source, local, appearance);
    const shape = SHAPE_IMPORTERS[source.type](source, local);
    // DXF is Y-up; the editor is Y-down. Reflect while converting to metres.
    return transformDrawingEntityAffine({ ...shape, id: createDrawingId(shape.type), ...appearance },
        { a: context.factor, b: 0, c: 0, d: -context.factor, e: 0, f: 0 });
}

function checkImportableEntity(source) {
    if (source.thickness || source.transparent) failDxf('cadUnsupported', 'thickness/transparency');
    if (!source.visible) failDxf('cadUnsupported', 'invisible entity');
    const { extrusion } = source;
    if (extrusion.x || extrusion.y || extrusion.z !== 1 || source.elevation) failDxf('cadUnsupported', '3D/OCS');
}

function importAppearance(source, warnings) {
    if (source.colorIndex === BY_BLOCK) warnings.add('appearance');
    if (source.lineweight > 0 || source.lineTypeScale !== 1) warnings.add('appearance');
    const appearance = {};
    if (source.trueColor !== null) appearance.color = rgbHex(source.trueColor);
    else if (source.colorIndex !== BY_LAYER && source.colorIndex !== BY_BLOCK) appearance.color = aciColor(Math.abs(source.colorIndex));
    if (source.lineType && !/^BY(LAYER|BLOCK)$/i.test(source.lineType)) appearance.lineType = importLineType(source.lineType, warnings);
    return appearance;
}

function importLineType(value, warnings) {
    if (!value || ['BYLAYER', 'BYBLOCK', 'CONTINUOUS'].includes(value.toUpperCase())) return 'continuous';
    if (!['DASHED', 'DOTTED'].includes(value.toUpperCase())) warnings.add('appearance');
    return /DOT/i.test(value) ? 'dotted' : 'dashed';
}

const SHAPE_IMPORTERS = {
    LINE: (source, local) => {
        const start = local(source.start);
        const end = local(source.end);
        return { type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
    },
    POINT: (source, local) => ({ type: 'point', ...local(source.position) }),
    CIRCLE: (source, local) => ({ type: 'circle', ...importCircle(source, local) }),
    ARC: (source, local) => ({ type: 'arc', ...importCircle(source, local),
        startAngle: finite(source.startAngle), endAngle: finite(source.endAngle), counterClockwise: true }),
    ELLIPSE: (source, local) => {
        const center = local(source.center);
        const axis = planarPoint(source.majorAxis);
        const radius = Math.hypot(axis.x, axis.y);
        if (!(radius > 0 && source.axisRatio > 0 && source.axisRatio <= 1)) failDxf('cadInvalid');
        return { type: 'ellipse', cx: center.x, cy: center.y, rx: radius, ry: radius * source.axisRatio,
            rotation: degrees(Math.atan2(axis.y, axis.x)), startAngle: finite(source.startParameter), endAngle: finite(source.endParameter),
            fullEllipse: Math.abs(source.endParameter - source.startParameter) >= TAU - 1e-9, counterClockwise: true };
    },
    SPLINE: (source, local) => {
        if (source.degree !== 3 || source.rational || source.closed || source.periodic || source.knots.length < 2) failDxf('cadUnsupported', 'SPLINE');
        const low = source.knots[0];
        const range = source.knots.at(-1) - low;
        if (!(range > 0)) failDxf('cadInvalid');
        const shape = rebuildDefinedSpline({}, { mode: 'control', points: source.controlPoints.map(local),
            knots: source.knots.map(knot => (knot - low) / range) });
        return shape || failDxf('cadUnsupported', 'SPLINE');
    },
    LWPOLYLINE: (source, local) => importPolyline(source, local),
    POLYLINE: (source, local) => {
        if (source.is3d || source.mesh) failDxf('cadUnsupported', 'wide/3D polyline');
        return importPolyline(source, local);
    },
};

function importCircle(source, local) {
    const center = local(source.center);
    if (!(source.radius > 0)) failDxf('cadInvalid');
    return { cx: center.x, cy: center.y, r: finite(source.radius) };
}

/** Bulged vertices become exact arcs; straight-only polylines keep their points. */
function importPolyline(source, local) {
    if (source.constantWidth || source.vertices.some(vertex => vertex.startWidth || vertex.endWidth)) failDxf('cadUnsupported', 'wide/3D polyline');
    const points = source.vertices.map(local);
    if (points.length < 2) failDxf('cadLimit');
    if (!source.vertices.some(vertex => vertex.bulge)) return { type: 'polyline', points, closed: source.closed };
    const segmentCount = source.closed ? points.length : points.length - 1;
    const parts = points.slice(0, segmentCount).map((start, index) => {
        const end = points[(index + 1) % points.length];
        const { bulge } = source.vertices[index];
        if (!bulge) return { type: 'line', x1: start.x, y1: start.y, x2: end.x, y2: end.y };
        const arc = drawingLineworkArc(start, end, bulge) || failDxf('cadInvalid');
        return { type: 'arc', cx: arc.center.x, cy: arc.center.y, r: arc.radius,
            startAngle: arc.startAngle, endAngle: arc.startAngle + arc.sweep, counterClockwise: arc.sweep > 0 };
    });
    return { type: 'polyline', parts, closed: source.closed };
}

/** Text keeps screen-aligned glyphs: only its placement is reflected and scaled. */
function importText(context, source, local, appearance) {
    context.warnings.add('text');
    if (source.type === 'TEXT' && (source.generation || source.widthFactor !== 1)) failDxf('cadUnsupported', 'text transform');
    if (!(source.height > 0) || source.text.length > 100000) failDxf('cadInvalid');
    const value = decodeUnicode(source.text).replace(/\\P/g, '\n');
    if (/\\[A-Za-z]|[{}]/.test(value)) failDxf('cadUnsupported', 'formatted text');
    const position = local(source.position);
    const { factor } = context;
    const singleLine = source.type === 'TEXT';
    return { id: createDrawingId('text'), type: 'text', x: position.x * factor, y: -position.y * factor,
        text: value, textMode: singleLine ? 'singleLine' : 'multiline', fontSize: source.height * factor,
        width: ((!singleLine && source.width) || source.height * Math.max(value.length, 1)) * factor,
        height: source.height * factor * 1.4, rotation: -source.rotation, horizontalAlign: 'left',
        verticalAlign: singleLine ? 'bottom' : 'top', ...appearance };
}

function importInsert(context, source, local, appearance) {
    if (!context.blockIds.has(source.name) || source.rows !== 1 || source.columns !== 1) failDxf('cadUnsupported', 'INSERT');
    const { xScale, yScale } = source;
    if (![xScale, yScale].every(value => Number.isFinite(value) && Math.abs(value) > 1e-12 && Math.abs(value) <= 1e6)) failDxf('cadInvalid');
    const position = local(source.position);
    // Reflecting Y turns the counter-clockwise source rotation into a clockwise one.
    const angle = -radians(source.rotation);
    return { id: createDrawingId('blockReference'), type: 'blockReference', blockId: context.blockIds.get(source.name),
        transform: { a: Math.cos(angle) * xScale, b: Math.sin(angle) * xScale, c: -Math.sin(angle) * yScale, d: Math.cos(angle) * yScale,
            e: position.x * context.factor, f: -position.y * context.factor }, ...appearance };
}

/** Refuses cycles, deep nesting and expanded instance counts above the entity limit. */
function checkBlockGraph(blocks, entities = []) {
    const byId = new Map(blocks.map(block => [block.id, block]));
    const heights = new Map();
    const costs = new Map();
    const visit = (id, stack) => {
        if (stack.includes(id) || stack.length >= MAX_BLOCK_DEPTH || !byId.has(id)) failDxf('cadUnsupported', 'cyclic/deep block');
        if (heights.has(id)) return heights.get(id);
        let height = 1;
        let cost = 0;
        for (const entity of byId.get(id).entities) {
            if (entity.type === 'blockReference') {
                height = Math.max(height, 1 + visit(entity.blockId, [...stack, id]));
                cost += costs.get(entity.blockId);
            } else cost++;
            if (cost > DXF_MAX_ENTITIES) failDxf('cadLimit');
        }
        costs.set(id, cost);
        if (height > MAX_BLOCK_DEPTH) failDxf('cadUnsupported', 'deep block');
        heights.set(id, height);
        return height;
    };
    for (const block of blocks) visit(block.id, []);
    let total = 0;
    for (const entity of entities) {
        if (entity.type === 'blockReference' && !costs.has(entity.blockId)) failDxf('cadUnsupported', 'missing block');
        total += entity.type === 'blockReference' ? costs.get(entity.blockId) : 1;
        if (total > DXF_MAX_ENTITIES) failDxf('cadLimit');
    }
}

// --- Export -----------------------------------------------------------------

export function exportDrawingDxf(content, { legacy = false } = {}) {
    const writer = new DxfWriter();
    writer.setUnits(Units.Meters);
    // LibreDWG 0.14 misreads block/layer names when converting an R2007 DXF to R2000.
    // Emit a matching R2000 intermediate with indexed colours and Unicode escapes.
    if (legacy) {
        writer.setVariable('$ACADVER', { 1: 'AC1015' });
        writer.setVariable('$DWGCODEPAGE', { 3: 'ANSI_1252' });
    }
    // LibreDWG's DXF reader resolves linetype names case-sensitively.
    writer.tables.addLType('CONTINUOUS', 'Solid line', []);
    const context = { content, writer, legacy, count: 0, warnings: new Set(['metadata', 'appearance']),
        layerNames: exportLayers(writer, content.layers, legacy), blocks: new Map() };
    checkBlockGraph(content.blocks || [], content.entities);
    for (const block of content.blocks || []) {
        if (block.dynamic) failDxf('cadUnsupported', 'dynamic block');
        const name = `B${context.blocks.size}_${block.name.replace(INVALID_NAME_CHARACTERS, '_')}`;
        context.blocks.set(block.id, writer.addBlock(name));
    }
    for (const block of content.blocks || []) {
        for (const entity of block.entities) exportEntity(context, entity, context.blocks.get(block.id));
    }
    for (const entity of content.entities) exportEntity(context, entity, writer);
    // DXF group values are newline-terminated, including the final EOF marker.
    let text = `${writer.stringify().trimEnd()}\n`;
    if (legacy) text = text.replace(/[^\x00-\x7f]/g, character => `\\U+${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const bytes = new TextEncoder().encode(text);
    if (bytes.length > CAD_FILE_LIMIT) failDxf('cadLimit');
    return { text, bytes, report: { exported: content.entities.length, warnings: [...context.warnings] } };
}

function exportLayers(writer, layers, legacy) {
    const names = new Map();
    for (const layer of layers) {
        const { name } = layer;
        if (!name || /[<>/\\":;?*|=\r\n]/.test(name) || [...names.values()].includes(name)) failDxf('cadUnsupported', 'layer name');
        const target = writer.layer(name) || writer.addLayer(name, ACI_DEFAULT_INK, 'CONTINUOUS');
        target.colorNumber = nearestAci(layer.color) * (layer.visible === false ? -1 : 1);
        target.lineType = 'CONTINUOUS';
        target.flags = (layer.frozen ? 1 : 0) | (layer.newViewportFrozen ? 2 : 0) | (layer.locked ? 4 : 0);
        if (!legacy && layer.color.toLowerCase() !== DEFAULT_DRAWING_COLOR) target.trueColor = parseInt(layer.color.slice(1), 16);
        names.set(layer.id, name);
    }
    return names;
}

/** Entity colour: ByLayer when it follows its layer, otherwise indexed plus true colour. */
function exportEntityOptions(context, entity, target) {
    const { content, legacy } = context;
    if (target !== context.writer && entity.layerId === 'geometry' && !entity.color) return { layerName: '0' };
    const style = getEntityAppearance(content, entity);
    const layerColor = content.layers.find(layer => layer.id === entity.layerId)?.color;
    const options = { layerName: context.layerNames.get(entity.layerId) };
    if (!entity.color && style.color === layerColor) return options;
    options.colorNumber = nearestAci(style.color);
    if (!legacy && style.color.toLowerCase() !== DEFAULT_DRAWING_COLOR) options.trueColor = String(parseInt(style.color.slice(1), 16));
    return options;
}

function exportEntity(context, entity, target, inheritedOptions = null) {
    if (++context.count > DXF_MAX_ENTITIES) failDxf('cadLimit');
    const style = getEntityAppearance(context.content, entity);
    if (style.transparency || entity.affineFrame || entity.attributeDefinition || entity.attributeValues || entity.blockClip || entity.externalReference) {
        failDxf('cadUnsupported', entity.type);
    }
    const options = inheritedOptions || exportEntityOptions(context, entity, target);
    const exporter = entity.splineDefinition?.mode === 'control' ? exportControlSpline
        : Object.hasOwn(ENTITY_EXPORTERS, entity.type) ? ENTITY_EXPORTERS[entity.type] : null;
    if (!exporter) failDxf('cadUnsupported', entity.type);
    exporter(context, entity, target, options);
}

const point = (x, y) => point3d(finite(x), -finite(y), 0);

const ENTITY_EXPORTERS = {
    spline: (context, entity, target, options) => target.addSpline({ degreeCurve: 3,
        controlPoints: entity.controlPoints.map(control => point(control.x, control.y)), knots: [0, 0, 0, 0, 1, 1, 1, 1] }, options),
    line: (context, entity, target, options) => target.addLine(point(entity.x1, entity.y1), point(entity.x2, entity.y2), options),
    point: (context, entity, target, options) => target.addPoint(finite(entity.x), -finite(entity.y), 0, options),
    circle: (context, entity, target, options) => target.addCircle(point(entity.cx, entity.cy), entity.r, options),
    arc: (context, entity, target, options) => {
        // The Y reflection reverses the sweep; DXF arcs always run counter-clockwise.
        const start = -entity.startAngle;
        const end = -(entity.startAngle + arcSweep(entity));
        const counterClockwise = entity.counterClockwise !== false;
        target.addArc(point(entity.cx, entity.cy), entity.r, degrees(counterClockwise ? end : start), degrees(counterClockwise ? start : end), options);
    },
    ellipse: (context, entity, target, options) => {
        if (!entity.fullEllipse) failDxf('cadUnsupported', 'ellipse');
        const swapped = entity.rx < entity.ry;
        const angle = -radians(entity.rotation + (swapped ? 90 : 0));
        const major = Math.max(entity.rx, entity.ry);
        const minor = Math.min(entity.rx, entity.ry);
        target.addEllipse(point(entity.cx, entity.cy), point3d(major * Math.cos(angle), major * Math.sin(angle), 0), minor / major, 0, TAU, options);
    },
    polyline: (context, entity, target, options) => {
        if (!entity.points) return exportExplodedPaths(context, entity, target, options);
        return target.addLWPolyline(entity.points.map(vertex => ({ point: { x: finite(vertex.x), y: -finite(vertex.y) } })),
            { ...options, flags: entity.closed ? 1 : 0 });
    },
    rectangle: exportExplodedPaths,
    polygon: exportExplodedPaths,
    blockReference: (context, entity, target, options) => {
        const block = context.blocks.get(entity.blockId) || failDxf('cadUnsupported', 'missing block');
        const matrix = entity.transform;
        const xScale = Math.hypot(matrix.a, matrix.b);
        const yScale = (matrix.a * matrix.d - matrix.b * matrix.c) / xScale;
        if (!(xScale > 1e-12) || Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 1e-9 * xScale * Math.abs(yScale)) {
            failDxf('cadUnsupported', 'sheared block');
        }
        target.addInsert(block.name, point(matrix.e, matrix.f), { ...options, scaleFactor: { x: xScale, y: yScale, z: 1 },
            rotationAngle: -degrees(Math.atan2(matrix.b, matrix.a)) });
    },
    text: (context, entity, target, options) => {
        if (entity.transform) failDxf('cadUnsupported', entity.type);
        context.warnings.add('text');
        const singleLine = entity.textMode === 'singleLine';
        // Group values are single lines; control characters would inject DXF records.
        if (/[\\{}\r\x00-\x08]/.test(entity.text) || (singleLine && entity.text.includes('\n'))) failDxf('cadUnsupported', 'formatted text');
        const position = point(entity.x, entity.y);
        if (singleLine) target.addText(position, entity.fontSize, entity.text, { ...options, rotation: -entity.rotation });
        else target.addMText(position, entity.fontSize, entity.text.replace(/\n/g, '\\P'), { ...options, rotation: -entity.rotation, width: entity.width });
    },
};

function exportControlSpline(context, entity, target, options) {
    const { points, knots } = entity.splineDefinition;
    target.addSpline({ degreeCurve: 3, controlPoints: points.map(control => point(control.x, control.y)), knots }, options);
}

/** Compound paths, rectangles and polygons become their primitive curves. */
function exportExplodedPaths(context, entity, target, options) {
    const paths = extractEntityPaths(entity);
    if (!paths.length) failDxf('cadUnsupported', entity.type);
    context.warnings.add('exploded');
    for (const path of paths) {
        for (const primitive of path.parts) exportEntity(context, { ...primitive, layerId: entity.layerId }, target, options);
    }
}
