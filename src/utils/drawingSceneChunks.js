// React 18 places each new host node by scanning its following siblings
// (getHostSibling), so restoring thousands of sibling shapes at once (undo of a
// bulk delete) is quadratic. The scene therefore groups entities, in document
// order, into chunks whose boundaries depend only on entity IDs: an edit changes
// one chunk, and a bulk restore mounts whole chunks whose children are appended
// linearly. Painter order is unchanged because chunks are contiguous.

const CHUNK_BOUNDARY_MODULUS = 128;
const MAX_CHUNK_SIZE = 1024;
const MAX_CACHED_IDS = 500_000;
const boundaryCache = new Map();

/** FNV-1a hash of the ID: about one entity in 128 starts a new chunk. */
function startsChunk(id) {
    let boundary = boundaryCache.get(id);
    if (boundary === undefined) {
        let hash = 2166136261;
        for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
        boundary = (hash >>> 0) % CHUNK_BOUNDARY_MODULUS === 0;
        if (boundaryCache.size >= MAX_CACHED_IDS) boundaryCache.clear();
        boundaryCache.set(id, boundary);
    }
    return boundary;
}

/** Contiguous chunks of entity positions, keyed by the ID of their first entity. */
export function chunkDrawingEntities(entities) {
    const chunks = [];
    let current = null;
    entities.forEach((entity, position) => {
        const id = String(entity.id);
        if (!current || current.positions.length >= MAX_CHUNK_SIZE || startsChunk(id)) {
            current = { key: `chunk-${id}`, positions: [] };
            chunks.push(current);
        }
        current.positions.push(position);
    });
    return chunks;
}
