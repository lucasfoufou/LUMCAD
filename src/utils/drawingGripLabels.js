import { DRAWING_QDIM_GRIP_IDS } from './drawingDimensions.js';

export function drawingGripLabel(id, t) {
    const directKey = ({
        'array-origin': 'grip.arrayOrigin',
        start: 'grip.start',
        end: 'grip.end',
        'top-left': 'grip.topLeft',
        'top-right': 'grip.topRight',
        'bottom-right': 'grip.bottomRight',
        'bottom-left': 'grip.bottomLeft',
        center: 'grip.center',
        radius: 'grip.radius',
        midpoint: 'snap.midpoint',
        'dimension-position': 'grip.dimensionPosition',
        [DRAWING_QDIM_GRIP_IDS.offset]: 'grip.qdimOffset',
        [DRAWING_QDIM_GRIP_IDS.spacing]: 'grip.qdimSpacing',
    })[id];
    if (directKey) return t(directKey);
    if (id === 'radius-x' || id === 'radius-y') return `${t('grip.radius')} ${id.slice(-1).toUpperCase()}`;
    const vertex = /^(?:vertex|control|spline-point)-(\d+)/.exec(id);
    if (vertex) return t('grip.vertex', { number: Number(vertex[1]) + 1 });
    const part = /^part-(\d+)/.exec(id);
    if (part) return t('grip.part', { number: Number(part[1]) + 1 });
    return t('grip.point');
}
