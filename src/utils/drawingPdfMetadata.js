export function normalizeDrawingPdfUnderlay(value) {
    if (value?.version !== 1 || typeof value.assetId !== 'string' || !value.assetId || value.assetId.length > 256
        || !Number.isSafeInteger(value.pageNumber) || value.pageNumber < 1 || value.pageNumber > 10000
        || ![value.width, value.height].every(number => Number.isFinite(number) && number > 0 && number <= 1e6)) return null;
    const layers = Array.isArray(value.layers) ? value.layers.slice(0, 2048).flatMap(layer => (
        typeof layer?.id === 'string' && layer.id.length <= 256
            ? [{ id: layer.id, name: String(layer.name || layer.id).slice(0, 256), visible: layer.visible !== false }] : []
    )) : [];
    const valid = point => Number.isFinite(point?.x) && Number.isFinite(point?.y) && Math.abs(point.x) <= 1e9 && Math.abs(point.y) <= 1e9;
    const snapEntities = Array.isArray(value.snapEntities) ? value.snapEntities.slice(0, 100000).flatMap((entity, index) => {
        const id = `pdf-snap-${index}`;
        if (entity?.type === 'line' && valid({ x: entity.x1, y: entity.y1 }) && valid({ x: entity.x2, y: entity.y2 })) {
            return [{ id, type: 'line', layerId: 'geometry', x1: entity.x1, y1: entity.y1, x2: entity.x2, y2: entity.y2 }];
        }
        if (entity?.type === 'spline' && entity.controlPoints?.length === 4 && entity.controlPoints.every(valid)) {
            return [{ id, type: 'spline', degree: 3, layerId: 'geometry', controlPoints: entity.controlPoints.map(({ x, y }) => ({ x, y })) }];
        }
        return [];
    }) : [];
    return { version: 1, assetId: value.assetId, name: String(value.name || '').slice(0, 256),
        pageNumber: value.pageNumber, pageCount: Math.min(10000, Math.max(value.pageNumber, Math.floor(Number(value.pageCount)) || value.pageNumber)),
        width: value.width, height: value.height, layers, snapEntities, snapsEnabled: value.snapsEnabled !== false };
}
