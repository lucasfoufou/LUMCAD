import test from 'node:test';
import assert from 'node:assert/strict';
import { describeDrawingEntityForList } from './drawingEntityListing.js';

const layers = [{ id: 'layer-roof', name: 'TOITURE' }];

test('LIST describes a line by layer name, length and endpoints', () => {
    const entry = describeDrawingEntityForList({ id: 'line-1', type: 'line', layerId: 'layer-roof', x1: 0, y1: 0, x2: 3, y2: 4 }, { layers });
    assert.equal(entry.type, 'line');
    assert.equal(entry.layerName, 'TOITURE');
    assert.ok(Math.abs(entry.values.length - 5) < 1e-9);
    assert.equal(entry.values.area, undefined);
    assert.deepEqual(entry.points.map(point => [point.key, point.x, point.y]), [['start', 0, 0], ['end', 3, 4]]);
});

test('LIST describes a closed shape by area and perimeter', () => {
    const entry = describeDrawingEntityForList({ id: 'rect', type: 'rectangle', layerId: 'missing', x: 1, y: 2, width: 4, height: 2, rotation: 0 }, { layers });
    assert.equal(entry.layerName, null);
    assert.ok(Math.abs(entry.values.area - 8) < 1e-6);
    assert.ok(Math.abs(entry.values.perimeter - 12) < 1e-6);
    assert.deepEqual(entry.points.map(point => point.key), ['position']);
});

test('LIST shows the block name and insertion point of a reference', () => {
    const entry = describeDrawingEntityForList({ id: 'ref', type: 'blockReference', blockId: 'b', layerId: 'layer-roof', transform: { a: 1, b: 0, c: 0, d: 1, e: 12, f: 7 } },
        { layers, blocks: [{ id: 'b', name: 'PV_PANEL' }] });
    assert.equal(entry.blockName, 'PV_PANEL');
    assert.deepEqual(entry.points, [{ key: 'insertion', x: 12, y: 7 }]);
});
