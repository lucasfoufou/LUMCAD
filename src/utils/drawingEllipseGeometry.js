/** The two full axis diameters remain stable features of full or partial ellipses. */
export function getEllipseAxisSegments(entity) {
    if (entity?.type !== 'ellipse'
        || ![entity.cx, entity.cy, entity.rx, entity.ry, entity.rotation ?? 0].every(Number.isFinite)
        || entity.rx <= 1e-9 || entity.ry <= 1e-9) return [];
    const angle = (entity.rotation || 0) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    return [
        { x: entity.rx * cosine, y: entity.rx * sine },
        { x: -entity.ry * sine, y: entity.ry * cosine },
    ].map(vector => [
        { x: entity.cx - vector.x, y: entity.cy - vector.y },
        { x: entity.cx + vector.x, y: entity.cy + vector.y },
    ]);
}

export function nearestEllipseAxis(entity, point) {
    const segments = getEllipseAxisSegments(entity);
    if (!segments.length || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return 0;
    const distances = segments.map(segment => Math.min(...segment.map(endpoint => Math.hypot(endpoint.x - point.x, endpoint.y - point.y))));
    return distances[1] < distances[0] ? 1 : 0;
}
