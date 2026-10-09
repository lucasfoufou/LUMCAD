// Uniform-grid index over item bounding boxes. Queries return item indexes in
// their original order so callers keep the tie-breaking of a linear scan.
// Items without finite bounds (null), or covering too many cells, are always
// returned: the index may over-report candidates but never misses one.
const MAX_CELLS_PER_ITEM = 64;
const MAX_GRID_CELLS = 1 << 20;

export function createDrawingSpatialIndex(items, boundsOf) {
    const bounds = items.map(item => finiteBounds(boundsOf(item)));
    const extent = bounds.reduce((combined, current) => current ? unionBounds(combined, current) : combined, null);
    const unbounded = [];
    const cells = new Map();
    let cellSize = 1;
    let columns = 1;
    let rows = 1;
    if (extent) {
        const width = Math.max(extent.maxX - extent.minX, 1e-9);
        const height = Math.max(extent.maxY - extent.minY, 1e-9);
        const bounded = bounds.filter(Boolean).length;
        cellSize = Math.max(Math.sqrt(width * height / Math.max(1, bounded)), Math.max(width, height) / 4096, 1e-9);
        columns = Math.min(Math.ceil(width / cellSize) + 1, MAX_GRID_CELLS);
        rows = Math.min(Math.ceil(height / cellSize) + 1, Math.floor(MAX_GRID_CELLS / columns) || 1);
    }
    const column = x => Math.min(columns - 1, Math.max(0, Math.floor((x - extent.minX) / cellSize)));
    const row = y => Math.min(rows - 1, Math.max(0, Math.floor((y - extent.minY) / cellSize)));
    bounds.forEach((current, index) => {
        if (!current) {
            unbounded.push(index);
            return;
        }
        const minColumn = column(current.minX);
        const maxColumn = column(current.maxX);
        const minRow = row(current.minY);
        const maxRow = row(current.maxY);
        if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > MAX_CELLS_PER_ITEM) {
            unbounded.push(index);
            return;
        }
        for (let y = minRow; y <= maxRow; y += 1) {
            for (let x = minColumn; x <= maxColumn; x += 1) {
                const key = y * columns + x;
                const cell = cells.get(key);
                if (cell) cell.push(index);
                else cells.set(key, [index]);
            }
        }
    });
    const marks = new Uint32Array(items.length);
    let stamp = 0;
    return {
        size: items.length,
        query(area) {
            const target = finiteBounds(area);
            if (!target) return items.map((_, index) => index);
            stamp += 1;
            if (stamp === 0xffffffff) {
                marks.fill(0);
                stamp = 1;
            }
            const result = [];
            const add = index => {
                if (marks[index] === stamp) return;
                marks[index] = stamp;
                const current = bounds[index];
                if (!current || intersects(current, target)) result.push(index);
            };
            unbounded.forEach(add);
            if (extent && intersects(extent, target)) {
                for (let y = row(target.minY); y <= row(target.maxY); y += 1) {
                    for (let x = column(target.minX); x <= column(target.maxX); x += 1) {
                        cells.get(y * columns + x)?.forEach(add);
                    }
                }
            }
            return result.sort((left, right) => left - right);
        },
    };
}

function finiteBounds(bounds) {
    if (!bounds) return null;
    const { minX, minY, maxX, maxY } = bounds;
    return [minX, minY, maxX, maxY].every(Number.isFinite) && minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

function unionBounds(combined, bounds) {
    if (!combined) return { ...bounds };
    return {
        minX: Math.min(combined.minX, bounds.minX),
        minY: Math.min(combined.minY, bounds.minY),
        maxX: Math.max(combined.maxX, bounds.maxX),
        maxY: Math.max(combined.maxY, bounds.maxY),
    };
}

function intersects(left, right) {
    return left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;
}

/**
 * Small most-recently-used cache for indexes derived from immutable document
 * content. Keys are arrays compared item by item, so they can combine the
 * collections an index depends on. A WeakMap would keep one index alive per
 * history snapshot; callers only query the few contents currently on screen.
 */
export function createDrawingIndexCache(capacity = 4) {
    const entries = [];
    return (key, build) => {
        const position = entries.findIndex(entry => entry.key.length === key.length && entry.key.every((part, index) => part === key[index]));
        if (position >= 0) {
            const [entry] = entries.splice(position, 1);
            entries.unshift(entry);
            return entry.value;
        }
        const value = build();
        entries.unshift({ key, value });
        entries.length = Math.min(entries.length, capacity);
        return value;
    };
}
