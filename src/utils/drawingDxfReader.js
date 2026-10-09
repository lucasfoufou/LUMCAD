// Bounded ASCII DXF reader for the supported 2D interchange subset.
//
// The reader walks the group-code pairs once and returns plain records: header
// units, layer table entries, block definitions and entities. It never skips a
// graphical record silently: entity types outside SUPPORTED_DXF_ENTITIES are
// returned as `{ type, unsupported: true }` so that the importer decides how to
// refuse or report them.

export const CAD_FILE_LIMIT = 64 * 1024 * 1024;
export const DXF_MAX_ENTITIES = 100000;
const MAX_GROUP_LINES = 2000000;
const MAX_POLYLINE_VERTICES = 4096;
const NUMBER_PATTERN = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;
const STRING_CODES = new Set([1, 3]);

export const SUPPORTED_DXF_ENTITIES = Object.freeze(['LINE', 'POINT', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE',
    'LWPOLYLINE', 'POLYLINE', 'TEXT', 'MTEXT', 'INSERT']);
const SUPPORTED = new Set(SUPPORTED_DXF_ENTITIES);

export function failDxf(code, detail = '') {
    const error = new Error(code);
    error.detail = detail;
    throw error;
}

export function readDrawingDxf(text) {
    const groups = splitGroups(text);
    const result = { header: Object.create(null), layers: new Map(), blocks: new Map(), entities: [], hasEntities: false };
    const cursor = { groups, index: 0, entityCount: 0 };
    while (cursor.index < groups.length) {
        const [code, value] = groups[cursor.index];
        if (code !== 0) failDxf('cadInvalid');
        if (value === 'EOF') {
            if (cursor.index !== groups.length - 1) failDxf('cadInvalid');
            return finishRead(result);
        }
        if (value !== 'SECTION') failDxf('cadInvalid');
        const name = groups[cursor.index + 1];
        if (!name || name[0] !== 2) failDxf('cadInvalid');
        cursor.index += 2;
        readSection(cursor, name[1], result);
    }
    return failDxf('cadInvalid');
}

function finishRead(result) {
    if (!result.hasEntities) failDxf('cadInvalid');
    return result;
}

function splitGroups(text) {
    if (typeof text !== 'string' || text.length > CAD_FILE_LIMIT) failDxf('cadLimit');
    const lines = text.replace(/^﻿/, '').trimEnd().split(/\r\n|\n|\r/);
    if (lines.length % 2 || lines.length > MAX_GROUP_LINES) failDxf('cadInvalid');
    const groups = [];
    for (let index = 0; index < lines.length; index += 2) {
        if (!/^\s*-?\d+\s*$/.test(lines[index])) failDxf('cadInvalid');
        const code = Number(lines[index]);
        if (code === 999) continue;
        const raw = lines[index + 1];
        groups.push([code, STRING_CODES.has(code) ? raw : raw.trim()]);
    }
    return groups;
}

function readSection(cursor, name, result) {
    if (name === 'HEADER') readHeader(cursor, result.header);
    else if (name === 'TABLES') readTables(cursor, result.layers);
    else if (name === 'BLOCKS') readBlocks(cursor, result);
    else if (name === 'ENTITIES') {
        result.hasEntities = true;
        result.entities.push(...readEntities(cursor, 'ENDSEC'));
    } else skipRecords(cursor, 'ENDSEC');
    expectRecord(cursor, 'ENDSEC');
}

function readHeader(cursor, header) {
    let variable = null;
    while (!atRecord(cursor, 'ENDSEC')) {
        const [code, value] = nextGroup(cursor);
        if (code === 9) variable = value;
        else if (variable && !Object.hasOwn(header, variable)) header[variable] = value;
    }
}

function readTables(cursor, layers) {
    while (!atRecord(cursor, 'ENDSEC')) {
        const record = nextRecord(cursor);
        if (record.type !== 'LAYER') continue;
        const name = recordValue(record, 2);
        if (name === undefined) failDxf('cadInvalid');
        const colorIndex = recordNumber(record, 62, 7);
        const flags = recordNumber(record, 70, 0);
        layers.set(name, {
            name,
            colorIndex: Math.abs(colorIndex),
            trueColor: recordNumber(record, 420, null),
            visible: colorIndex >= 0,
            frozen: Boolean(flags & 1),
            newViewportFrozen: Boolean(flags & 2),
            locked: Boolean(flags & 4),
            lineType: recordValue(record, 6) ?? null,
            plot: recordNumber(record, 290, 1) !== 0,
        });
    }
}

function readBlocks(cursor, result) {
    while (!atRecord(cursor, 'ENDSEC')) {
        const record = nextRecord(cursor);
        // LibreDWG 0.14 (dwgread -O DXF) emits an extra ENDBLK after some definitions.
        if (record.type === 'ENDBLK') continue;
        if (record.type !== 'BLOCK') failDxf('cadInvalid');
        const name = recordValue(record, 2);
        if (name === undefined || result.blocks.has(name)) failDxf('cadInvalid');
        const entities = readEntities(cursor, 'ENDBLK');
        expectRecord(cursor, 'ENDBLK');
        result.blocks.set(name, {
            name,
            flags: recordNumber(record, 70, 0),
            basePoint: recordPoint(record, 10) || { x: 0, y: 0, z: 0 },
            paperSpace: /^\*Paper_Space/i.test(name),
            modelSpace: /^\*Model_Space$/i.test(name),
            entities,
        });
    }
}

function readEntities(cursor, terminator) {
    const entities = [];
    while (!atRecord(cursor, terminator)) {
        const record = nextRecord(cursor);
        if (record.type === 'SEQEND') continue;
        if (++cursor.entityCount > DXF_MAX_ENTITIES) failDxf('cadLimit');
        if (record.type === 'POLYLINE') record.vertices = readPolylineVertices(cursor);
        else if (record.type === 'VERTEX') failDxf('cadInvalid');
        entities.push(SUPPORTED.has(record.type) ? describeEntity(record) : describeUnsupported(record));
    }
    return entities;
}

function readPolylineVertices(cursor) {
    const vertices = [];
    while (atRecord(cursor, 'VERTEX')) {
        if (vertices.length >= MAX_POLYLINE_VERTICES) failDxf('cadLimit');
        vertices.push(nextRecord(cursor));
    }
    expectRecord(cursor, 'SEQEND');
    return vertices;
}

function skipRecords(cursor, terminator) {
    while (!atRecord(cursor, terminator)) cursor.index++;
}

function atRecord(cursor, type) {
    const group = cursor.groups[cursor.index];
    if (!group) failDxf('cadInvalid');
    return group[0] === 0 && group[1] === type;
}

/** Consumes a terminator record such as ENDBLK or SEQEND, including its own groups. */
function expectRecord(cursor, type) {
    if (!atRecord(cursor, type)) failDxf('cadInvalid');
    nextRecord(cursor);
}

function nextGroup(cursor) {
    const group = cursor.groups[cursor.index++];
    if (!group) failDxf('cadInvalid');
    return group;
}

/** Collects one record, dropping XDATA, 102 application groups and embedded objects. */
function nextRecord(cursor) {
    const [code, type] = nextGroup(cursor);
    if (code !== 0) failDxf('cadInvalid');
    const groups = [];
    let applicationGroup = false;
    let embedded = false;
    while (cursor.index < cursor.groups.length && cursor.groups[cursor.index][0] !== 0) {
        const group = cursor.groups[cursor.index++];
        if (group[0] === 102) applicationGroup = group[1].startsWith('{');
        else if (group[0] === 101) embedded = true;
        else if (!applicationGroup && !embedded && group[0] < 1000) groups.push(group);
    }
    return { type, groups };
}

function recordValue(record, code) {
    return record.groups.find(group => group[0] === code)?.[1];
}

function parseNumber(value) {
    if (!NUMBER_PATTERN.test(value)) failDxf('cadInvalid');
    const number = Number(value);
    if (!Number.isFinite(number)) failDxf('cadInvalid');
    return number;
}

function recordNumber(record, code, fallback) {
    const value = recordValue(record, code);
    return value === undefined ? fallback : parseNumber(value);
}

function recordPoint(record, code) {
    const x = recordValue(record, code);
    if (x === undefined) return null;
    return { x: parseNumber(x), y: recordNumber(record, code + 10, 0), z: recordNumber(record, code + 20, 0) };
}

/** Repeated point groups such as SPLINE control points, in file order. */
function recordPointList(record, code) {
    const points = [];
    for (const [groupCode, value] of record.groups) {
        if (groupCode === code) points.push({ x: parseNumber(value), y: 0, z: 0 });
        else if (groupCode === code + 10 && points.length) points.at(-1).y = parseNumber(value);
        else if (groupCode === code + 20 && points.length) points.at(-1).z = parseNumber(value);
    }
    return points;
}

function recordNumberList(record, code) {
    return record.groups.filter(group => group[0] === code).map(group => parseNumber(group[1]));
}

function describeUnsupported(record) {
    return { type: record.type, unsupported: true, paperSpace: recordNumber(record, 67, 0) !== 0 };
}

function describeEntity(record) {
    const entity = {
        type: record.type,
        layer: recordValue(record, 8) || '0',
        lineType: recordValue(record, 6) ?? null,
        lineTypeScale: recordNumber(record, 48, 1),
        lineweight: recordNumber(record, 370, -1),
        colorIndex: recordNumber(record, 62, 256),
        trueColor: recordNumber(record, 420, null),
        visible: recordNumber(record, 60, 0) === 0,
        paperSpace: recordNumber(record, 67, 0) !== 0,
        thickness: recordNumber(record, 39, 0),
        transparent: recordValue(record, 440) !== undefined,
        extrusion: { x: recordNumber(record, 210, 0), y: recordNumber(record, 220, 0), z: recordNumber(record, 230, 1) },
    };
    return Object.assign(entity, ENTITY_READERS[record.type](record));
}

const ENTITY_READERS = {
    LINE: record => ({ start: recordPoint(record, 10), end: recordPoint(record, 11) }),
    POINT: record => ({ position: recordPoint(record, 10) }),
    CIRCLE: record => ({ center: recordPoint(record, 10), radius: recordNumber(record, 40, NaN) }),
    ARC: record => ({
        center: recordPoint(record, 10),
        radius: recordNumber(record, 40, NaN),
        startAngle: recordNumber(record, 50, 0) * Math.PI / 180,
        endAngle: recordNumber(record, 51, 360) * Math.PI / 180,
    }),
    ELLIPSE: record => ({
        center: recordPoint(record, 10),
        majorAxis: recordPoint(record, 11),
        axisRatio: recordNumber(record, 40, NaN),
        startParameter: recordNumber(record, 41, 0),
        endParameter: recordNumber(record, 42, Math.PI * 2),
    }),
    SPLINE: record => {
        const flags = recordNumber(record, 70, 0);
        return {
            flags,
            closed: Boolean(flags & 1),
            periodic: Boolean(flags & 2),
            rational: Boolean(flags & 4),
            degree: recordNumber(record, 71, NaN),
            knots: recordNumberList(record, 40),
            controlPoints: recordPointList(record, 10),
            fitPoints: recordPointList(record, 11),
            // Spline points are stored in world coordinates; the normal is informative.
            extrusion: { x: 0, y: 0, z: 1 },
        };
    },
    LWPOLYLINE: record => ({
        closed: Boolean(recordNumber(record, 70, 0) & 1),
        constantWidth: recordNumber(record, 43, 0),
        elevation: recordNumber(record, 38, 0),
        vertices: readLightweightVertices(record),
    }),
    POLYLINE: record => readPolyline(record),
    TEXT: record => ({
        position: recordPoint(record, 10),
        height: recordNumber(record, 40, NaN),
        widthFactor: recordNumber(record, 41, 1),
        rotation: recordNumber(record, 50, 0),
        generation: recordNumber(record, 71, 0),
        text: recordValue(record, 1) ?? '',
    }),
    MTEXT: record => {
        const direction = recordPoint(record, 11);
        return {
            position: recordPoint(record, 10),
            height: recordNumber(record, 40, NaN),
            width: recordNumber(record, 41, 0),
            rotation: direction ? Math.atan2(direction.y, direction.x) * 180 / Math.PI : recordNumber(record, 50, 0),
            attachment: recordNumber(record, 71, 1),
            // Long MTEXT is split into 250-character code 3 chunks followed by code 1.
            text: [...record.groups.filter(group => group[0] === 3).map(group => group[1]), recordValue(record, 1) ?? ''].join(''),
        };
    },
    INSERT: record => ({
        name: recordValue(record, 2),
        position: recordPoint(record, 10) || { x: 0, y: 0, z: 0 },
        xScale: recordNumber(record, 41, 1),
        yScale: recordNumber(record, 42, 1),
        zScale: recordNumber(record, 43, 1),
        rotation: recordNumber(record, 50, 0),
        columns: recordNumber(record, 70, 1),
        rows: recordNumber(record, 71, 1),
        hasAttributes: recordNumber(record, 66, 0) !== 0,
    }),
};

function readLightweightVertices(record) {
    const vertices = [];
    for (const [code, value] of record.groups) {
        if (code === 10) {
            if (vertices.length >= MAX_POLYLINE_VERTICES) failDxf('cadLimit');
            vertices.push({ x: parseNumber(value), y: 0, z: 0, startWidth: 0, endWidth: 0, bulge: 0 });
            continue;
        }
        const vertex = vertices.at(-1);
        if (!vertex) continue;
        if (code === 20) vertex.y = parseNumber(value);
        else if (code === 40) vertex.startWidth = parseNumber(value);
        else if (code === 41) vertex.endWidth = parseNumber(value);
        else if (code === 42) vertex.bulge = parseNumber(value);
    }
    return vertices;
}

function readPolyline(record) {
    const flags = recordNumber(record, 70, 0);
    const fitted = Boolean(flags & 6);
    // Curve/spline-fitted polylines also store their control frame; keep only the displayed vertices.
    const vertices = record.vertices
        .filter(vertex => !(fitted && recordNumber(vertex, 70, 0) & 16))
        .map(vertex => ({
            ...(recordPoint(vertex, 10) || failDxf('cadInvalid')),
            startWidth: recordNumber(vertex, 40, 0),
            endWidth: recordNumber(vertex, 41, 0),
            bulge: recordNumber(vertex, 42, 0),
        }));
    return {
        closed: Boolean(flags & 1),
        is3d: Boolean(flags & 8),
        mesh: Boolean(flags & 80),
        constantWidth: Math.max(recordNumber(record, 40, 0), recordNumber(record, 41, 0)),
        elevation: recordPoint(record, 10)?.z || 0,
        vertices,
    };
}
