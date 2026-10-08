import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveDrawingDgnUnits } from './drawingDgnUnits.js';
import { readDrawingDgnPalette } from './drawingDgnPalette.js';
import { readDrawingDgnLinkages, drawingDgnFillIndex } from './drawingDgnLinkages.js';

const header = (masterUnit, subUnit, subunitsPerMaster) => ({ masterUnit, subUnit, subunitsPerMaster });

test('DGN physical units resolve known labels, derive from subunits and distinguish US survey feet', () => {
    assert.deepEqual(resolveDrawingDgnUnits(header(' M ', 'mm', 1000)), { unit: 'm', metresPerMaster: 1, source: 'master' });
    assert.deepEqual(resolveDrawingDgnUnits(header('mu', 'mm', 1000)), { unit: null, metresPerMaster: 1, source: 'subunit' });
    assert.equal(resolveDrawingDgnUnits(header('ft', 'in', 12)).metresPerMaster, 0.3048);
    assert.equal(resolveDrawingDgnUnits(header('mu', 'su', 10), 'us-ft').metresPerMaster, 1200 / 3937);
    assert.equal(resolveDrawingDgnUnits(header('mm', 'su', 10)).metresPerMaster, 0.001);
    assert.deepEqual(resolveDrawingDgnUnits(header('m', 'mm', 12), 'cm'), { unit: 'cm', metresPerMaster: 0.01, source: 'override' });
});

test('ambiguous and inconsistent DGN unit labels require explicit correction', () => {
    for (const value of [header('mu', 'su', 10), header('m', 'mm', 12), header('__proto__', 'su', 10)]) {
        assert.throws(() => resolveDrawingDgnUnits(value), /dgnUnits/);
    }
    assert.throws(() => resolveDrawingDgnUnits(header('m', 'mm', 0)), /dgnInvalid/);
    assert.throws(() => resolveDrawingDgnUnits(header('m', 'mm', 1000), 'unknown'), /dgnUnits/);
    assert.throws(() => resolveDrawingDgnUnits(header('m', 'mm', 1000), ''), /dgnUnits/);
});

function palette(value) {
    const bytes = new Uint8Array(806);
    bytes.set([1, 5, 145, 1]); bytes.fill(value, 38);
    bytes.set([12, 34, 56], 38); bytes.set([1, 2, 3], 41); bytes.set([4, 5, 6], 803);
    return { type: 5, level: 1, deleted: false, bytes };
}

test('DGN palette indices preserve conventional colors and caller ownership', () => {
    const result = readDrawingDgnPalette([]);
    assert.equal(result.embedded, false); assert.equal(result.colors.length, 256);
    assert.deepEqual(result.colors.slice(0, 8), ['#ffffff', '#0000ff', '#00ff00', '#ff0000', '#ffff00', '#ff00ff', '#ff7f00', '#00ffff']);
    assert.equal(result.colors[83], '#b40000'); assert.equal(result.colors[255], '#1c0064');
    result.colors[0] = '#123456'; assert.equal(readDrawingDgnPalette([]).colors[0], '#ffffff');
});

test('DGN embedded palette uses its special background slot and the last active table', () => {
    const first = palette(30); const second = palette(80); const ignored = { ...palette(120), deleted: true };
    const result = readDrawingDgnPalette([first, second, ignored]);
    assert.equal(result.embedded, true); assert.equal(result.colors[0], '#010203');
    assert.equal(result.colors[1], '#505050'); assert.equal(result.colors[254], '#040506');
    assert.equal(result.colors[255], '#0c2238'); second.bytes.fill(0);
    assert.equal(result.colors[1], '#505050');
    assert.throws(() => readDrawingDgnPalette([{ ...first, bytes: first.bytes.slice(0, -1) }]), /dgnInvalid/);
});

const fill = Uint8Array.from([7, 16, 65, 0, 2, 8, 1, 0, 83, 0, 0, 0, 0, 0, 0, 0]);

test('DGN attribute links preserve database metadata without dereferencing and decode shape fill', () => {
    const bytes = Uint8Array.from([0, 128, 12, 0, 1, 2, 3, 0, ...fill, 2, 16, 99, 0, 1, 2]);
    const links = readDrawingDgnLinkages(bytes);
    assert.deepEqual(links.map(link => link.type), ['dmrs', 65, 99]);
    assert.equal(drawingDgnFillIndex(links), 83); bytes.fill(0);
    assert.equal(links[1].bytes[8], 83); assert.equal(drawingDgnFillIndex([]), null);
});

test('DGN attribute parsing rejects truncation, impossible lengths, ambiguous fill and excess work', () => {
    for (const bytes of [fill.slice(0, -2), Uint8Array.from([1, 16, 65, 0]), Uint8Array.from([0, 0, 1, 0]), Uint8Array.from([7])]) {
        assert.throws(() => readDrawingDgnLinkages(bytes), /dgnInvalid/);
    }
    assert.throws(() => readDrawingDgnLinkages(Uint8Array.from([2, 8, 65, 0, 0, 0])), /dgnUnsupported/);
    assert.throws(() => drawingDgnFillIndex(readDrawingDgnLinkages(Uint8Array.from([...fill, ...fill]))), /dgnInvalid/);
    assert.throws(() => drawingDgnFillIndex(readDrawingDgnLinkages(Uint8Array.from([2, 16, 65, 0, 0, 0]))), /dgnInvalid/);
    assert.throws(() => readDrawingDgnLinkages(Uint8Array.from([...fill, ...fill]), { maxLinkages: 1 }), /dgnLimit/);
});
