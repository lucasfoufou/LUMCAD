import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAlignTransform } from './drawingAlignOperations.js';
import {
    advanceAlignOperationPoint,
    beginAlignPointCollection,
    chooseAlignOperation,
    createAlignSelectionOperation,
    getAlignPreviewPairs,
    getAlignPromptDescriptor,
    isAlignPointStage,
    retryLastAlignPair,
} from './drawingAlignCommand.js';

test('align collection advances through two source and destination pairs', () => {
    assert.deepEqual(createAlignSelectionOperation(), {
        type: 'align', stage: 'select', entityIds: [], pairs: [],
    });
    let operation = beginAlignPointCollection(['line', 'line', 'circle']);
    assert.deepEqual(operation.entityIds, ['line', 'circle']);
    assert.equal(isAlignPointStage(operation), true);
    operation = acceptedPoint(operation, { x: 0, y: 0 });
    assert.equal(operation.stage, 'align-destination-1');
    operation = acceptedPoint(operation, { x: 5, y: 4 });
    assert.equal(operation.stage, 'align-source-2');
    operation = acceptedPoint(operation, { x: 2, y: 0 });
    operation = acceptedPoint(operation, { x: 5, y: 6 });
    assert.equal(operation.stage, 'align-choice');
    assert.deepEqual(operation.pairs, [
        pair(0, 0, 5, 4),
        pair(2, 0, 5, 6),
    ]);
    assert.deepEqual(getAlignPromptDescriptor(operation), {
        key: 'messages.alignScaleOrThirdPrompt', values: { count: 2 },
    });
});

test('the explicit choice applies rigid or scaled alignment or collects one third pair', () => {
    const twoPairs = collectTwoPairs();
    assert.deepEqual(chooseAlignOperation(twoPairs, 'YES'), {
        accepted: true, action: 'apply', scale: true, operation: twoPairs,
    });
    assert.equal(chooseAlignOperation(twoPairs, 'non').scale, false);
    assert.equal(chooseAlignOperation(twoPairs, '').reason, 'choice');

    let third = chooseAlignOperation(twoPairs, 'troisième');
    assert.equal(third.accepted, true);
    assert.equal(third.operation.stage, 'align-source-3');
    third = { ...third, operation: acceptedPoint(third.operation, { x: 0, y: 3 }) };
    assert.equal(third.operation.stage, 'align-destination-3');
    const previewPairs = getAlignPreviewPairs(third.operation, { x: 3, y: 4 });
    assert.equal(previewPairs.length, 3);
    assert.equal(resolveAlignTransform(previewPairs).pairCount, 3);
    third.operation = acceptedPoint(third.operation, { x: 3, y: 4 });
    assert.equal(third.operation.stage, 'align-choice');
    assert.equal(third.operation.pairs.length, 3);
    assert.equal(chooseAlignOperation(third.operation, 'THIRD').reason, 'third-complete');
    assert.equal(chooseAlignOperation(third.operation, 'N').scale, false);
});

test('previews expose completed pairs and a live destination without mutating state', () => {
    const operation = collectTwoPairs();
    const sourcePairs = operation.pairs;
    const preview = getAlignPreviewPairs(operation);
    assert.deepEqual(preview, sourcePairs);
    assert.notEqual(preview, sourcePairs);
    preview[0].source.x = 99;
    assert.equal(operation.pairs[0].source.x, 0);

    const collectingThird = chooseAlignOperation(operation, '3').operation;
    assert.deepEqual(getAlignPreviewPairs(collectingThird), operation.pairs);
    const awaitingDestination = acceptedPoint(collectingThird, { x: 1, y: 2 });
    assert.equal(getAlignPreviewPairs(awaitingDestination, { x: 8, y: 9 }).length, 3);
});

test('non-finite points are refused and invalid last pairs can be retried', () => {
    const operation = beginAlignPointCollection(['line']);
    const refused = advanceAlignOperationPoint(operation, { x: Infinity, y: 0 });
    assert.equal(refused.accepted, false);
    assert.equal(refused.reason, 'non-finite');
    assert.equal(refused.operation, operation);

    const invalid = {
        ...collectTwoPairs(),
        pairs: [pair(0, 0, 5, 4), pair(0, 0, 5, 6)],
    };
    const retry = retryLastAlignPair(invalid);
    assert.equal(retry.stage, 'align-source-2');
    assert.deepEqual(retry.pairs, [pair(0, 0, 5, 4)]);
    assert.equal(retry.pendingSource, null);
});

function collectTwoPairs() {
    let operation = beginAlignPointCollection(['line']);
    [
        { x: 0, y: 0 }, { x: 3, y: 2 },
        { x: 2, y: 0 }, { x: 3, y: 4 },
    ].forEach(point => { operation = acceptedPoint(operation, point); });
    return operation;
}

function acceptedPoint(operation, point) {
    const result = advanceAlignOperationPoint(operation, point);
    assert.equal(result.accepted, true);
    return result.operation;
}

function pair(sourceX, sourceY, destinationX, destinationY) {
    return {
        source: { x: sourceX, y: sourceY },
        destination: { x: destinationX, y: destinationY },
    };
}
