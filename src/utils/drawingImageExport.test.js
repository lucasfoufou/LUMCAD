import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDrawingImageExport, drawingImageExportBytes } from './drawingImageExport.js';
import { drawingRasterExportFrame } from './drawingRasterExport.js';

test('image options preserve explicit background, resolution, quality and quoted destination', () => {
    assert.deepEqual(parseDrawingImageExport('WIDTH 1024 BACKGROUND #123ABC QUALITY .8 TO "/tmp/a b.jpeg"', 'jpg'),
        { format: 'jpg', path: '/tmp/a b.jpeg', width: 1024, background: '#123abc', quality: .8 });
    assert.equal(parseDrawingImageExport('', 'png').background, 'transparent');
    assert.equal(parseDrawingImageExport('', 'svg').background, 'transparent');
    for (const input of ['BACKGROUND TRANSPARENT', 'QUALITY 0', 'QUALITY 2', 'WIDTH 63', 'WIDTH 4097', 'WIDTH 2.5', 'WIDTH 64 WIDTH 65', 'TO a.png', 'QUALITY nope']) {
        assert.throws(() => parseDrawingImageExport(input, 'jpg'), /syntax/);
    }
    assert.throws(() => parseDrawingImageExport('QUALITY .8', 'png'), /syntax/);
    assert.throws(() => parseDrawingImageExport('TO file.lcad', 'svg'), /syntax/);
});

test('transparent image framing keeps existing size and stroke bounds', () => {
    const frame = drawingRasterExportFrame({ minX: 0, minY: 0, maxX: 5, maxY: 2 }, { width: 512, strokePadding: 8, background: 'transparent' });
    assert.equal(frame.background, 'transparent');
    assert.ok(frame.width <= 512 && frame.height <= 4096);
    assert.ok(frame.viewBox.x < 0 && frame.viewBox.x + frame.viewBox.width > 5);
    assert.deepEqual([...drawingImageExportBytes({ dataUrl: 'data:image/png;base64,AQID' }, 'png')], [1, 2, 3]);
    assert.equal(new TextDecoder().decode(drawingImageExportBytes({ text: '<svg>é</svg>' }, 'svg')), '<svg>é</svg>');
});
