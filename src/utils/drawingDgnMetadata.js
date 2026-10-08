export function normalizeDrawingDgnUnderlay(value) {
    if (value?.version !== 1 || value.format !== 'v7'
        || typeof value.assetId !== 'string' || !value.assetId || value.assetId.length > 256
        || !Number.isFinite(value.metresPerMaster) || value.metresPerMaster < 1e-12 || value.metresPerMaster > 1e9) return null;
    return { version: 1, format: 'v7', assetId: value.assetId, name: String(value.name || '').slice(0, 256),
        metresPerMaster: value.metresPerMaster };
}
