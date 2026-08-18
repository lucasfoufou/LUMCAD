const ALIGN_POINT_STAGE = /^align-(source|destination)-([123])$/;

export function createAlignSelectionOperation() {
    return { type: 'align', stage: 'select', entityIds: [], pairs: [] };
}

export function beginAlignPointCollection(entityIds) {
    return {
        type: 'align',
        stage: 'align-source-1',
        entityIds: [...new Set(entityIds || [])],
        pairs: [],
        pendingSource: null,
    };
}

export function isAlignPointStage(operationOrStage) {
    const stage = typeof operationOrStage === 'string' ? operationOrStage : operationOrStage?.stage;
    return ALIGN_POINT_STAGE.test(String(stage || ''));
}

export function advanceAlignOperationPoint(operation, point) {
    if (operation?.type !== 'align' || !isAlignPointStage(operation)) {
        return { accepted: false, reason: 'stage', operation };
    }
    if (!isFinitePoint(point)) return { accepted: false, reason: 'non-finite', operation };
    const match = ALIGN_POINT_STAGE.exec(operation.stage);
    const kind = match[1];
    const pairNumber = Number(match[2]);
    const normalizedPoint = { x: point.x, y: point.y };
    if (kind === 'source') {
        return {
            accepted: true,
            operation: {
                ...operation,
                stage: `align-destination-${pairNumber}`,
                pendingSource: normalizedPoint,
            },
        };
    }
    if (!isFinitePoint(operation.pendingSource)) {
        return { accepted: false, reason: 'missing-source', operation };
    }

    const pairs = [
        ...(operation.pairs || []),
        { source: { ...operation.pendingSource }, destination: normalizedPoint },
    ].slice(0, pairNumber);
    return {
        accepted: true,
        pairCompleted: true,
        pairNumber,
        operation: {
            ...operation,
            pairs,
            pendingSource: null,
            stage: pairNumber >= 2 ? 'align-choice' : `align-source-${pairNumber + 1}`,
        },
    };
}

export function chooseAlignOperation(operation, rawValue) {
    if (operation?.type !== 'align' || operation.stage !== 'align-choice') {
        return { accepted: false, reason: 'stage', operation };
    }
    const pairCount = operation.pairs?.length || 0;
    if (![2, 3].includes(pairCount)) return { accepted: false, reason: 'pair-count', operation };
    const choice = normalizeAlignChoice(rawValue);
    if (!choice) return { accepted: false, reason: 'choice', operation };
    if (choice === 'third') {
        if (pairCount !== 2) return { accepted: false, reason: 'third-complete', operation };
        return {
            accepted: true,
            action: 'continue',
            operation: { ...operation, stage: 'align-source-3', pendingSource: null },
        };
    }
    return {
        accepted: true,
        action: 'apply',
        scale: choice === 'scale',
        operation,
    };
}

export function retryLastAlignPair(operation) {
    if (operation?.type !== 'align') return operation;
    const pairNumber = Math.max(1, Math.min(3, operation.pairs?.length || 1));
    return {
        ...operation,
        stage: `align-source-${pairNumber}`,
        pairs: (operation.pairs || []).slice(0, -1),
        pendingSource: null,
    };
}

export function getAlignPreviewPairs(operation, currentPoint = null) {
    if (operation?.type !== 'align') return null;
    const pairs = (operation.pairs || []).map(pair => ({
        source: { ...pair.source },
        destination: { ...pair.destination },
    }));
    const match = ALIGN_POINT_STAGE.exec(String(operation.stage || ''));
    if (match?.[1] === 'destination' && isFinitePoint(operation.pendingSource) && isFinitePoint(currentPoint)) {
        pairs.push({
            source: { ...operation.pendingSource },
            destination: { x: currentPoint.x, y: currentPoint.y },
        });
    }
    return [2, 3].includes(pairs.length) ? pairs : null;
}

export function getAlignPromptDescriptor(operation) {
    if (operation?.type !== 'align') return null;
    if (operation.stage === 'select') return { key: 'messages.alignSelectionPrompt', values: {} };
    if (operation.stage === 'align-choice') {
        return {
            key: operation.pairs?.length === 2
                ? 'messages.alignScaleOrThirdPrompt'
                : 'messages.alignScalePrompt',
            values: { count: operation.pairs?.length || 0 },
        };
    }
    const match = ALIGN_POINT_STAGE.exec(String(operation.stage || ''));
    if (!match) return null;
    return {
        key: match[1] === 'source' ? 'messages.alignSourcePrompt' : 'messages.alignDestinationPrompt',
        values: { pair: Number(match[2]) },
    };
}

function normalizeAlignChoice(value) {
    const token = String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[-_\s]/g, '')
        .toUpperCase();
    if (['Y', 'YES', 'O', 'OUI', 'SCALE', 'WITHSCALE', 'AVECHELLE'].includes(token)) return 'scale';
    if (['N', 'NO', 'NON', 'NOSCALE', 'WITHOUTSCALE', 'SANSECHELLE'].includes(token)) return 'rigid';
    if (['3', 'THIRD', 'TROISIEME'].includes(token)) return 'third';
    return null;
}

function isFinitePoint(point) {
    return Number.isFinite(point?.x) && Number.isFinite(point?.y);
}
