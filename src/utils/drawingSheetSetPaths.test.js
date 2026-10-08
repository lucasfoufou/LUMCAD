import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingSheetSet } from './drawingSheetSets.js';
import { relocateDrawingSheetSet } from './drawingSheetSetPaths.js';

function fixture(path = 'plans/ground.lcad') {
    return { ...createDrawingSheetSet('Project'), sources: [{ id: 'source', documentId: 'drawing', path }] };
}

test('saving in the same directory retains relative paths; moving the index pins original sources', () => {
    const set = fixture(); const before = structuredClone(set);
    assert.equal(relocateDrawingSheetSet(set, '/project/set.json', '/project/renamed.json').sources[0].path, 'plans/ground.lcad');
    const moved = relocateDrawingSheetSet(set, '/project/set.json', '/exports/set.json');
    assert.equal(moved.sources[0].path, '/project/plans/ground.lcad');
    assert.equal(moved.sources[0].documentId, 'drawing');
    assert.equal(moved.id, set.id);
    assert.deepEqual(set, before);
});

test('save-as preserves parent segments and supports native Windows and UNC source bases', () => {
    assert.equal(relocateDrawingSheetSet(fixture('../details.lcad'), '/project/linked/set.json', '/exports/set.json').sources[0].path, '/project/linked/../details.lcad');
    assert.equal(relocateDrawingSheetSet(fixture('plans\\ground.lcad'), 'C:\\Project\\set.json', 'D:\\Export\\set.json').sources[0].path, 'C:\\Project\\plans\\ground.lcad');
    assert.equal(relocateDrawingSheetSet(fixture('ground.lcad'), '\\\\server\\share\\set.json', 'C:\\Export\\set.json').sources[0].path, '\\\\server\\share\\ground.lcad');
});

test('browser downloads keep authored paths; native relative sources need an established base', () => {
    const set = fixture();
    assert.deepEqual(relocateDrawingSheetSet(set, null, null), { ...set, properties: {} });
    assert.throws(() => relocateDrawingSheetSet(set, null, '/exports/set.json'), /sheetSetPathContext/);
    assert.throws(() => relocateDrawingSheetSet(set, '/project/set.json', 'relative.json'), /sheetSetPath/);
    assert.throws(() => relocateDrawingSheetSet(set, '/project/set.json', '/exports/set.lcad'), /sheetSetPath/);
    assert.equal(relocateDrawingSheetSet(fixture('/project/main.lcad'), null, '/exports/set.json').sources[0].path, '/project/main.lcad');
});
