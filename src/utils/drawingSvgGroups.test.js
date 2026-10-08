import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { Resvg } from '@resvg/resvg-js';
import { flattenDrawingSvgGroups } from './drawingSvgGroups.js';

function svg(body) {
    const root = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${body}</svg>`, 'image/svg+xml').documentElement;
    // xmldom has no CSSStyleDeclaration; these fixtures use simple resolved styles.
    for (const element of Array.from(root.getElementsByTagName('*'))) {
        const properties = Object.fromEntries((element.getAttribute('style') || '').split(';').filter(Boolean).map(item => item.split(':').map(value => value.trim())));
        element.style = { getPropertyValue: name => properties[name] || '' };
    }
    return root;
}
const render = root => new Resvg(new XMLSerializer().serializeToString(root)).render().pixels;

test('export group flattening preserves nested affine order and rendered pixels', () => {
    const root = svg('<g transform="translate(20 10)"><g transform="rotate(25) scale(2)"><path d="M 0 0 L 20 0 L 10 20 Z" fill="red"/><line x1="0" y1="0" x2="20" y2="20" stroke="blue" stroke-width="2" transform="translate(2 0)"/></g></g>');
    const before = render(root);
    flattenDrawingSvgGroups(root);
    assert.equal(root.getElementsByTagName('g').length, 0);
    assert.equal(root.getElementsByTagName('line')[0].getAttribute('transform'), 'translate(20 10) rotate(25) scale(2) translate(2 0)');
    assert.deepEqual(render(root), before);
});

test('export flattening retains compositing, clips, hidden and referenced group boundaries', () => {
    const root = svg('<defs><clipPath id="clip"><rect width="50" height="50"/></clipPath></defs><g transform="translate(10 5)"><g style="opacity: 0.5"><rect width="30" height="30" fill="red"/><rect x="10" width="30" height="30" fill="blue"/></g><g clip-path="url(#clip)"><circle cx="50" cy="50" r="30" fill="green"/></g><g id="reference"><path d="M 5 60 L 40 60" stroke="red"/></g><g style="display: none"><rect width="90" height="90" fill="black"/></g></g>');
    const before = render(root);
    flattenDrawingSvgGroups(root);
    assert.equal(root.getElementsByTagName('g').length, 5);
    assert.equal(root.getElementsByTagName('defs')[0].hasAttribute('transform'), false);
    assert.deepEqual(render(root), before);
});


test('export flattening does not change transforms of externally reused ID targets', () => {
    const root = svg('<g transform="translate(10 15)"><g><path id="motif" d="M 0 0 L 20 0 L 10 20 Z" fill="red"/></g></g><use href="#motif" x="60" y="10"/>');
    const before = render(root);
    flattenDrawingSvgGroups(root);
    assert.equal(root.getElementsByTagName('path')[0].hasAttribute('transform'), false);
    assert.deepEqual(render(root), before);
});
