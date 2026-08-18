import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createDefaultDrawingContent,
    normalizeDrawingContent,
    transformSelectedEntities,
} from './drawingDocument.js';
import { scaleEntity } from './drawingGeometry.js';

test('dynamic precision input defaults on and preserves an explicit persisted opt-out', () => {
    const defaults = createDefaultDrawingContent();
    assert.equal(defaults.settings.dynamicInput, true);
    assert.equal(normalizeDrawingContent({ ...defaults, settings: {} }).settings.dynamicInput, true);
    assert.equal(normalizeDrawingContent({
        ...defaults,
        settings: { ...defaults.settings, dynamicInput: false },
    }).settings.dynamicInput, false);
});

test('transformSelectedEntities replaces editable geometry and keeps its identity', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'line', type: 'line', layerId: 'geometry', x1: 0, y1: 0, x2: 2, y2: 0 },
        { id: 'dimension', type: 'linearDimension', layerId: 'dimensions', sourceId: 'line', offset: 0.6 },
    ];
    const result = transformSelectedEntities(content, ['line'], entity => (
        entity.type === 'line' ? { ...entity, x2: 4 } : { ...entity, offset: 1.2 }
    ));
    assert.equal(result.changed, true);
    assert.deepEqual(result.selectedIds, ['line']);
    assert.equal(result.content.entities.find(entity => entity.id === 'line').x2, 4);
    assert.equal(result.content.entities.find(entity => entity.id === 'dimension').offset, 1.2);
});

test('transformSelectedEntities can keep sources and remap associated dimensions', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 1, cy: 2, r: 3 },
        { id: 'dimension', type: 'radialDimension', layerId: 'dimensions', sourceId: 'circle', angle: 0 },
    ];
    const result = transformSelectedEntities(content, ['circle'], entity => ({ ...entity, cx: (entity.cx || 0) + 10 }), { copy: true });
    assert.equal(result.content.entities.length, 4);
    assert.equal(result.selectedIds.length, 1);
    const copiedCircle = result.content.entities.find(entity => entity.id === result.selectedIds[0]);
    const copiedDimension = result.content.entities.find(entity => entity.sourceId === copiedCircle.id);
    assert.equal(copiedCircle.cx, 11);
    assert.ok(copiedDimension);
    assert.notEqual(copiedDimension.id, 'dimension');
});

test('non-uniform transforms detach dimensions when their source becomes a polyline', () => {
    const content = createDefaultDrawingContent();
    content.entities = [
        { id: 'circle', type: 'circle', layerId: 'geometry', cx: 0, cy: 0, r: 2 },
        { id: 'radius', type: 'radialDimension', layerId: 'dimensions', sourceId: 'circle', mode: 'radius', angle: 0 },
    ];
    const result = transformSelectedEntities(content, ['circle'], entity => scaleEntity(entity, {
        origin: { x: 0, y: 0 }, scaleX: 2, scaleY: 1,
    }));
    const transformedCircle = result.content.entities.find(entity => entity.id === 'circle');
    const detachedDimension = result.content.entities.find(entity => entity.id === 'radius');
    assert.equal(transformedCircle.type, 'polyline');
    assert.equal(detachedDimension.type, 'linearDimension');
    assert.equal(Object.hasOwn(detachedDimension, 'sourceId'), false);
    assert.deepEqual(detachedDimension.p1, { x: 0, y: 0 });
    assert.deepEqual(detachedDimension.p2, { x: 4, y: 0 });
});
