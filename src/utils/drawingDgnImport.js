import { addLayer, canEditEntity, createDrawingId } from './drawingDocument.js';
import { buildDrawingEntity } from './drawingEntityFactory.js';
import { normalizeDrawingHatch } from './drawingAdvancedEntities.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { extractEntityPaths } from './drawingCurveKernel.js';
import { getEntityBounds } from './drawingGeometry.js';
import { readDrawingDgnRecords } from './drawingDgnRecords.js';
import { readDrawingDgnElementGeometry } from './drawingDgnGeometry.js';
import { readDrawingDgnPalette } from './drawingDgnPalette.js';
import { readDrawingDgnLinkages, drawingDgnFillIndex } from './drawingDgnLinkages.js';
import { resolveDrawingDgnUnits } from './drawingDgnUnits.js';
import { drawingDgnTextEntity } from './drawingDgnText.js';
import { drawingAffineFrame } from './drawingAffineFrame.js';
import { readDrawingDgnComplex } from './drawingDgnComplex.js';
import { readDrawingDgnCell } from './drawingDgnCells.js';
import { drawingDgnGroupedHole } from './drawingDgnHoles.js';
import { drawingDgnCellBlocks } from './drawingDgnCellBlocks.js';

/** Build a complete native candidate. The caller commits once through document history. */
export function importDrawingDgn(document, bytes, { unit = null, x = 0, y = 0, scale = 1, cellMode = 'blocks',
    maxEntities = 100000, maxPoints = 1000000, maxCharacters = 1000000, ...limits } = {}) {
    if (![x, y, scale].every(Number.isFinite) || scale <= 0 || scale > 1e9) throw new Error('dgnPlacement');
    if (!['blocks', 'explode'].includes(cellMode)) throw new Error('dgnSyntax');
    if (![maxEntities, maxPoints, maxCharacters].every(value => Number.isSafeInteger(value) && value > 0)
        || maxEntities > 100000 || maxPoints > 1000000 || maxCharacters > 1000000) throw new Error('dgnLimit');
    const original = document.content;
    if (!canEditEntity(original, { layerId: original.activeLayerId })) throw new Error('dgnLayer');
    const { records, header } = readDrawingDgnRecords(bytes, limits);
    if (header.dimension !== 2) throw new Error('dgnUnsupported');
    const units = resolveDrawingDgnUnits(header, unit); const factor = units.metresPerMaster * scale;
    if (!Number.isFinite(factor) || factor < 1e-12 || factor > 1e9) throw new Error('dgnPlacement');
    const palette = readDrawingDgnPalette(records); const warnings = new Set();
    const appearance = primitive => {
        if (primitive.style || primitive.weight > 1) warnings.add('strokeAppearance');
        return { color: palette.colors[primitive.colorIndex], lineWidth: Math.max(1, primitive.weight),
            lineType: primitive.style === 0 ? 'continuous' : primitive.style === 1 ? 'dotted' : 'dashed' };
    };
    const primitives = []; const cellGroups = []; let pointsRead = 0; let charactersRead = 0;
    const prepareComplex = group => {
        const primitive = group.parent;
        if (group.adjusted) warnings.add('curveJunctions');
        for (const child of group.children) {
            if (child.graphicGroup !== primitive.graphicGroup) throw new Error('dgnUnsupported');
            const links = readDrawingDgnLinkages(child.attributes);
            if (links.some(link => link.type !== 'dmrs')) throw new Error('dgnUnsupported');
            if (links.length) warnings.add('databaseLinks');
            if (child.properties & 0x100) warnings.add('objectLocks');
        }
        return { ...primitive, geometry: { ...primitive.geometry,
            parts: primitive.geometry.parts.map((part, partIndex) => ({ ...part,
                ...appearance(group.children[group.partSources[partIndex]]) })) } };
    };
    const appendPrimitive = (primitive, complexPoints = 0, cells = [], outlineOnly = false) => {
        if (primitive.complex || primitive.properties & 0x8000) throw new Error('dgnUnsupported');
        const links = readDrawingDgnLinkages(primitive.attributes);
        if (links.some(link => !['dmrs', 0x41].includes(link.type))) throw new Error('dgnUnsupported');
        if (links.some(link => link.type === 'dmrs')) warnings.add('databaseLinks');
        const fill = drawingDgnFillIndex(links);
        if (fill !== null && !(primitive.geometry.closed || primitive.geometry.fullEllipse)) throw new Error('dgnUnsupported');
        if (primitive.properties & 0x100) warnings.add('objectLocks');
        pointsRead += complexPoints || (primitive.geometry.points?.length ?? 2);
        charactersRead += primitive.geometry.text?.length || 0;
        if (pointsRead > maxPoints || charactersRead > maxCharacters || primitives.length >= maxEntities) throw new Error('dgnLimit');
        primitives.push({ ...primitive, fill: outlineOnly ? null : fill, cells });
    };
    const appendCell = (node, ancestors = []) => {
        const { cell } = node;
        if (cell.properties & 0x8000) throw new Error('dgnUnsupported');
        const links = readDrawingDgnLinkages(cell.attributes);
        if (links.some(link => link.type !== 'dmrs')) throw new Error('dgnUnsupported');
        if (links.length) warnings.add('databaseLinks');
        if (cell.properties & 0x100) warnings.add('objectLocks');
        if (cellGroups.length >= 10000) throw new Error('dgnLimit');
        const group = { name: cell.geometry.name || 'DGN', graphicGroup: cell.graphicGroup, entityIds: [],
            origin: cell.geometry.origin, level: cell.level, parent: ancestors.at(-1) || null };
        cellGroups.push(group); const cells = [...ancestors, group];
        warnings.add(cellMode === 'explode' ? 'cellGroups' : 'cellMetadata');
        const hasHoles = node.children.some(child => (child.primitive || child.complex?.parent)?.properties & 0x8000);
        if (hasHoles) {
            if (node.children.some(child => child.cell)) throw new Error('dgnUnsupported');
            const members = node.children.map(child => child.complex ? prepareComplex(child.complex) : child.primitive);
            const { solid, boundaries } = drawingDgnGroupedHole(members);
            const fill = drawingDgnFillIndex(readDrawingDgnLinkages(solid.attributes));
            if (fill !== null) appendPrimitive({ ...solid, complex: false,
                geometry: { type: 'dgnHoleFill', closed: true, boundaries } }, 0, cells);
            members.forEach((member, index) => appendPrimitive({ ...member, complex: false,
                properties: member.properties & ~0x8000 }, node.children[index].complex?.points || 0, cells, true));
            return;
        }
        for (const child of node.children) {
            if (child.cell) appendCell(child, cells);
            else if (child.complex) appendPrimitive(prepareComplex(child.complex), child.complex.points, cells);
            else appendPrimitive({ ...child.primitive, complex: false }, 0, cells);
        }
    };
    for (let index = 0; index < records.length; index++) {
        const record = records[index];
        if (record.deleted) continue;
        if (record.type === 2) {
            const node = readDrawingDgnCell(records, index, header);
            appendCell(node); index += node.consumed; continue;
        }
        if ([8, 9].includes(record.type)) continue;
        if (record.type === 10) { warnings.add('levelSymbology'); continue; }
        if (record.type === 66) { warnings.add('applicationData'); continue; }
        if (record.type === 5 && [1, 2, 3].includes(record.level)) continue;
        if ([12, 14].includes(record.type)) {
            const group = readDrawingDgnComplex(records, index, header);
            appendPrimitive(prepareComplex(group), group.points); index += group.consumed;
        } else appendPrimitive(readDrawingDgnElementGeometry(record, header));
    }
    if (!primitives.length) throw new Error('dgnEmpty');
    const matrix = { a: factor, b: 0, c: 0, d: -factor, e: x, f: y };
    const entities = []; const levels = new Map(); const groupMembers = new Map();
    let content = original;
    const layerNames = new Set(original.layers.map(layer => layer.name.toLowerCase()));
    const groupNames = new Set((original.groups || []).map(group => group.name.toLowerCase()));
    const uniqueName = (base, names) => {
        let name = base; let suffix = 2;
        while (names.has(name.toLowerCase())) name = `${base} (${suffix++})`;
        names.add(name.toLowerCase()); return name;
    };
    const add = (geometry, layerId, group, cells) => {
        if (original.entities.length + entities.length >= maxEntities) throw new Error('dgnLimit');
        const entity = transformDrawingEntityAffine({ ...geometry, id: createDrawingId(geometry.type), layerId }, matrix);
        if (geometry.type === 'text' && !drawingAffineFrame(entity)) throw new Error('dgnPlacement');
        const bounds = getEntityBounds(entity);
        if (!bounds || !Object.values(bounds).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('dgnPlacement');
        entities.push(entity);
        for (const cell of cells) cell.entityIds.push(entity.id);
        for (const number of [group, ...cells.map(cell => cell.graphicGroup)].filter(Boolean)) {
            if (!groupMembers.has(number)) groupMembers.set(number, new Set());
            groupMembers.get(number).add(entity.id);
        }
    };
    for (const primitive of primitives) {
        if (!levels.has(primitive.level)) {
            content = addLayer(content, uniqueName(`DGN ${primitive.level}`, layerNames));
            levels.set(primitive.level, content.activeLayerId);
        }
        const layerId = levels.get(primitive.level); const raw = primitive.geometry;
        if (raw.type === 'dgnHoleFill') {
            const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries: raw.boundaries,
                color: palette.colors[primitive.fill], pattern: { name: 'solid' }, boundaryStroke: false });
            if (hatch.boundaries.length !== raw.boundaries.length) throw new Error('dgnGeometry');
            add(hatch, layerId, primitive.graphicGroup, primitive.cells);
            continue;
        }
        if (raw.type === 'dgnText') {
            warnings.add('textFont');
            add({ ...drawingDgnTextEntity(raw), color: palette.colors[primitive.colorIndex] }, layerId, primitive.graphicGroup, primitive.cells);
            continue;
        }
        const geometry = raw.type === 'line'
            ? buildDrawingEntity('line', { x: raw.x1, y: raw.y1 }, { x: raw.x2, y: raw.y2 }, layerId) : raw;
        const paths = extractEntityPaths(geometry);
        if (paths.length !== 1) throw new Error('dgnGeometry');
        if (primitive.fill !== null) {
            const hatch = normalizeDrawingHatch({ type: 'hatch', boundaries: paths, color: palette.colors[primitive.fill],
                pattern: { name: 'solid' }, boundaryStroke: false });
            if (hatch.boundaries.length !== 1) throw new Error('dgnGeometry');
            add(hatch, layerId, primitive.graphicGroup, primitive.cells);
        }
        const stroke = appearance(primitive);
        if (primitive.fill === null || primitive.fill !== primitive.colorIndex
            || geometry.parts?.some(part => part.color !== palette.colors[primitive.fill])) {
            add(geometry.parts ? geometry : { ...geometry, ...stroke }, layerId, primitive.graphicGroup, primitive.cells);
        }
    }
    for (const cell of cellGroups) {
        if (!levels.has(cell.level)) {
            content = addLayer(content, uniqueName(`DGN ${cell.level}`, layerNames));
            levels.set(cell.level, content.activeLayerId);
        }
        cell.layerId = levels.get(cell.level);
    }
    const { blocks, replacements } = drawingDgnCellBlocks(original.blocks || [], cellGroups, entities, matrix);
    const importedEntities = cellMode === 'blocks' ? [...new Set(entities.map(entity => replacements.get(entity.id) || entity))] : entities;
    const groupIds = ids => [...new Set([...ids].map(id => cellMode === 'blocks' ? replacements.get(id)?.id || id : id))];
    if ((original.groups?.length || 0) + groupMembers.size + cellGroups.length > 10000) throw new Error('dgnLimit');
    const groups = [...(original.groups || []), ...[...groupMembers].map(([number, entityIds]) => ({
        id: createDrawingId('group'), name: uniqueName(`DGN ${number}`, groupNames), selectable: true, entityIds: groupIds(entityIds),
    })), ...cellGroups.map(group => ({ id: createDrawingId('group'), name: uniqueName(group.name, groupNames),
        selectable: true, entityIds: groupIds(group.entityIds) }))];
    return { ...document, content: { ...content, activeLayerId: original.activeLayerId, groups, blocks,
        entities: [...original.entities, ...importedEntities] }, selectedIds: importedEntities.map(entity => entity.id),
        report: { imported: importedEntities.length, levels: levels.size, sourceElements: primitives.length,
            metresPerMaster: units.metresPerMaster, warnings: [...warnings] } };
}
