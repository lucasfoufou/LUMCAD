import { buildDrawingEntity } from './drawingEntityFactory.js';
import { canEditEntity, createDrawingId } from './drawingDocument.js';

/** Insert a static, editable schedule using the same native text/line entities as drawing tools. */
export function createDrawingSchedule(content, cells, origin, name) {
    if (!Array.isArray(cells) || !cells.length || cells.length > 201 || !cells[0].length || cells[0].length > 8
        || cells.some(row => row.length !== cells[0].length || row.some(cell => typeof cell !== 'string' || cell.length > 256))
        || ![origin?.x, origin?.y].every(Number.isFinite) || !canEditEntity(content, { layerId: content.activeLayerId })) return null;
    const widths = cells[0].map((_, column) => Math.max(1, ...cells.map(row => [...row[column]].length * 0.18 + 0.3)));
    const totalWidth = widths.reduce((sum, value) => sum + value, 0);
    const height = 0.6;
    const entities = [];
    cells.forEach((row, index) => {
        let x = origin.x;
        row.forEach((text, column) => {
            entities.push(buildDrawingEntity('text', { x: x + 0.1, y: origin.y + index * height + 0.1 },
                { x: x + widths[column] - 0.1, y: origin.y + (index + 1) * height - 0.1 }, content.activeLayerId, null,
                { options: { text, textMode: 'singleLine', fontFamily: 'monospace', fontSize: 0.25, bold: index === 0 } }));
            x += widths[column];
        });
    });
    for (let row = 0; row <= cells.length; row += 1) entities.push(buildDrawingEntity('line',
        { x: origin.x, y: origin.y + row * height }, { x: origin.x + totalWidth, y: origin.y + row * height }, content.activeLayerId));
    let x = origin.x;
    for (const width of [...widths, 0]) {
        entities.push(buildDrawingEntity('line', { x, y: origin.y }, { x, y: origin.y + cells.length * height }, content.activeLayerId));
        x += width;
    }
    // Table rules need a readable thin stroke even on a heavy outline layer.
    entities.forEach(entity => { if (entity.type === 'line') { entity.lineWeight = 1; entity.lineType = 'continuous'; } });
    const id = createDrawingId('group');
    const selectedIds = entities.map(entity => entity.id);
    const group = { id, name: `${name} ${id}`, entityIds: selectedIds, selectable: true };
    return { content: { ...content, entities: [...content.entities, ...entities], groups: [...(content.groups || []), group] }, selectedIds };
}
