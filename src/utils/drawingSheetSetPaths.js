import { normalizeDrawingSheetSet } from './drawingSheetSets.js';
import { resolveRecoveredReferencePath } from './lcadRecoveryReferences.js';

const absolute = path => typeof path === 'string' && (/^\//.test(path) || /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path));
const directory = path => path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);

/** Moving just the index must not retarget drawings; preserve symlink-sensitive parent segments. */
export function relocateDrawingSheetSet(input, previousPath, destinationPath) {
    const set = normalizeDrawingSheetSet(input);
    if (destinationPath === null) return set;
    if (!absolute(destinationPath) || !/\.json$/i.test(destinationPath) || /[\u0000-\u001f]/.test(destinationPath)) throw new Error('sheetSetPath');
    if (absolute(previousPath) && directory(previousPath) === directory(destinationPath)) return set;
    set.sources = set.sources.map(source => {
        if (absolute(source.path)) return source;
        const path = resolveRecoveredReferencePath(source.path, previousPath);
        if (!path) throw new Error('sheetSetPathContext');
        return { ...source, path };
    });
    return normalizeDrawingSheetSet(set);
}
