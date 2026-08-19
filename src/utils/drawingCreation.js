import {
    circleFromThreePoints,
    createTangentCircle,
    createArcFromStartCenterEnd,
    createArcFromStartEndRadius,
    createArcFromThreePoints,
    findThreeEntityTangentCircles,
    isFiniteBoundedCircle,
    normalizePolygonMode,
    normalizePolygonSides,
    pointAngle,
    positiveAngleDelta,
    tangentRadiusAtPoint,
} from './drawingCurves.js';
import { pointDistance } from './drawingPrimitives.js';
import { DEFAULT_DRAWING_TEXT_STYLE_ID } from './drawingText.js';

const CREATION_PANEL_ENTITY_TYPES = new Set(['rectangle', 'circle', 'polygon', 'arc', 'text']);

export function supportsDrawingCreationPanel(entityOrType) {
    const type = typeof entityOrType === 'string' ? entityOrType : entityOrType?.type;
    return CREATION_PANEL_ENTITY_TYPES.has(type);
}

export function createDefaultDrawingCreationConfig(tool) {
    if (tool === 'circle') return { mode: 'centerRadius', options: {} };
    if (tool === 'polygon') return { mode: 'centerRadius', options: { sides: 6, mode: 'inscribed' } };
    if (tool === 'arc') return { mode: 'threePoint', options: {} };
    if (tool === 'text') return {
        mode: 'corner',
        options: {
            textMode: 'singleLine',
            wrapMode: 'none',
            textStyleId: DEFAULT_DRAWING_TEXT_STYLE_ID,
            horizontalAlign: 'left',
            verticalAlign: 'top',
        },
    };
    return { mode: 'corner', options: {} };
}

const MODE_ALIASES = {
    circle: new Map([
        ['CENTER', 'centerRadius'], ['CENTRE', 'centerRadius'], ['RADIUS', 'centerRadius'], ['CR', 'centerRadius'],
        ['2P', 'twoPoint'], ['2POINT', 'twoPoint'], ['2POINTS', 'twoPoint'], ['DIAMETER', 'twoPoint'],
        ['3P', 'threePoint'], ['3POINT', 'threePoint'], ['3POINTS', 'threePoint'],
        ['TTR', 'tangentTangentRadius'], ['TANGENTTANGENTRADIUS', 'tangentTangentRadius'],
        ['TTT', 'tangentTangentTangent'], ['TANGENTTANGENTTANGENT', 'tangentTangentTangent'],
    ]),
    arc: new Map([
        ['3P', 'threePoint'], ['3POINT', 'threePoint'], ['3POINTS', 'threePoint'],
        ['SCE', 'startCenterEnd'], ['STARTCENTEREND', 'startCenterEnd'], ['STARTCENTREEND', 'startCenterEnd'],
        ['SER', 'startEndRadius'], ['STARTENDRADIUS', 'startEndRadius'],
        ['SCA', 'startCenterAngle'], ['STARTCENTERANGLE', 'startCenterAngle'], ['STARTCENTREANGLE', 'startCenterAngle'],
        ['CW', 'clockwise'], ['CCW', 'counterClockwise'], ['COUNTERCLOCKWISE', 'counterClockwise'],
    ]),
    polygon: new Map([
        ['SIDES', 'sides'], ['SIDE', 'sides'], ['N', 'sides'],
        ['INSCRIBED', 'inscribed'], ['I', 'inscribed'],
        ['CIRCUMSCRIBED', 'circumscribed'], ['CIRCUM', 'circumscribed'], ['C', 'circumscribed'],
    ]),
    rectangle: new Map([
        ['DIMENSIONS', 'dimensions'], ['DIMENSION', 'dimensions'], ['D', 'dimensions'],
        ['AREA', 'area'], ['A', 'area'],
        ['ROTATION', 'rotation'], ['ROTATE', 'rotation'], ['R', 'rotation'],
        ['CHAMFER', 'chamfer'], ['CHA', 'chamfer'],
        ['FILLET', 'fillet'], ['F', 'fillet'],
        ['WIDTH', 'lineWidth'], ['W', 'lineWidth'],
    ]),
};

const CREATION_OPTION_DEFINITIONS = {
    rectangle: [
        creationOption('DIMENSIONS', 'D', 'creation.dimensions'),
        creationOption('AREA', 'A', 'creation.byArea'),
        creationOption('ROTATION', 'R', 'creation.rotation'),
        creationOption('CHAMFER', 'CHA', 'creation.chamfer'),
        creationOption('FILLET', 'F', 'creation.fillet'),
        creationOption('WIDTH', 'W', 'creation.lineWidth'),
    ],
    circle: [
        creationOption('CENTER', 'CR', 'creation.circleCenterRadius'),
        creationOption('2POINT', '2P', 'creation.circleTwoPoint'),
        creationOption('3POINT', '3P', 'creation.circleThreePoint'),
        creationOption('TTR', 'TTR', 'creation.circleTTR'),
        creationOption('TTT', 'TTT', 'creation.circleTTT'),
    ],
    polygon: [
        creationOption('SIDES', 'N', 'creation.polygonSides'),
        creationOption('INSCRIBED', 'I', 'creation.inscribed'),
        creationOption('CIRCUMSCRIBED', 'C', 'creation.circumscribed'),
    ],
    arc: [
        creationOption('3POINT', '3P', 'creation.arcStartEndPoint'),
        creationOption('STARTCENTEREND', 'SCE', 'creation.arcStartCenterEnd'),
        creationOption('STARTENDRADIUS', 'SER', 'creation.arcStartEndRadius'),
        creationOption('STARTCENTERANGLE', 'SCA', 'creation.arcStartCenterAngle'),
        creationOption('CW', 'CW', 'creation.clockwise'),
        creationOption('CCW', 'CCW', 'creation.counterClockwise'),
    ],
};

export function getDrawingCreationOptionSuggestions(tool, value) {
    const trimmed = String(value || '').trim();
    if (/\s/.test(trimmed)) return [];
    const prefix = normalizeToken(trimmed);
    return (CREATION_OPTION_DEFINITIONS[tool] || [])
        .filter(definition => !prefix || definition.tokens.some(token => token.startsWith(prefix)))
        .sort((left, right) => creationOptionScore(left, prefix) - creationOptionScore(right, prefix)
            || left.name.localeCompare(right.name, 'en'))
        .map(definition => ({
            command: `creation-${tool}-${definition.name}`,
            name: definition.name,
            alias: definition.alias,
            labelKey: definition.labelKey,
            completion: definition.name,
            tokens: definition.tokens,
        }));
}

export function parseDrawingCreationInput(tool, value) {
    const tokens = String(value || '').trim().split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) return null;
    const commandTokens = {
        rectangle: ['RECTANGLE', 'REC', 'RECT'],
        polygon: ['POLYGON', 'POLY', 'POL'],
        circle: ['CIRCLE', 'C', 'CERCLE'],
        arc: ['ARC', 'A', 'ARCHE'],
    }[tool] || [];
    if (commandTokens.includes(normalizeToken(tokens[0]))) tokens.shift();
    if (!tokens.length) return null;
    const aliases = MODE_ALIASES[tool];
    if (!aliases) return null;
    const first = normalizeToken(tokens[0]);
    const mode = aliases.get(first);
    if (mode) {
        const args = parseNumbers(tokens.slice(1));
        if (tool === 'polygon' && ['inscribed', 'circumscribed'].includes(mode)) {
            return { kind: 'options', options: { mode, ...(args[0] !== undefined ? { sides: args[0] } : {}) } };
        }
        if (tool === 'rectangle' && ['dimensions', 'area', 'rotation', 'chamfer', 'fillet', 'lineWidth'].includes(mode)) {
            return { kind: 'options', options: parseOptionValue(mode, args) };
        }
        if (tool === 'arc' && ['clockwise', 'counterClockwise'].includes(mode)) {
            return { kind: 'options', options: { counterClockwise: mode === 'counterClockwise', ...arcModeValue(mode, args) } };
        }
        return { kind: 'mode', mode, args };
    }
    const options = {};
    let consumed = false;
    let invalidToken = false;
    const unlabelledNumbers = [];
    for (let index = 0; index < tokens.length; index += 1) {
        const option = aliases.get(normalizeToken(tokens[index]));
        if (!option) {
            const number = parseNumber(tokens[index]);
            if (Number.isFinite(number)) unlabelledNumbers.push(number);
            else invalidToken = true;
            continue;
        }
        if (option === 'centerRadius' || option === 'twoPoint' || option === 'threePoint'
            || option === 'tangentTangentRadius' || option === 'tangentTangentTangent') continue;
        const valueToken = tokens[index + 1];
        const numeric = parseNumber(valueToken);
        if (option === 'inscribed' || option === 'circumscribed' || option === 'clockwise' || option === 'counterClockwise') {
            options.mode = option === 'circumscribed' ? 'circumscribed' : option === 'inscribed' ? 'inscribed' : options.mode;
            options.counterClockwise = option === 'counterClockwise' ? true : option === 'clockwise' ? false : options.counterClockwise;
            consumed = true;
            continue;
        }
        if (!Number.isFinite(numeric)) continue;
        if (option === 'dimensions') {
            const height = Number.parseFloat(String(tokens[index + 2] || '').replace(',', '.'));
            if (!Number.isFinite(height)) continue;
            options.width = numeric;
            options.height = height;
            index += 2;
        } else {
            options[option] = numeric;
            index += 1;
        }
        consumed = true;
    }
    if (tool === 'rectangle' && unlabelledNumbers.length) {
        if (unlabelledNumbers.length >= 2) {
            options.width = unlabelledNumbers[0];
            options.height = unlabelledNumbers[1];
        } else if (!consumed) {
            options.width = unlabelledNumbers[0];
            options.height = unlabelledNumbers[0];
        }
        consumed = true;
    }
    if (invalidToken) return null;
    if (tool === 'polygon' && unlabelledNumbers.length) {
        options.sides = unlabelledNumbers[0];
        consumed = true;
    }
    return consumed ? { kind: 'options', options } : null;
}

export function applyDrawingCreationMode(tool, current, value) {
    const parsed = parseDrawingCreationInput(tool, value);
    if (!parsed) return current;
    if (parsed.kind === 'mode') {
        const modeOptions = modeArgumentsToOptions(tool, parsed.mode, parsed.args);
        return {
            ...current,
            mode: parsed.mode,
            ...(parsed.args.length ? { modeArgs: parsed.args } : {}),
            ...(Object.keys(modeOptions).length ? { options: { ...(current?.options || {}), ...modeOptions } } : {}),
        };
    }
    return { ...current, options: { ...(current?.options || {}), ...parsed.options } };
}

export function buildRectangleCreationEntity(first, current, layerId, options = {}, id = 'draft') {
    const directionX = current.x < first.x ? -1 : 1;
    const directionY = current.y < first.y ? -1 : 1;
    let width = Number.isFinite(options.width) ? Math.abs(options.width) : Math.abs(current.x - first.x);
    let height = Number.isFinite(options.height) ? Math.abs(options.height) : Math.abs(current.y - first.y);
    if (Number.isFinite(options.area) && options.area > 0) {
        const ratio = height > 1e-9 ? width / height : 1;
        width = Math.sqrt(options.area * ratio);
        height = options.area / width;
    }
    if (width <= 1e-9 || height <= 1e-9) return null;
    const style = options.fillet > 0 ? 'fillet' : options.chamfer > 0 ? 'chamfer' : 'square';
    const cornerValue = style === 'fillet' ? options.fillet : style === 'chamfer' ? options.chamfer : 0;
    return {
        id,
        type: 'rectangle',
        layerId,
        x: first.x,
        y: first.y,
        width: width * directionX,
        height: height * directionY,
        rotation: normalizeDegrees(options.rotation),
        cornerStyle: style,
        cornerValue: Math.min(cornerValue || 0, Math.min(width, height) / 2),
        ...(Number.isFinite(options.lineWidth) && options.lineWidth > 0 ? {
            lineWidth: options.lineWidth,
        } : {}),
    };
}

export function buildRegularPolygonCreationEntity(first, current, layerId, options = {}, id = 'draft') {
    const radius = Number.isFinite(options.radius) ? Math.abs(options.radius) : pointDistance(first, current);
    if (radius <= 1e-9) return null;
    const pointerAngle = Math.atan2(current.y - first.y, current.x - first.x) * 180 / Math.PI;
    const sides = normalizePolygonSides(options.sides);
    const mode = normalizePolygonMode(options.mode);
    const angle = mode === 'circumscribed'
        ? pointerAngle + 90 - 180 / sides
        : pointerAngle + 90;
    return {
        id,
        type: 'polygon',
        layerId,
        cx: first.x,
        cy: first.y,
        r: radius,
        sides,
        mode,
        rotation: normalizeDegrees(Number.isFinite(options.rotation) ? options.rotation : angle),
    };
}

export function buildCircleCreationEntity(points, layerId, mode = 'centerRadius', options = {}, id = 'draft') {
    const tangentMode = mode === 'tangentTangentRadius' || mode === 'tangentTangentTangent';
    if (!Array.isArray(points) || points.length < (tangentMode ? 1 : 2)) return null;
    const circleSafety = options.circleSafety || options.safety || {};
    let geometry;
    if (mode === 'tangentTangentRadius' || mode === 'tangentTangentTangent') {
        const targets = tangentEntitiesFromOptions(options);
        const referencePoint = points[points.length - 1];
        if (mode === 'tangentTangentRadius') {
            const radius = Number.isFinite(Number(options.radius))
                ? Math.abs(Number(options.radius))
                : tangentRadiusAtPoint(targets, referencePoint);
            geometry = targets.length >= 2 && Number.isFinite(radius) && radius > 1e-9
                ? createTangentCircle(targets, radius, referencePoint, circleSafety)
                : null;
        } else {
            const candidates = targets.length >= 3 ? findThreeEntityTangentCircles(targets, circleSafety) : [];
            geometry = candidates.length
                ? [...candidates].sort((left, right) => pointDistance(left, referencePoint) - pointDistance(right, referencePoint))[0]
                : null;
        }
    } else if (mode === 'twoPoint') {
        const first = points[0];
        const second = points[1];
        geometry = {
            cx: (Number(first?.x) + Number(second?.x)) / 2,
            cy: (Number(first?.y) + Number(second?.y)) / 2,
            r: pointDistance(first, second) / 2,
        };
    } else if (mode === 'threePoint') {
        geometry = circleFromThreePoints(points[0], points[1], points[2], circleSafety);
    } else {
        const first = points[0];
        const requestedRadius = options.radius === undefined
            ? pointDistance(first, points[1])
            : Math.abs(Number(options.radius));
        geometry = {
            cx: Number(first?.x),
            cy: Number(first?.y),
            r: requestedRadius,
        };
    }
    if (!geometry || !isFiniteBoundedCircle(geometry, circleSafety)) return null;
    return { id, type: 'circle', layerId, cx: Number(geometry.cx), cy: Number(geometry.cy), r: Math.abs(Number(geometry.r)) };
}

export function buildArcCreationEntity(points, layerId, mode = 'threePoint', options = {}, id = 'draft') {
    if (!Array.isArray(points) || points.length < 2) return null;
    const counterClockwise = options.counterClockwise !== false;
    const circleSafety = options.circleSafety || options.safety || {};
    let geometry = null;
    if (mode === 'threePoint' && points.length >= 3) {
        geometry = createArcFromThreePoints(points[0], points[2], points[1], circleSafety);
    }
    if (mode === 'startCenterEnd' && points.length >= 3) geometry = createArcFromStartCenterEnd(points[0], points[1], points[2], counterClockwise, circleSafety);
    if (mode === 'startEndRadius' && points.length >= 2) {
        const radius = Number.isFinite(options.radius)
            ? Math.abs(options.radius)
            : points.length >= 3 ? pointDistance(points[0], points[2]) : 0;
        geometry = radius > 1e-9
            ? createArcFromStartEndRadius(points[0], points[1], radius, { counterClockwise, sidePoint: points[2] || null, safety: circleSafety })
            : null;
    }
    if (mode === 'startCenterAngle' && points.length >= 2) {
        const radius = pointDistance(points[0], points[1]);
        const startAngle = pointAngle(points[1], points[0]);
        const inferredAngle = points.length >= 3
            ? (counterClockwise
                ? positiveAngleDelta(startAngle, pointAngle(points[1], points[2]))
                : positiveAngleDelta(pointAngle(points[1], points[2]), startAngle)) * 180 / Math.PI
            : 90;
        const angle = Number.isFinite(options.angle) ? options.angle : inferredAngle;
        if (radius > 1e-9) {
            geometry = {
                cx: points[1].x,
                cy: points[1].y,
                r: radius,
                startAngle,
                endAngle: startAngle + (counterClockwise ? 1 : -1) * angle * Math.PI / 180,
                counterClockwise,
            };
        }
    }
    return geometry && isFiniteBoundedCircle(geometry, circleSafety)
        && Number.isFinite(geometry.startAngle) && Number.isFinite(geometry.endAngle)
        ? { id, type: 'arc', layerId, ...geometry }
        : null;
}

function parseNumbers(tokens) {
    return tokens.map(parseNumber).filter(Number.isFinite);
}

function tangentEntitiesFromOptions(options) {
    const targets = options?.tangentEntities || options?.targets || options?.entities;
    return Array.isArray(targets)
        ? targets.filter(entity => entity?.type === 'line' || entity?.type === 'circle').slice(0, 3)
        : [];
}

function parseNumber(value) {
    const parsed = Number.parseFloat(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionValue(option, values) {
    if (option === 'dimensions') {
        return values.length >= 2 ? { width: Math.abs(values[0]), height: Math.abs(values[1]) } : {};
    }
    if (!values.length) return {};
    return { [option]: values[0] };
}

function arcModeValue(mode, args) {
    if (!args.length) return {};
    return { angle: args[0] };
}

function modeArgumentsToOptions(tool, mode, args) {
    if (!args.length) return {};
    if (tool === 'polygon') return { sides: args[0] };
    if (tool === 'arc' && mode === 'startEndRadius') return { radius: args[0] };
    if (tool === 'arc' && mode === 'startCenterAngle') return { angle: args[0] };
    if (tool === 'rectangle' && mode === 'dimensions') return parseOptionValue(mode, args);
    return {};
}

function normalizeToken(value) {
    return String(value || '').trim().toUpperCase();
}

function creationOption(name, alias, labelKey, alternatives = []) {
    return {
        name,
        alias,
        labelKey,
        tokens: [...new Set([name, alias, ...alternatives].map(normalizeToken))],
    };
}

function creationOptionScore(definition, prefix) {
    if (definition.alias === prefix) return 0;
    if (definition.name === prefix) return 1;
    if (definition.name.startsWith(prefix)) return 2;
    return 3;
}

function normalizeDegrees(value) {
    const degrees = Number(value) || 0;
    const normalized = degrees % 360;
    return normalized < 0 ? normalized + 360 : normalized;
}
