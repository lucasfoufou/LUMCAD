// Bounded ASCII DXF reader for the supported 2D interchange subset.
//
// The reader walks the group-code pairs once and returns plain records: header
// units, layer table entries, block definitions and entities. It never skips a
// graphical record silently: entity types outside SUPPORTED_DXF_ENTITIES are
// returned as `{ type, unsupported: true }` so that the importer decides how to
// refuse or report them.

export const CAD_FILE_LIMIT = 128 * 1024 * 1024;
export const DXF_MAX_ENTITIES = 500000;
const MAX_GROUP_LINES = 16000000;
const MAX_POLYLINE_VERTICES = 4096;
const NUMBER_PATTERN = /^\s*[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?\s*$/;
const STRING_CODES = new Set([1, 3]);

export const SUPPORTED_DXF_ENTITIES = Object.freeze(['LINE', 'POINT', 'CIRCLE', 'ARC', 'ELLIPSE', 'SPLINE',
    'LWPOLYLINE', 'POLYLINE', 'TEXT', 'MTEXT', 'INSERT', 'ATTRIB', 'ATTDEF', 'DIMENSION', 'SOLID', 'TRACE', 'HATCH', 'WIPEOUT', 'LEADER', 'MULTILEADER']);
const SUPPORTED = new Set(SUPPORTED_DXF_ENTITIES);

export function failDxf(code, detail = '') {
    const error = new Error(code);
    error.detail = detail;
    throw error;
}

export function readDrawingDxf(text) {
    const groups = splitGroups(text);
    const result = { header: Object.create(null), layers: new Map(), blocks: new Map(), entities: [], hasEntities: false, drawOrder: new Map() };
    const cursor = { groups, next: groups.next(), entityCount: 0 };
    while (!cursor.next.done) {
        const [code, value] = cursor.next.value;
        if (code !== 0) failDxf('cadInvalid');
        if (value === 'EOF') {
            nextGroup(cursor);
            if (!cursor.next.done) failDxf('cadInvalid');
            return finishRead(result);
        }
        if (value !== 'SECTION') failDxf('cadInvalid');
        nextGroup(cursor);
        const name = nextGroup(cursor);
        if (!name || name[0] !== 2) failDxf('cadInvalid');
        readSection(cursor, name[1], result);
    }
    return failDxf('cadInvalid');
}

function finishRead(result) {
    if (!result.hasEntities) failDxf('cadInvalid');
    const names = new Map([...result.blocks.values()].map(block => [block.handle, block.name]));
    const resolve = entities => {
        for (const entity of entities) if (entity.type === 'MULTILEADER') entity.name = names.get(recordValue(entity, 341));
        if (!entities.some(entity => result.drawOrder.has(entity.owner))) return;
        const ordered = entities.map((entity, index) => {
            const handle = result.drawOrder.get(entity.owner)?.get(entity.handle) ?? entity.handle;
            if (!handle || !/^[\da-f]{1,32}$/i.test(handle)) failDxf('cadInvalid');
            const value = BigInt(`0x${handle}`);
            return { entity, index, key: value === 0n ? 1n << 128n : value };
        });
        ordered.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index);
        entities.splice(0, entities.length);
        for (const { entity } of ordered) entities.push(entity);
    };
    resolve(result.entities);
    for (const block of result.blocks.values()) resolve(block.entities);
    return result;
}

function* splitGroups(text) {
    if (typeof text !== 'string' || text.length > CAD_FILE_LIMIT) failDxf('cadLimit');
    // Keep only the current record in memory. A customer DWG can expand to
    // millions of DXF groups, most of which belong to unused application data.
    const lines = text.replace(/^﻿/, '').trimEnd().matchAll(/([^\r\n]*)(?:\r\n|\n|\r|$)/g);
    let count = 0;
    for (;;) {
        const first = lines.next();
        if (first.done || first.value[0] === '') return;
        const second = lines.next();
        if (second.done || !/^\s*\d+\s*$/.test(first.value[1])) failDxf('cadInvalid');
        count += 2;
        if (count > MAX_GROUP_LINES) failDxf('cadLimit');
        const code = Number(first.value[1]);
        if (code > 1071) failDxf('cadInvalid');
        if (code === 999) continue;
        const raw = second.value[1];
        yield [code, STRING_CODES.has(code) ? raw : raw.trim()];
    }
}

function readSection(cursor, name, result) {
    if (name === 'HEADER') readHeader(cursor, result.header);
    else if (name === 'TABLES') readTables(cursor, result.layers);
    else if (name === 'BLOCKS') readBlocks(cursor, result);
    else if (name === 'OBJECTS') readObjects(cursor, result);
    else if (name === 'ENTITIES') {
        result.hasEntities = true;
        result.entities = result.entities.concat(readEntities(cursor, 'ENDSEC'));
    } else skipRecords(cursor, 'ENDSEC');
    expectRecord(cursor, 'ENDSEC');
}

/** SORTENTSTABLE maps entity handles to redraw handles within a block record. */
function readObjects(cursor, result) {
    let pairs = 0;
    const dictionaries = new Map(); const tables = [];
    while (!atRecord(cursor, 'ENDSEC')) {
        const record = nextRecord(cursor);
        if (record.type === 'DICTIONARY' && record.groups.some(([code, value]) => code === 3 && value === 'ACAD_SORTENTS')) {
            dictionaries.set(recordValue(record, 5), recordValue(record, 330));
        }
        if (record.type !== 'SORTENTSTABLE') continue;
        const start = record.groups.findIndex(([code, value]) => code === 100 && value === 'AcDbSortentsTable');
        if (start < 0) failDxf('cadInvalid');
        let owner = null; let entity = null; const mapping = new Map();
        for (const [code, value] of record.groups.slice(start + 1)) {
            if (code === 330) owner = value;
            else if (code === 331) {
                if (entity) failDxf('cadInvalid');
                entity = value;
            }
            else if (code === 5) {
                if (!entity || !/^[\da-f]{1,32}$/i.test(value)) failDxf('cadInvalid');
                if (++pairs > DXF_MAX_ENTITIES) failDxf('cadLimit');
                mapping.set(entity, value); entity = null;
            }
        }
        if (entity) failDxf('cadInvalid');
        if (mapping.size) tables.push({ owner, dictionary: recordValue(record, 330), mapping });
    }
    for (const table of tables) {
        // LibreDWG omits the optional block-record pointer; its extension
        // dictionary still identifies the owning model space/block.
        const owner = table.owner || dictionaries.get(table.dictionary);
        if (!owner) failDxf('cadInvalid');
        result.drawOrder.set(owner, table.mapping);
    }
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
            handle: recordValue(record, 330),
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
        const entity = SUPPORTED.has(record.type) ? describeEntity(record) : describeUnsupported(record);
        const handle = recordValue(record, 5); const owner = recordValue(record, 330);
        if (handle) entity.handle = handle;
        if (owner) entity.owner = owner;
        entities.push(entity);
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
    while (!atRecord(cursor, terminator)) nextGroup(cursor);
}

function atRecord(cursor, type) {
    const group = cursor.next.value;
    if (!group) failDxf('cadInvalid');
    return group[0] === 0 && group[1] === type;
}

/** Consumes a terminator record such as ENDBLK or SEQEND, including its own groups. */
function expectRecord(cursor, type) {
    if (!atRecord(cursor, type)) failDxf('cadInvalid');
    nextRecord(cursor);
}

function nextGroup(cursor) {
    const group = cursor.next.value;
    if (!group) failDxf('cadInvalid');
    cursor.next = cursor.groups.next();
    return group;
}

/** Collects one record, dropping XDATA, 102 application groups and embedded objects. */
function nextRecord(cursor) {
    const [code, type] = nextGroup(cursor);
    if (code !== 0) failDxf('cadInvalid');
    const groups = [];
    let applicationGroup = false;
    let embedded = false;
    while (!cursor.next.done && cursor.next.value[0] !== 0) {
        const group = nextGroup(cursor);
        if (group[0] === 102) applicationGroup = group[1].startsWith('{');
        else if (group[0] === 101) embedded = true;
        else if (!applicationGroup && !embedded && group[0] < 1000) groups.push(group);
    }
    return { type, groups };
}

export function recordValue(record, code) {
    return record.groups.find(group => group[0] === code)?.[1];
}

function parseNumber(value) {
    if (!NUMBER_PATTERN.test(value)) failDxf('cadInvalid');
    const number = Number(value);
    if (!Number.isFinite(number)) failDxf('cadInvalid');
    return number;
}

export function recordNumber(record, code, fallback) {
    const value = recordValue(record, code);
    return value === undefined ? fallback : parseNumber(value);
}

export function recordPoint(record, code) {
    const x = recordValue(record, code);
    if (x === undefined) return null;
    return { x: parseNumber(x), y: recordNumber(record, code + 10, 0), z: recordNumber(record, code + 20, 0) };
}

/** Repeated point groups such as SPLINE control points, in file order. */
export function recordPointList(record, code) {
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
        transparency: recordNumber(record, 440, 0),
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
        horizontalAlignment: recordNumber(record, 72, 0),
        verticalAlignment: recordNumber(record, record.type === 'ATTRIB' || record.type === 'ATTDEF' ? 74 : 73, 0),
        alignmentPoint: recordPoint(record, 11),
        oblique: recordNumber(record, 51, 0),
        text: recordValue(record, 1) ?? '',
    }),
    MTEXT: record => {
        const direction = recordPoint(record, 11);
        return {
            position: recordPoint(record, 10),
            height: recordNumber(record, 40, NaN),
            width: recordNumber(record, 41, 0),
            direction,
            rotationDefined: recordValue(record, 50) !== undefined,
            rotation: direction && Math.hypot(direction.x, direction.y, direction.z) > 0
                ? Math.atan2(direction.y, direction.x) * 180 / Math.PI : recordNumber(record, 50, 0),
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
    ATTRIB: record => ({ ...ENTITY_READERS.TEXT(record), attributeFlags: recordNumber(record, 70, 0) }),
    ATTDEF: record => ({ ...ENTITY_READERS.TEXT(record), attributeFlags: recordNumber(record, 70, 0) }),
    DIMENSION: record => ({ name: recordValue(record, 2), position: recordPoint(record, 12) || { x: 0, y: 0, z: 0 },
        xScale: 1, yScale: 1, rows: 1, columns: 1, rotation: 0 }),
    SOLID: record => ({ corners: [10, 11, 13, 12].map(code => recordPoint(record, code)) }),
    TRACE: record => ENTITY_READERS.SOLID(record),
    HATCH: record => ({ groups: record.groups, elevation: recordNumber(record, 30, 0) }),
    WIPEOUT: record => ({ groups: record.groups }),
    LEADER: record => ({ vertices: recordPointList(record, 10), arrow: recordNumber(record, 71, 1) !== 0 }),
    MULTILEADER: record => ({ groups: record.groups }),
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
