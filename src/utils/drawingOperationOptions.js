import { createTranslator } from '../i18n/translator.js';
import {
    getOperationCopyMode,
    normalizeAngleDirection,
    normalizeAngleUnit,
    referenceOrthogonalOrigin,
    setOperationCopyMode,
} from './drawingOperations.js';

const optionDefinitions = {
    pathArray: [
        option('path', 'PATH', 'P', 'operationOptions.array.path'),
        option('base', 'BASE', 'B', 'operationOptions.array.base'),
        option('count', 'COUNT', 'N', 'operationOptions.array.count'),
        option('spacing', 'SPACING', 'S', 'operationOptions.array.spacing'),
        option('offset', 'OFFSET', 'O', 'operationOptions.array.offset'),
        option('alignItems', 'ALIGNITEMS', 'AI', 'operationOptions.array.alignItems'),
        option('reverse', 'REVERSE', 'R', 'operationOptions.array.reverse'),
    ],
    polarArray: [
        option('center', 'CENTER', 'CE', 'operationOptions.array.center'),
        option('count', 'COUNT', 'N', 'operationOptions.array.count'),
        option('angle', 'ANGLE', 'A', 'operationOptions.array.angle'),
        option('rotateItems', 'ROTATEITEMS', 'RI', 'operationOptions.array.rotateItems'),
    ],
    array: [
        option('base', 'BASE', 'B', 'operationOptions.array.base'),
        option('xSpacing', 'XSPACING', 'DX', 'operationOptions.array.xSpacing', ['X', 'PASX', 'SPACINGX']),
        option('ySpacing', 'YSPACING', 'DY', 'operationOptions.array.ySpacing', ['Y', 'PASY', 'SPACINGY']),
        option('columns', 'COLUMNS', 'NX', 'operationOptions.array.columns', ['COL', 'COLONNES']),
        option('rows', 'ROWS', 'NY', 'operationOptions.array.rows', ['LIGNES']),
    ],
    mirror: [
        option('base', 'BASE', 'B', 'operationOptions.mirror.base'),
        option('axis', 'AXIS', 'A', 'operationOptions.mirror.axis', ['AXE']),
        option('copyMode', 'COPY', 'C', 'operationOptions.mirror.copyMode', ['COPIER', 'NON', 'NO']),
        option('replaceMode', 'REPLACE', 'R', 'operationOptions.mirror.replaceMode', ['REMPLACER', 'OUI', 'YES']),
    ],
    move: [
        option('base', 'BASE', 'B', 'operationOptions.move.base'),
        option('destination', 'DESTINATION', 'D', 'operationOptions.move.destination', ['ARRIVEE', 'ARRIVÉE']),
    ],
    copy: [
        option('base', 'BASE', 'B', 'operationOptions.copy.base'),
        option('destination', 'DESTINATION', 'D', 'operationOptions.copy.destination', ['ARRIVEE', 'ARRIVÉE']),
    ],
    rotate: [
        option('base', 'BASE', 'B', 'operationOptions.rotate.base'),
        option('angle', 'ANGLE', 'A', 'operationOptions.rotate.angle'),
        option('reference', 'REFERENCE', 'REF', 'operationOptions.rotate.reference', ['RÉFÉRENCE']),
        option('copyMode', 'COPY', 'C', 'operationOptions.rotate.copyMode', ['COPIER', 'KEEP']),
        option('replaceMode', 'REPLACE', 'R', 'operationOptions.rotate.replaceMode', ['REMPLACER']),
        option('angleUnit', 'UNIT', 'U', 'operationOptions.rotate.unit', ['DEGREES', 'RADIANS', 'GRADIANS', 'GON']),
        option('angleDirection', 'DIRECTION', 'DIR', 'operationOptions.rotate.direction', ['CW', 'CCW', 'CLOCKWISE', 'COUNTERCLOCKWISE']),
    ],
    scale: [
        option('base', 'BASE', 'B', 'operationOptions.scale.base'),
        option('factor', 'FACTOR', 'F', 'operationOptions.scale.factor', ['FACTEUR']),
        option('reference', 'REFERENCE', 'REF', 'operationOptions.scale.reference', ['RÉFÉRENCE']),
        option('copyMode', 'COPY', 'C', 'operationOptions.scale.copyMode', ['COPIER', 'KEEP']),
        option('replaceMode', 'REPLACE', 'R', 'operationOptions.scale.replaceMode', ['REMPLACER']),
        option('nonUniform', 'XY', 'NU', 'operationOptions.scale.nonUniform', ['NONUNIFORM', 'NON-UNIFORME']),
    ],
    offset: [
        option('distance', 'DISTANCE', 'D', 'operationOptions.offset.distance'),
        option('side', 'SIDE', 'S', 'operationOptions.offset.side', ['COTE', 'CÔTÉ']),
        option('through', 'THROUGH', 'T', 'operationOptions.offset.through', ['PASSANT', 'PAR']),
        option('eraseSource', 'ERASE', 'E', 'operationOptions.offset.erase', ['EFFACER']),
        option('keepSource', 'KEEP', 'K', 'operationOptions.offset.keep', ['CONSERVER']),
        option('currentLayer', 'CURRENTLAYER', 'CL', 'operationOptions.offset.currentLayer', ['CALQUECOURANT']),
        option('sourceLayer', 'SOURCELAYER', 'SL', 'operationOptions.offset.sourceLayer', ['CALQUESOURCE']),
    ],
    trim: [
        option('edgeExtend', 'EXTENDEDGE', 'E', 'operationOptions.trim.extendEdge', ['EDGE', 'PROLONGEBORD']),
        option('edgeFinite', 'FINITEEDGE', 'F', 'operationOptions.trim.finiteEdge', ['NOEDGE', 'BORDFINI']),
        option('projectNone', 'PROJECTNONE', 'PN', 'operationOptions.trim.projectNone', ['NONE', 'AUCUN']),
    ],
    extend: [
        option('edgeExtend', 'EXTENDEDGE', 'E', 'operationOptions.extend.extendEdge', ['EDGE', 'PROLONGEBORD']),
        option('edgeFinite', 'FINITEEDGE', 'F', 'operationOptions.extend.finiteEdge', ['NOEDGE', 'BORDFINI']),
        option('projectNone', 'PROJECTNONE', 'PN', 'operationOptions.extend.projectNone', ['NONE', 'AUCUN']),
    ],
    align: [
        option('scaleMode', 'SCALE', 'S', 'operationOptions.align.scale', ['YES', 'OUI']),
        option('noScaleMode', 'NOSCALE', 'N', 'operationOptions.align.noScale', ['NO', 'NON']),
        option('thirdPair', 'THIRD', 'T', 'operationOptions.align.third', ['3', 'TROISIEME', 'TROISIÈME']),
        option('apply', 'APPLY', 'A', 'operationOptions.align.apply', ['DONE', 'TERMINER']),
    ],
    lengthen: [
        option('deltaMode', 'DELTA', 'D', 'operationOptions.lengthen.delta'),
        option('percentMode', 'PERCENT', 'P', 'operationOptions.lengthen.percent', ['POURCENT']),
        option('totalMode', 'TOTAL', 'T', 'operationOptions.lengthen.total'),
        option('dynamicMode', 'DYNAMIC', 'DY', 'operationOptions.lengthen.dynamic', ['DYNAMIQUE']),
    ],
    fillet: [
        option('radius', 'RADIUS', 'R', 'operationOptions.fillet.radius', ['RAYON']),
        option('multiple', 'MULTIPLE', 'M', 'operationOptions.fillet.multiple'),
        option('polyline', 'POLYLINE', 'P', 'operationOptions.fillet.polyline'),
        option('trim', 'TRIM', 'T', 'operationOptions.fillet.trim', ['AJUSTER']),
        option('noTrim', 'NOTRIM', 'N', 'operationOptions.fillet.noTrim', ['NOADJUST']),
    ],
    chamfer: [
        option('distance', 'DISTANCE', 'D', 'operationOptions.chamfer.distance'),
        option('angle', 'ANGLE', 'A', 'operationOptions.chamfer.angle'),
        option('multiple', 'MULTIPLE', 'M', 'operationOptions.chamfer.multiple'),
        option('polyline', 'POLYLINE', 'P', 'operationOptions.chamfer.polyline'),
        option('trim', 'TRIM', 'T', 'operationOptions.chamfer.trim', ['AJUSTER']),
        option('noTrim', 'NOTRIM', 'N', 'operationOptions.chamfer.noTrim', ['NOADJUST']),
    ],
    xplode: [
        option('inheritParent', 'PARENT', 'P', 'operationOptions.xplode.parent', ['INHERIT']),
        option('keepParts', 'PARTS', 'K', 'operationOptions.xplode.parts', ['KEEP']),
    ],
};

export function parseDrawingOperationOption(operation, value) {
    if (!operation || operation.stage === 'select') return null;
    const trimmed = String(value || '').trim();
    if (!trimmed) return null;
    const [rawToken, ...rawArgs] = trimmed.split(/\s+/);
    const definition = definitionsFor(operation).find(candidate => candidate.tokens.includes(normalizeToken(rawToken)));
    if (!definition) return null;
    const parsed = {
        option: definition.option,
        name: definition.name,
        args: parseOptionNumbers(rawArgs),
    };
    if (['angleUnit', 'angleDirection'].includes(definition.option)) {
        const candidate = rawArgs[0] || (definition.tokens.includes(normalizeToken(rawToken)) && normalizeToken(rawToken) !== definition.name ? rawToken : '');
        if (candidate) parsed.value = candidate;
    }
    return parsed;
}

export function getDrawingOperationOptionSuggestions(operation, value, limit = Number.POSITIVE_INFINITY) {
    const prefix = normalizeToken(value);
    if (/\s/.test(String(value || '').trim())) return [];
    return definitionsFor(operation)
        .filter(definition => !prefix || definition.tokens.some(token => token.startsWith(prefix)))
        .sort((left, right) => optionScore(left, prefix) - optionScore(right, prefix)
            || left.name.localeCompare(right.name, 'en'))
        .slice(0, limit)
        .map(definition => ({
            command: `${operation.type}-${definition.option}`,
            name: definition.name,
            alias: definition.alias,
            labelKey: definition.labelKey,
            completion: definition.name,
            tokens: definition.tokens,
        }));
}

export function getOperationOrthogonalOrigin(operation, arrayHandle = null) {
    if (['leaderCreation', 'inquiry', 'countArea', 'wipeout'].includes(operation?.type)) return operation.points?.at(-1) || null;
    if (operation?.stage === 'reference') return referenceOrthogonalOrigin(operation);
    if (operation?.type === 'align' && operation.stage?.startsWith('align-destination-')) {
        return operation.pendingSource || null;
    }
    if (!operation?.basePoint) return null;
    if (operation.type === 'array') {
        if (arrayHandle === 'base' || operation.stage === 'array-option-base') {
            return operation.sourceBasePoint || operation.basePoint;
        }
        return operation.stage === 'base' ? null : operation.basePoint;
    }
    if (operation.type === 'mirror') return operation.stage === 'base' ? null : operation.basePoint;
    if (['move', 'copy', 'rotate', 'scale', 'stretch', 'dimensionTextPlacement', 'dimensionBreak', 'dimensionSpacing'].includes(operation.type)) {
        return operation.stage === 'base' ? null : operation.basePoint;
    }
    return null;
}

export function operationCopyModeFromOption(parsedOption, fallback = 'replace') {
    if (parsedOption?.option === 'copyMode') return 'copy';
    if (parsedOption?.option === 'replaceMode') return 'replace';
    return fallback;
}

export function applyDrawingOperationOption(operation, parsedOption, rawValue = '') {
    if (!operation || !parsedOption) return operation;
    if (['copyMode', 'replaceMode'].includes(parsedOption.option)) {
        return setOperationCopyMode(operation, operationCopyModeFromOption(parsedOption), getOperationCopyMode(operation));
    }
    if (parsedOption.option === 'angleUnit') {
        const value = String(rawValue || '').trim().split(/\s+/).slice(1).join(' ') || parsedOption.value;
        if (!value) return operation;
        return { ...operation, angleUnit: normalizeAngleUnit(value) };
    }
    if (parsedOption.option === 'angleDirection') {
        const value = String(rawValue || '').trim().split(/\s+/).slice(1).join(' ') || parsedOption.value;
        if (!value) return operation;
        return { ...operation, angleDirection: normalizeAngleDirection(value) };
    }
    if (parsedOption.option === 'through') {
        const { distance: _distance, ...rest } = operation;
        return { ...rest, stage: 'side', offsetMode: 'through' };
    }
    if (parsedOption.option === 'eraseSource') return { ...operation, eraseSource: true };
    if (parsedOption.option === 'keepSource') return { ...operation, eraseSource: false };
    if (parsedOption.option === 'currentLayer') return { ...operation, destinationLayer: 'current' };
    if (parsedOption.option === 'sourceLayer') return { ...operation, destinationLayer: 'source' };
    return operation;
}

export function getOperationAngleConfig(operation) {
    return {
        unit: normalizeAngleUnit(operation?.angleUnit || operation?.unit),
        direction: normalizeAngleDirection(operation?.angleDirection || operation?.direction),
    };
}

export function reopenBasicDrawingOperationOption(operation, parsedOption, t = createTranslator()) {
    if (!operation || !parsedOption || ['array', 'mirror'].includes(operation.type)) return null;
    const args = parsedOption.args;
    if (parsedOption.option === 'base') {
        const basePoint = args.length >= 2 ? { x: args[0], y: args[1] } : null;
        const nextStage = basePoint ? nextStageAfterBase(operation.type) : 'base';
        return {
            operation: { ...operation, stage: nextStage, ...(basePoint ? { basePoint } : {}) },
            message: basePoint ? nextStagePrompt(operation.type, undefined, t) : t('operationPrompt.newBase'),
        };
    }
    if (['copyMode', 'replaceMode'].includes(parsedOption.option)) {
        return {
            operation: applyDrawingOperationOption(operation, parsedOption),
            message: nextStagePrompt(operation.type, operation.stage, t),
        };
    }
    if (parsedOption.option === 'nonUniform' && operation.type === 'scale') {
        return {
            operation: {
                ...operation,
                stage: 'scale-xy',
                ...(args.length >= 2 ? { requestedValues: args.slice(0, 2) } : {}),
            },
            message: t('operationPrompt.scaleXY'),
            focus: true,
        };
    }
    if (['through', 'eraseSource', 'keepSource', 'currentLayer', 'sourceLayer'].includes(parsedOption.option)) {
        const nextOperation = applyDrawingOperationOption(operation, parsedOption);
        return {
            operation: nextOperation,
            message: parsedOption.option === 'through'
                ? t('operationPrompt.offsetThrough')
                : t('operationPrompt.offsetOptions'),
        };
    }
    if (['angleUnit', 'angleDirection'].includes(parsedOption.option)) {
        const value = parsedOption.value || parsedOption.name;
        return {
            operation: applyDrawingOperationOption(operation, parsedOption, `${parsedOption.name} ${value}`),
            message: nextStagePrompt(operation.type, operation.stage, t),
        };
    }
    const stages = { destination: 'destination', angle: 'angle', factor: 'factor', distance: 'distance', side: 'side' };
    const stage = stages[parsedOption.option];
    if (!stage) return null;
    const requestedValue = args[0];
    if (stage === 'distance' && Number.isFinite(requestedValue)) {
        return {
            operation: { ...operation, stage: 'side', offsetMode: 'distance', distance: requestedValue },
            message: t('operationPrompt.offsetSide', { distance: requestedValue }),
        };
    }
    return {
        operation: {
            ...operation,
            stage,
            ...(stage === 'distance' ? { offsetMode: 'distance' } : {}),
            ...(stage === 'destination' && args.length ? { requestedValues: args } : Number.isFinite(requestedValue) ? { requestedValue } : {}),
        },
        message: nextStagePrompt(operation.type, stage, t),
        focus: ['angle', 'factor', 'distance'].includes(stage),
    };
}

function definitionsFor(operation) {
    if (!operation || operation.stage === 'select') return [];
    const definitions = optionDefinitions[operation.arrayKind === 'path' ? 'pathArray' : operation.arrayKind === 'polar' ? 'polarArray' : operation.type] || [];
    if (operation.type === 'array') {
        return operation.stage === 'array-edit' || operation.stage.startsWith('array-option-') ? definitions : [];
    }
    if (operation.type === 'mirror') {
        return operation.stage === 'mirror-choice' || operation.stage.startsWith('mirror-option-') ? definitions : [];
    }
    if (operation.type === 'scale' && operation.scope === 'viewport') {
        return definitions.filter(definition => ['base', 'factor'].includes(definition.option));
    }
    if (['move', 'copy', 'rotate', 'scale'].includes(operation.type) && operation.stage === 'base') {
        return definitions.filter(definition => ['base', 'reference', 'copyMode', 'replaceMode', 'angleUnit', 'angleDirection'].includes(definition.option));
    }
    if (['offset', 'trim', 'extend', 'align', 'lengthen', 'fillet', 'chamfer', 'xplode'].includes(operation.type)) {
        return definitions;
    }
    return definitions;
}

function option(optionName, name, alias, labelKey, alternatives = []) {
    return {
        option: optionName,
        name,
        alias,
        labelKey,
        tokens: [...new Set([name, alias, ...alternatives].map(normalizeToken))],
    };
}

function parseOptionNumbers(values) {
    return values.map(value => Number.parseFloat(String(value).replace(',', '.'))).filter(Number.isFinite);
}

function normalizeToken(value) {
    return String(value || '').trim().toUpperCase();
}

function optionScore(definition, prefix) {
    if (definition.alias === prefix) return 0;
    if (definition.name === prefix) return 1;
    if (definition.name.startsWith(prefix)) return 2;
    return 3;
}

function nextStageAfterBase(type) {
    return ({ move: 'destination', copy: 'destination', rotate: 'angle', scale: 'factor' })[type] || 'base';
}

function nextStagePrompt(type, stage = nextStageAfterBase(type), t = createTranslator()) {
    const key = ({
        destination: 'operationPrompt.destination',
        angle: 'operationPrompt.angle',
        factor: 'operationPrompt.factor',
        distance: 'operationPrompt.distance',
        side: 'operationPrompt.side',
    })[stage] || 'operationPrompt.point';
    return t(key);
}
