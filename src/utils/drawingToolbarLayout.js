// Pure layout rules of the tool rail, kept out of React so they can be tested.

export const TOOLBAR_SLOT_SIZE = 34;
export const TOOLBAR_GROUP_GAP = 9;
export const TOOLBAR_PADDING = 12;

/**
 * Height the rail needs to show every slot of `groupSizes` in `columns` columns.
 * Each group starts a new row and is separated from the previous one.
 */
export function toolbarContentHeight(groupSizes, columns = 1) {
    const sizes = groupSizes.filter(size => size > 0);
    const rows = sizes.reduce((total, size) => total + Math.ceil(size / columns), 0);
    return rows * TOOLBAR_SLOT_SIZE + Math.max(0, sizes.length - 1) * TOOLBAR_GROUP_GAP + TOOLBAR_PADDING;
}

/**
 * Chooses one column when every tool fits in `availableHeight`, otherwise two
 * columns. `overflow` tells whether the chosen layout still has to scroll.
 */
export function resolveToolbarLayout(groupSizes, availableHeight) {
    const height = Number(availableHeight);
    if (!Number.isFinite(height) || height <= 0) return { columns: 1, overflow: false };
    if (toolbarContentHeight(groupSizes, 1) <= height) return { columns: 1, overflow: false };
    return { columns: 2, overflow: toolbarContentHeight(groupSizes, 2) > height };
}

/**
 * Identifier the rail compares with its items to mark the running operation:
 * the operation type, refined by its mode for inquiries (`inquiry:distance`)
 * and its kind for arrays (`arrayPolar`, `arrayPath`).
 */
export function resolveToolbarActiveOperation(operation) {
    if (!operation?.type) return null;
    if (operation.arrayKind === 'path') return 'arrayPath';
    if (operation.arrayKind === 'polar') return 'arrayPolar';
    if (operation.type === 'inquiry' && operation.mode) return `inquiry:${operation.mode}`;
    return operation.type;
}
