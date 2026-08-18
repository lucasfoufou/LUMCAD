import test from 'node:test';
import assert from 'node:assert/strict';

import { TRANSLATIONS } from '../i18n/translator.js';

import {
    applyDrawingOperationOption,
    getOperationAngleConfig,
    getDrawingOperationOptionSuggestions,
    getOperationOrthogonalOrigin,
    operationCopyModeFromOption,
    parseDrawingOperationOption,
    reopenBasicDrawingOperationOption,
} from './drawingOperationOptions.js';
import { createDefaultDrawingContent } from './drawingDocument.js';
import {
    advanceReferenceTransform,
    beginReferenceTransform,
    convertAngle,
    createOffsetPreviewEntities,
    createTransformCopyPreviewEntities,
    getOperationCopyMode,
    normalizeCopyMode,
    previewReferenceTransform,
    previewTransformContent,
    resolveRotateReferenceAngle,
} from './drawingOperations.js';
import { resolveDrawingSnap } from './drawingTracking.js';

test('operation options accept their full names, aliases and direct values', () => {
    const array = { type: 'array', stage: 'array-edit', basePoint: { x: 0, y: 0 } };
    assert.deepEqual(parseDrawingOperationOption(array, 'base 1,5 -2'), {
        option: 'base', name: 'BASE', args: [1.5, -2],
    });
    assert.deepEqual(parseDrawingOperationOption(array, 'nx 6'), {
        option: 'columns', name: 'COLUMNS', args: [6],
    });
    assert.deepEqual(parseDrawingOperationOption({ type: 'scale', stage: 'base' }, 'ref'), {
        option: 'reference', name: 'REFERENCE', args: [],
    });
    assert.equal(parseDrawingOperationOption({ ...array, stage: 'array-horizontal' }, 'DX 2'), null);
});

test('rotate and scale options expose explicit copy state and angle configuration', () => {
    const rotate = { type: 'rotate', stage: 'base' };
    const copy = parseDrawingOperationOption(rotate, 'COPY');
    const replace = parseDrawingOperationOption(rotate, 'REPLACE');
    assert.equal(operationCopyModeFromOption(copy), 'copy');
    assert.equal(operationCopyModeFromOption(replace), 'replace');
    assert.equal(applyDrawingOperationOption(rotate, copy).copyMode, 'copy');
    assert.equal(applyDrawingOperationOption({ ...rotate, copyMode: 'copy' }, replace).copyMode, 'replace');

    const radians = parseDrawingOperationOption(rotate, 'UNIT RADIANS');
    const clockwise = parseDrawingOperationOption(rotate, 'DIRECTION CW');
    const configured = applyDrawingOperationOption(
        applyDrawingOperationOption(rotate, radians, 'UNIT RADIANS'),
        clockwise,
        'DIRECTION CW',
    );
    assert.deepEqual(getOperationAngleConfig(configured), { unit: 'radians', direction: 'clockwise' });
    assert.equal(normalizeCopyMode(true), 'copy');
    assert.equal(getOperationCopyMode({ type: 'mirror' }), 'copy');
    assert.equal(convertAngle(100, 'gradians', 'degrees'), 90);
});

test('contextual autocomplete only proposes options valid at the current stage', () => {
    const arraySuggestions = getDrawingOperationOptionSuggestions({ type: 'array', stage: 'array-edit' }, 'B');
    assert.equal(arraySuggestions[0].name, 'BASE');
    const mirrorSuggestions = getDrawingOperationOptionSuggestions({ type: 'mirror', stage: 'mirror-choice' }, 'A');
    assert.equal(mirrorSuggestions[0].name, 'AXIS');
    assert.deepEqual(getDrawingOperationOptionSuggestions({ type: 'mirror', stage: 'mirror-axis' }, 'A'), []);
    assert.equal(getDrawingOperationOptionSuggestions({ type: 'offset', stage: 'distance' }, 'T')[0].name, 'THROUGH');
    assert.equal(getDrawingOperationOptionSuggestions({ type: 'scale', stage: 'factor' }, 'X')[0].name, 'XY');

    assert.deepEqual(
        getDrawingOperationOptionSuggestions({ type: 'rotate', stage: 'angle' }, '').map(item => item.name),
        ['ANGLE', 'BASE', 'COPY', 'DIRECTION', 'REFERENCE', 'REPLACE', 'UNIT'],
    );
    assert.deepEqual(
        getDrawingOperationOptionSuggestions({ type: 'mirror', stage: 'mirror-choice' }, '').map(item => item.name),
        ['AXIS', 'BASE', 'COPY', 'REPLACE'],
    );
    assert.deepEqual(getDrawingOperationOptionSuggestions({ type: 'rotate', stage: 'angle' }, 'LINE'), []);
});

test('core modification tools expose only their relevant command options', () => {
    assert.equal(getDrawingOperationOptionSuggestions({ type: 'align', stage: 'confirm' }, 'T')[0].name, 'THIRD');
    assert.equal(parseDrawingOperationOption({ type: 'lengthen', stage: 'pick' }, 'PERCENT 125').option, 'percentMode');
    assert.deepEqual(parseDrawingOperationOption({ type: 'fillet', stage: 'pick-first' }, 'RADIUS 0.75'), {
        option: 'radius', name: 'RADIUS', args: [0.75],
    });
    assert.equal(parseDrawingOperationOption({ type: 'chamfer', stage: 'pick-first' }, 'ANGLE 30').option, 'angle');
    assert.equal(parseDrawingOperationOption({ type: 'trim', stage: 'pick' }, 'EXTENDEDGE').option, 'edgeExtend');
    assert.equal(parseDrawingOperationOption({ type: 'extend', stage: 'pick' }, 'FINITEEDGE').option, 'edgeFinite');
    assert.deepEqual(getDrawingOperationOptionSuggestions({ type: 'break', stage: 'pick' }, ''), []);
});

test('requested tool option suggestions have complete localized contracts', () => {
    const operations = [
        [{ type: 'trim', stage: 'pick' }, ['EXTENDEDGE', 'FINITEEDGE', 'PROJECTNONE']],
        [{ type: 'extend', stage: 'pick' }, ['EXTENDEDGE', 'FINITEEDGE', 'PROJECTNONE']],
        [{ type: 'align', stage: 'align-choice' }, ['APPLY', 'NOSCALE', 'SCALE', 'THIRD']],
        [{ type: 'lengthen', stage: 'pick' }, ['DELTA', 'DYNAMIC', 'PERCENT', 'TOTAL']],
        [{ type: 'fillet', stage: 'corner-first' }, ['MULTIPLE', 'NOTRIM', 'POLYLINE', 'RADIUS', 'TRIM']],
        [{ type: 'chamfer', stage: 'corner-first' }, ['ANGLE', 'DISTANCE', 'MULTIPLE', 'NOTRIM', 'POLYLINE', 'TRIM']],
        [{ type: 'xplode', stage: 'xplode-choice' }, ['PARENT', 'PARTS']],
    ];
    for (const [operation, expectedNames] of operations) {
        const suggestions = getDrawingOperationOptionSuggestions(operation, '');
        assert.deepEqual(suggestions.map(suggestion => suggestion.name), expectedNames);
        for (const suggestion of suggestions) {
            assert.ok(TRANSLATIONS.en[suggestion.labelKey], `${suggestion.labelKey} needs an English label`);
            assert.ok(TRANSLATIONS.fr[suggestion.labelKey], `${suggestion.labelKey} needs a French label`);
            assert.equal(parseDrawingOperationOption(operation, suggestion.name)?.name, suggestion.name);
            assert.equal(parseDrawingOperationOption(operation, suggestion.alias)?.name, suggestion.name);
        }
    }
});

test('each point-based operation exposes the correct origin for Shift orthogonality', () => {
    const basePoint = { x: 4, y: 3 };
    assert.equal(getOperationOrthogonalOrigin({ type: 'mirror', stage: 'base', basePoint }), null);
    assert.deepEqual(getOperationOrthogonalOrigin({ type: 'mirror', stage: 'mirror-axis', basePoint }), basePoint);
    assert.deepEqual(getOperationOrthogonalOrigin({ type: 'move', stage: 'destination', basePoint }), basePoint);
    assert.deepEqual(getOperationOrthogonalOrigin({
        type: 'align', stage: 'align-destination-1', pendingSource: basePoint,
    }), basePoint);
    assert.deepEqual(getOperationOrthogonalOrigin({ type: 'rotate', stage: 'angle', basePoint }), basePoint);
    assert.deepEqual(getOperationOrthogonalOrigin({
        type: 'array', stage: 'array-edit', basePoint, sourceBasePoint: { x: 1, y: 2 },
    }, 'base'), { x: 1, y: 2 });

    const content = createDefaultDrawingContent();
    Object.keys(content.settings.snaps).forEach(key => { content.settings.snaps[key] = false; });
    const shiftedMirrorPoint = resolveDrawingSnap({ x: 8, y: 3.4 }, content, 0.1, {
        orthogonalOrigin: basePoint,
        forceOrthogonal: true,
    });
    assert.deepEqual(shiftedMirrorPoint, { x: 8, y: 3, type: 'orthogonal' });
});

test('basic operation options can reopen a previous stage without committing', () => {
    const move = { type: 'move', stage: 'destination', entityIds: ['line'], basePoint: { x: 0, y: 0 } };
    const movedBase = reopenBasicDrawingOperationOption(move, parseDrawingOperationOption(move, 'BASE 2 3'));
    assert.equal(movedBase.operation.stage, 'destination');
    assert.deepEqual(movedBase.operation.basePoint, { x: 2, y: 3 });
    const destination = reopenBasicDrawingOperationOption(move, parseDrawingOperationOption(move, 'DESTINATION 4 -1'));
    assert.deepEqual(destination.operation.requestedValues, [4, -1]);

    const offset = { type: 'offset', stage: 'side', entityIds: ['line'], distance: 1 };
    const distance = reopenBasicDrawingOperationOption(offset, parseDrawingOperationOption(offset, 'DISTANCE 2.5'));
    assert.equal(distance.operation.stage, 'side');
    assert.equal(distance.operation.distance, 2.5);

    const through = reopenBasicDrawingOperationOption(offset, parseDrawingOperationOption(offset, 'THROUGH'));
    assert.equal(through.operation.offsetMode, 'through');
    assert.equal(through.operation.stage, 'side');
    assert.equal(Object.hasOwn(through.operation, 'distance'), false);

    const scale = { type: 'scale', stage: 'factor', entityIds: ['line'], basePoint: { x: 0, y: 0 } };
    const xy = reopenBasicDrawingOperationOption(scale, parseDrawingOperationOption(scale, 'XY 2 0.5'));
    assert.equal(xy.operation.stage, 'scale-xy');
    assert.deepEqual(xy.operation.requestedValues, [2, 0.5]);
});

test('offset options preserve explicit source and destination choices', () => {
    let operation = { type: 'offset', stage: 'side', entityIds: ['line'], distance: 1 };
    operation = applyDrawingOperationOption(operation, parseDrawingOperationOption(operation, 'ERASE'));
    operation = applyDrawingOperationOption(operation, parseDrawingOperationOption(operation, 'CURRENTLAYER'));
    assert.equal(operation.eraseSource, true);
    assert.equal(operation.destinationLayer, 'current');
    operation = applyDrawingOperationOption(operation, parseDrawingOperationOption(operation, 'KEEP'));
    operation = applyDrawingOperationOption(operation, parseDrawingOperationOption(operation, 'SOURCELAYER'));
    assert.equal(operation.eraseSource, false);
    assert.equal(operation.destinationLayer, 'source');
});

test('scale reference equates AB with CD and uses A as the fixed point', () => {
    let operation = beginReferenceTransform({ type: 'scale', entityIds: ['line'] });
    for (const point of [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 10, y: 4 }]) {
        operation = advanceReferenceTransform(operation, point).operation;
    }
    assert.deepEqual(getOperationOrthogonalOrigin(operation), { x: 10, y: 4 });
    assert.deepEqual(previewReferenceTransform(operation, { x: 16, y: 4 }), {
        valid: true,
        value: 3,
        basePoint: { x: 1, y: 1 },
    });
    let result = advanceReferenceTransform(operation, { x: 16, y: 4 });
    assert.equal(result.complete, true);
    assert.equal(result.value, 3);

    let basedOperation = beginReferenceTransform({
        type: 'scale', entityIds: ['line'], basePoint: { x: 50, y: 25 },
    });
    for (const point of [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 10, y: 4 }, { x: 16, y: 4 }]) {
        result = advanceReferenceTransform(basedOperation, point);
        basedOperation = result.operation;
    }
    assert.deepEqual(result.basePoint, { x: 50, y: 25 });
});

test('reference transforms do not preview a partial unrelated factor', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: content.activeLayerId, x1: 0, y1: 0, x2: 2, y2: 0 }];
    const operation = beginReferenceTransform({
        type: 'scale',
        entityIds: ['line'],
        basePoint: { x: 100, y: 100 },
    });
    assert.equal(previewTransformContent(content, operation, { x: 1, y: 0 }), content);
});

test('copy transform and through-offset previews preserve their sources', () => {
    const content = createDefaultDrawingContent();
    content.entities = [{ id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 }];
    const previews = createTransformCopyPreviewEntities(content, {
        type: 'rotate', stage: 'angle', entityIds: ['line'], copyMode: 'copy', basePoint: { x: 0, y: 0 },
    }, { x: 0, y: 1 });
    assert.equal(content.entities[0].x2, 2);
    assert.equal(previews.length, 1);
    assert.equal(previews[0].previewMode, 'copy');
    assert.ok(Math.abs(previews[0].y2 - 2) < 1e-9);

    const through = createOffsetPreviewEntities(content, ['line'], undefined, { x: 0, y: 3 }, { through: true });
    assert.equal(through.length, 1);
    assert.equal(through[0].y1, 3);
    assert.equal(through[0].y2, 3);
});

test('rotate reference mimics angle ABC with angle DEF around B', () => {
    let operation = beginReferenceTransform({ type: 'rotate', entityIds: ['line'] });
    const points = [
        { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 },
        { x: 5, y: 4 }, { x: 4, y: 4 }, { x: 6, y: 4 },
    ];
    let result;
    for (const point of points) {
        result = advanceReferenceTransform(operation, point);
        operation = result.operation;
    }
    assert.equal(result.complete, true);
    assert.equal(result.value, -90);
    assert.deepEqual(result.basePoint, { x: 0, y: 0 });

    let clockwiseOperation = beginReferenceTransform({
        type: 'rotate', stage: 'base', basePoint: { x: 0, y: 0 },
        referenceMode: 'sourceTarget', angleDirection: 'clockwise',
    });
    for (const point of points.slice(1)) {
        result = advanceReferenceTransform(clockwiseOperation, point);
        clockwiseOperation = result.operation;
    }
    assert.equal(result.value, 90);
    assert.equal(result.angle.value, -90);
    assert.equal(result.angle.direction, 'clockwise');
});

test('rotate reference supports a conventional base/source/target angle workflow', () => {
    let operation = beginReferenceTransform({
        type: 'rotate', stage: 'base', referenceMode: 'sourceTarget', copyMode: 'copy',
    });
    const points = [
        { x: 0, y: 0 }, // rotation base point
        { x: 1, y: 0 }, { x: 2, y: 0 }, // source reference direction
        { x: 0, y: 1 }, { x: 0, y: 2 }, // target reference direction
    ];
    let result;
    points.forEach(point => {
        result = advanceReferenceTransform(operation, point);
        operation = result.operation;
    });
    assert.equal(result.complete, true);
    assert.equal(result.value, 90);
    assert.equal(result.angle.unit, 'degrees');
    assert.equal(result.angle.direction, 'counterClockwise');
    assert.equal(operation.copyMode, 'copy');
    assert.deepEqual(result.basePoint, { x: 0, y: 0 });

    assert.deepEqual(resolveRotateReferenceAngle(0, 100, { unit: 'gradians', direction: 'clockwise' }), {
        value: -100,
        unit: 'gradians',
        direction: 'clockwise',
        radians: -Math.PI / 2,
        degrees: -90,
    });
});
