// Uniform-grid index over item bounding boxes. Queries return item indexes in
// their original order so callers keep the tie-breaking of a linear scan.
// Items without finite bounds (null), or covering too many cells, are always
// returned: the index may over-report candidates but never misses one.
const MAX_CELLS_PER_ITEM = 64;
const MAX_GRID_CELLS = 1 << 20;
const STATE = Symbol('drawingSpatialIndexState');

/**
 * Builds an index, or derives it from `previous` (an index over an earlier
 * version of the same collection) when only a few items changed. Items are
 * compared by identity: an unchanged item keeps its position and its bounds.
 * `refresh(item)` marks items whose bounds depend on other items (associative
 * dimensions, for example); their bounds are recomputed on every derivation.
 */
export function createDrawingSpatialIndex(items, boundsOf, { previous = null, refresh = null } = {}) {
    const state = previous?.[STATE] && deriveState(previous[STATE], items, boundsOf, refresh);
    return createIndex(state || buildState(items, boundsOf));
}

function buildState(items, boundsOf) {
    const bounds = items.map(item => finiteBounds(boundsOf(item)));
    const extent = bounds.reduce((combined, current) => current ? unionBounds(combined, current) : combined, null);
    const grid = { extent, cellSize: 1, columns: 1, rows: 1 };
    if (extent) {
        const width = Math.max(extent.maxX - extent.minX, 1e-9);
        const height = Math.max(extent.maxY - extent.minY, 1e-9);
        const bounded = bounds.filter(Boolean).length;
        grid.cellSize = Math.max(Math.sqrt(width * height / Math.max(1, bounded)), Math.max(width, height) / 4096, 1e-9);
        grid.columns = Math.min(Math.ceil(width / grid.cellSize) + 1, MAX_GRID_CELLS);
        grid.rows = Math.min(Math.ceil(height / grid.cellSize) + 1, Math.floor(MAX_GRID_CELLS / grid.columns) || 1);
    }
    const unbounded = [];
    // `owned` lists the arrays this state may write; arrays shared with an
    // earlier index are copied first. It is dropped once construction ends.
    const state = { items, bounds, grid, cells: new Map(), unbounded, owned: new Set([unbounded]) };
    bounds.forEach((current, index) => place(state, index, current));
    state.owned = null;
    return state;
}

// An edit typically appends, replaces or removes a few entities. Beyond this
// share of changes (or when added items fall outside the grid too often) a
// rebuild is cheaper and keeps the grid balanced.
function deriveState(previous, items, boundsOf, refresh) {
    const { items: before } = previous;
    const limit = Math.max(64, items.length >> 6);
    if (Math.abs(items.length - before.length) > limit) return null;
    const changed = [];
    const common = Math.min(items.length, before.length);
    let identityChanges = 0;
    for (let index = 0; index < common; index += 1) {
        if (items[index] !== before[index]) {
            identityChanges += 1;
            if (identityChanges > limit) return null;
            changed.push(index);
        } else if (refresh?.(items[index])) changed.push(index);
    }
    const state = {
        items,
        bounds: previous.bounds.slice(0, items.length),
        grid: previous.grid,
        cells: new Map(previous.cells),
        unbounded: previous.unbounded,
        owned: new Set(),
    };
    const removedTail = [];
    for (let index = items.length; index < before.length; index += 1) removedTail.push(index);
    for (const index of [...changed, ...removedTail]) unplace(state, index, previous.bounds[index]);
    for (const index of changed) {
        state.bounds[index] = finiteBounds(boundsOf(items[index]));
        place(state, index, state.bounds[index]);
    }
    for (let index = before.length; index < items.length; index += 1) {
        state.bounds[index] = finiteBounds(boundsOf(items[index]));
        place(state, index, state.bounds[index]);
    }
    if (state.unbounded.length > previous.unbounded.length + limit) return null;
    state.owned = null;
    return state;
}

function cellRange(grid, current) {
    const { extent, cellSize, columns, rows } = grid;
    if (!current || !extent || !insideExtent(extent, current)) return null;
    const minColumn = Math.floor((current.minX - extent.minX) / cellSize);
    const maxColumn = Math.min(columns - 1, Math.floor((current.maxX - extent.minX) / cellSize));
    const minRow = Math.floor((current.minY - extent.minY) / cellSize);
    const maxRow = Math.min(rows - 1, Math.floor((current.maxY - extent.minY) / cellSize));
    if ((maxColumn - minColumn + 1) * (maxRow - minRow + 1) > MAX_CELLS_PER_ITEM) return null;
    return { minColumn, maxColumn, minRow, maxRow };
}

// Items outside the original extent (added after the build) cannot be located
// in the grid, so they join the always-returned list.
function place(state, index, current) {
    const range = cellRange(state.grid, current);
    if (!range) {
        writableUnbounded(state).push(index);
        return;
    }
    for (let y = range.minRow; y <= range.maxRow; y += 1) {
        for (let x = range.minColumn; x <= range.maxColumn; x += 1) {
            const key = y * state.grid.columns + x;
            const cell = state.cells.get(key);
            if (!cell) {
                const created = [index];
                state.cells.set(key, created);
                state.owned.add(created);
            } else writableCell(state, key, cell).push(index);
        }
    }
}

function unplace(state, index, current) {
    const range = cellRange(state.grid, current);
    if (!range) {
        const unbounded = writableUnbounded(state);
        const position = unbounded.indexOf(index);
        if (position >= 0) unbounded.splice(position, 1);
        return;
    }
    for (let y = range.minRow; y <= range.maxRow; y += 1) {
        for (let x = range.minColumn; x <= range.maxColumn; x += 1) {
            const key = y * state.grid.columns + x;
            const cell = state.cells.get(key);
            if (!cell) continue;
            const writable = writableCell(state, key, cell);
            const position = writable.indexOf(index);
            if (position >= 0) writable.splice(position, 1);
        }
    }
}

function writableCell(state, key, cell) {
    if (state.owned.has(cell)) return cell;
    const copy = cell.slice();
    state.cells.set(key, copy);
    state.owned.add(copy);
    return copy;
}

function writableUnbounded(state) {
    if (!state.owned.has(state.unbounded)) {
        state.unbounded = state.unbounded.slice();
        state.owned.add(state.unbounded);
    }
    return state.unbounded;
}

function createIndex(state) {
    const { items, bounds, cells, unbounded, grid: { extent, cellSize, columns, rows } } = state;
    const column = x => Math.min(columns - 1, Math.max(0, Math.floor((x - extent.minX) / cellSize)));
    const row = y => Math.min(rows - 1, Math.max(0, Math.floor((y - extent.minY) / cellSize)));
    const marks = new Uint32Array(items.length);
    let stamp = 0;
    return {
        [STATE]: state,
        size: items.length,
        /** Whether `area` contains every indexed item, so a query would return all of them. */
        covers(area) {
            const target = finiteBounds(area);
            if (!target) return true;
            const inside = current => !current || (target.minX <= current.minX && target.minY <= current.minY
                && target.maxX >= current.maxX && target.maxY >= current.maxY);
            // Items without bounds are always returned; listed items with bounds must fit too.
            return inside(extent) && unbounded.every(index => inside(bounds[index]));
        },
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

function insideExtent(extent, bounds) {
    return bounds.minX >= extent.minX && bounds.minY >= extent.minY && bounds.maxX <= extent.maxX && bounds.maxY <= extent.maxY;
}

/**
 * Small most-recently-used cache for indexes derived from immutable document
 * content. Keys are arrays compared item by item, so they can combine the
 * collections an index depends on. A WeakMap would keep one index alive per
 * history snapshot; callers only query the few contents currently on screen.
 * On a miss, `build` receives the most recently used value, from which an
 * index over a slightly edited collection can be derived.
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
        const value = build(entries[0]?.value ?? null);
        entries.unshift({ key, value });
        entries.length = Math.min(entries.length, capacity);
        return value;
    };
}
