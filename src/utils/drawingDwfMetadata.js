export function normalizeDrawingDwfUnderlay(value) {
    if (value?.version !== 1 || value.format !== 'dwfx'
        || typeof value.assetId !== 'string' || !value.assetId || value.assetId.length > 256
        || !Number.isSafeInteger(value.pageNumber) || value.pageNumber < 1 || value.pageNumber > 10000
        || !Number.isSafeInteger(value.pageCount) || value.pageCount < value.pageNumber || value.pageCount > 10000
        || ![value.width, value.height].every(number => Number.isFinite(number) && number > 0 && number <= 1e6)) return null;
    return { version: 1, format: 'dwfx', assetId: value.assetId, name: String(value.name || '').slice(0, 256),
        pageNumber: value.pageNumber, pageCount: value.pageCount, width: value.width, height: value.height };
}
