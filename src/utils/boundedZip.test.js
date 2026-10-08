import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, Zip, ZipDeflate, strToU8 } from 'fflate';
import { readBoundedZip } from './boundedZip.js';

test('bounded ZIP accepts streaming data descriptors while validating their sizes and CRC', () => {
    const chunks = [];
    const zip = new Zip((error, bytes) => { assert.ifError(error); chunks.push(bytes); });
    const entry = new ZipDeflate('stream.txt'); zip.add(entry); entry.push(strToU8('stream content'), true); zip.end();
    const bytes = Uint8Array.from(Buffer.concat(chunks));
    assert.equal(new TextDecoder().decode(readBoundedZip(bytes).get('stream.txt')), 'stream content');
    const corrupt = bytes.slice(); const view = new DataView(corrupt.buffer);
    let descriptor = 0;
    while (view.getUint32(descriptor, true) !== 0x08074b50) descriptor++;
    corrupt[descriptor + 4] ^= 1;
    assert.throws(() => readBoundedZip(corrupt), /zipInvalid/);
});

test('bounded ZIP refuses falsified inflated sizes and overlapping or duplicate directory records', () => {
    const bytes = zipSync({ 'a.txt': new Uint8Array(100000), 'b.txt': strToU8('b') });
    const view = new DataView(bytes.buffer); const directory = view.getUint32(bytes.length - 6, true);
    const falsified = bytes.slice(); const fakeView = new DataView(falsified.buffer);
    fakeView.setUint32(22, 1, true); fakeView.setUint32(directory + 24, 1, true);
    assert.throws(() => readBoundedZip(falsified), /zipInvalid/);
    const second = directory + 46 + view.getUint16(directory + 28, true) + view.getUint16(directory + 30, true) + view.getUint16(directory + 32, true);
    const overlap = bytes.slice(); new DataView(overlap.buffer).setUint32(second + 42, 0, true);
    assert.throws(() => readBoundedZip(overlap), /zipInvalid/);
    const duplicate = bytes.slice(); duplicate[second + 46] = 97;
    assert.throws(() => readBoundedZip(duplicate), /zipInvalid/);
});
