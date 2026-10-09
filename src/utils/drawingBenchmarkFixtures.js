import { createDrawingHatch } from './drawingHatches.js';
import { createLcadDocument, normalizeLcadDocument } from './lcadDocument.js';

/**
 * Deterministic synthetic roof/PV drawings used to measure editor performance.
 * Each roof section mixes the entity kinds of a typical LUMCAD production plan:
 * associative hatch, block panels, rails, fixings, cable runs, labels and
 * associative dimensions. Sizes are expressed in model-space entities.
 */
export const DRAWING_BENCHMARK_FIXTURES = Object.freeze({
    S: 1_000,
    M: 5_000,
    L: 20_000,
    XL: 50_000,
});

const PANEL_WIDTH = 1.134;
const PANEL_HEIGHT = 1.762;
const PANEL_GAP = 0.02;
const ROWS = 6;
const COLUMNS = 10;
const SECTION_MARGIN = 0.5;
const SECTION_GAP = 3;
const SECTIONS_PER_ROW = 8;
const SECTION_WIDTH = COLUMNS * (PANEL_WIDTH + PANEL_GAP) + 2 * SECTION_MARGIN;
const SECTION_HEIGHT = ROWS * (PANEL_HEIGHT + PANEL_GAP) + 2 * SECTION_MARGIN;
const LAYERS = [
    { id: 'bench-roof', name: 'ROOF', color: '#475569' },
    { id: 'bench-pv', name: 'PV', color: '#1d4ed8' },
    { id: 'bench-rails', name: 'RAILS', color: '#64748b' },
    { id: 'bench-cables', name: 'CABLES', color: '#dc2626' },
    { id: 'bench-text', name: 'TEXT', color: '#172033' },
];

export function drawingBenchmarkSectionEntityCount() {
    return createRoofSection(0, 0, 0).length;
}

export function createDrawingBenchmarkDocument(size = 'M') {
    const target = typeof size === 'number' ? size : DRAWING_BENCHMARK_FIXTURES[size];
    if (!Number.isInteger(target) || target <= 0) throw new Error(`Unknown benchmark fixture: ${size}`);
    const document = createLcadDocument({ name: `Benchmark ${size}` });
    const sections = Math.max(1, Math.ceil(target / drawingBenchmarkSectionEntityCount()));
    const entities = [];
    for (let index = 0; index < sections; index += 1) {
        const originX = (index % SECTIONS_PER_ROW) * (SECTION_WIDTH + SECTION_GAP);
        const originY = Math.floor(index / SECTIONS_PER_ROW) * (SECTION_HEIGHT + SECTION_GAP);
        entities.push(...createRoofSection(index, originX, originY));
    }
    return normalizeLcadDocument({
        ...document,
        id: `bench-${size}`,
        content: {
            ...document.content,
            layers: [...document.content.layers, ...LAYERS],
            blocks: [createPanelBlock(), createJunctionBoxBlock()],
            entities,
        },
    });
}

function createPanelBlock() {
    const layerId = 'bench-pv';
    return {
        id: 'bench-block-panel',
        name: 'PV_PANEL',
        basePoint: { x: 0, y: 0 },
        entities: [
            { id: 'panel-frame', type: 'rectangle', layerId, x: 0, y: 0, width: PANEL_WIDTH, height: PANEL_HEIGHT, rotation: 0, cornerStyle: 'square', cornerValue: 0 },
            { id: 'panel-cell-1', type: 'line', layerId, x1: 0, y1: PANEL_HEIGHT / 3, x2: PANEL_WIDTH, y2: PANEL_HEIGHT / 3 },
            { id: 'panel-cell-2', type: 'line', layerId, x1: 0, y1: 2 * PANEL_HEIGHT / 3, x2: PANEL_WIDTH, y2: 2 * PANEL_HEIGHT / 3 },
            { id: 'panel-cell-3', type: 'line', layerId, x1: PANEL_WIDTH / 2, y1: 0, x2: PANEL_WIDTH / 2, y2: PANEL_HEIGHT },
        ],
    };
}

function createJunctionBoxBlock() {
    const layerId = 'bench-cables';
    return {
        id: 'bench-block-junction',
        name: 'JUNCTION_BOX',
        basePoint: { x: 0, y: 0 },
        entities: [
            { id: 'box-frame', type: 'rectangle', layerId, x: -0.2, y: -0.15, width: 0.4, height: 0.3, rotation: 0, cornerStyle: 'square', cornerValue: 0 },
            { id: 'box-terminal', type: 'circle', layerId, cx: 0, cy: 0, r: 0.08 },
        ],
    };
}

function createRoofSection(index, originX, originY) {
    const id = name => `bench-${index}-${name}`;
    const outline = {
        id: id('outline'), type: 'rectangle', layerId: 'bench-roof',
        x: originX, y: originY, width: SECTION_WIDTH, height: SECTION_HEIGHT,
        rotation: 0, cornerStyle: 'square', cornerValue: 0,
    };
    const hatch = createDrawingHatch([outline], 'bench-roof', { name: 'lines', spacing: 0.5, angle: 45 }, id('hatch'));
    const entities = [outline, hatch];
    for (let row = 0; row < ROWS; row += 1) {
        const rowY = originY + SECTION_MARGIN + row * (PANEL_HEIGHT + PANEL_GAP);
        const startX = originX + SECTION_MARGIN;
        const endX = startX + COLUMNS * (PANEL_WIDTH + PANEL_GAP) - PANEL_GAP;
        const railIds = [];
        for (const [railIndex, ratio] of [0.25, 0.75].entries()) {
            const railId = id(`rail-${row}-${railIndex}`);
            railIds.push(railId);
            const y = rowY + PANEL_HEIGHT * ratio;
            entities.push({ id: railId, type: 'line', layerId: 'bench-rails', x1: startX - 0.1, y1: y, x2: endX + 0.1, y2: y });
            for (let column = 0; column < COLUMNS; column += 2) {
                const x = startX + column * (PANEL_WIDTH + PANEL_GAP) + PANEL_WIDTH;
                entities.push({ id: id(`fixing-${row}-${railIndex}-${column}`), type: 'circle', layerId: 'bench-rails', cx: x, cy: y, r: 0.04 });
            }
        }
        for (let column = 0; column < COLUMNS; column += 1) {
            entities.push({
                id: id(`panel-${row}-${column}`), type: 'blockReference', blockId: 'bench-block-panel', layerId: 'bench-pv',
                transform: { a: 1, b: 0, c: 0, d: 1, e: startX + column * (PANEL_WIDTH + PANEL_GAP), f: rowY },
            });
        }
        const cableY = rowY + PANEL_HEIGHT * 0.5;
        const points = Array.from({ length: COLUMNS + 2 }, (_, step) => ({
            x: startX + step * (PANEL_WIDTH + PANEL_GAP) - PANEL_GAP,
            y: cableY + (step % 2 ? 0.08 : -0.08),
        }));
        entities.push({ id: id(`cable-${row}`), type: 'polyline', layerId: 'bench-cables', points, closed: false });
        const last = points.at(-1);
        entities.push({
            id: id(`bend-${row}`), type: 'arc', layerId: 'bench-cables',
            cx: last.x, cy: last.y + 0.3, r: 0.3, startAngle: -Math.PI / 2, endAngle: Math.PI / 2, counterClockwise: true,
        });
        entities.push({
            id: id(`label-${row}`), type: 'text', layerId: 'bench-text', x: startX - 0.45, y: cableY,
            text: `S${index + 1}.${row + 1}`, fontSize: 0.18, textMode: 'singleLine', wrapMode: 'none', width: 0.8, height: 0.25,
        });
        if (row === 0) entities.push({ id: id('dimension-rail'), type: 'linearDimension', layerId: 'dimensions', sourceId: railIds[0], offset: -0.6 });
    }
    entities.push({
        id: id('junction'), type: 'blockReference', blockId: 'bench-block-junction', layerId: 'bench-cables',
        transform: { a: 1, b: 0, c: 0, d: 1, e: originX + SECTION_WIDTH - 0.3, f: originY + SECTION_HEIGHT / 2 },
    });
    entities.push({
        id: id('title'), type: 'text', layerId: 'bench-text', x: originX, y: originY + SECTION_HEIGHT + 0.3,
        text: `Roof section ${index + 1}`, fontSize: 0.35, textMode: 'singleLine', wrapMode: 'none', width: 3.6, height: 0.5,
    });
    entities.push({
        id: id('dimension-width'), type: 'linearDimension', layerId: 'dimensions',
        p1: { x: originX, y: originY }, p2: { x: originX + SECTION_WIDTH, y: originY }, offset: -1.1,
    });
    entities.push({
        id: id('dimension-height'), type: 'linearDimension', layerId: 'dimensions', measurementMode: 'vertical',
        p1: { x: originX, y: originY }, p2: { x: originX, y: originY + SECTION_HEIGHT }, offset: -1.1,
    });
    return entities;
}
