import { DOMParser } from '@xmldom/xmldom';
import { readBoundedZip } from './boundedZip.js';

// XPS fixed payload hierarchy: https://www.ecma-international.org/wp-content/uploads/XPS-Standard.pdf
const XPS = 'http://schemas.microsoft.com/xps/2005/06';
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAX_XML_BYTES = 8 * 1024 * 1024;

/** Resolve an internal OPC part URI. Never resolve against the host filesystem or network. */
export function resolveDrawingPackagePart(base, target) {
    if (typeof target !== 'string' || !target || /[\\?#\x00-\x20]/.test(target) || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) throw new Error('dwfxPart');
    const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
    for (const encoded of target.replace(/^\//, '').split('/')) {
        let part;
        try { part = decodeURIComponent(encoded); } catch { throw new Error('dwfxPart'); }
        if (!part || /[\\/:\x00-\x1f]/.test(part)) throw new Error('dwfxPart');
        if (part === '.') continue;
        if (part === '..') { if (!parts.length) throw new Error('dwfxPart'); parts.pop(); }
        else parts.push(part);
    }
    if (!parts.length) throw new Error('dwfxPart');
    return parts.join('/');
}

export function readDrawingPackageXml(files, path, expectedName, namespace) {
    const bytes = files.get(path);
    if (!bytes || bytes.length > MAX_XML_BYTES) throw new Error('dwfxPart');
    let text;
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe || bytes[0] === 0x3c && bytes[1] === 0 ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff || bytes[0] === 0 && bytes[1] === 0x3c ? 'utf-16be' : 'utf-8';
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch { throw new Error('dwfxXml'); }
    const declared = /^\s*<\?xml\s[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i.exec(text)?.[1]?.toLowerCase();
    if (declared && declared !== encoding && !(declared === 'utf-16' && encoding.startsWith('utf-16'))) throw new Error('dwfxXml');
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('dwfxXml');
    let document;
    try {
        document = new DOMParser({ onError: () => { throw new Error('dwfxXml'); } }).parseFromString(text, 'application/xml');
    } catch { throw new Error('dwfxXml'); }
    const root = document.documentElement;
    if (!root || root.localName !== expectedName || root.namespaceURI !== namespace) throw new Error('dwfxXml');
    return root;
}

const children = (element, name, namespace) => {
    const result = [];
    for (let child = element.firstChild; child; child = child.nextSibling) {
        if (child.nodeType !== 1) continue;
        if (child.localName !== name || child.namespaceURI !== namespace) throw new Error('dwfxXml');
        result.push(child);
    }
    return result;
};

/** Read ordered XPS page parts from a DWFx package; this does not yet render artwork. */
export function readDrawingDwfxPackage(bytes, { maxPages = 10000, zipLimits } = {}) {
    const files = readBoundedZip(bytes, zipLimits);
    const root = readDrawingPackageXml(files, '_rels/.rels', 'Relationships', RELATIONSHIPS);
    const relationships = children(root, 'Relationship', RELATIONSHIPS);
    const ids = new Set();
    for (const relationship of relationships) {
        const id = relationship.getAttribute('Id');
        if (!id || ids.has(id)) throw new Error('dwfxXml');
        ids.add(id);
    }
    const fixed = relationships.filter(item => item.getAttribute('Type') === `${XPS}/fixedrepresentation`);
    if (fixed.length !== 1 || fixed[0].getAttribute('TargetMode') === 'External') throw new Error('dwfxPart');
    const sequencePath = resolveDrawingPackagePart('', fixed[0].getAttribute('Target'));
    const sequence = readDrawingPackageXml(files, sequencePath, 'FixedDocumentSequence', XPS);
    const documents = children(sequence, 'DocumentReference', XPS); const pages = [];
    if (documents.length > maxPages) throw new Error('dwfxLimit');
    const cache = new Map();
    const read = (path, name) => {
        const key = `${name}:${path}`;
        if (!cache.has(key)) cache.set(key, readDrawingPackageXml(files, path, name, XPS));
        return cache.get(key);
    };
    for (const reference of documents) {
        const documentPath = resolveDrawingPackagePart(sequencePath, reference.getAttribute('Source'));
        const document = read(documentPath, 'FixedDocument');
        for (const pageReference of children(document, 'PageContent', XPS)) {
            if (pages.length >= maxPages) throw new Error('dwfxLimit');
            const path = resolveDrawingPackagePart(documentPath, pageReference.getAttribute('Source'));
            const page = read(path, 'FixedPage');
            const width = Number(page.getAttribute('Width')); const height = Number(page.getAttribute('Height'));
            if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 1e7)) throw new Error('dwfxPage');
            pages.push({ path, documentPath, width, height, widthMetres: width * .0254 / 96, heightMetres: height * .0254 / 96 });
        }
    }
    if (!pages.length) throw new Error('dwfxPage');
    return { files, pages, sequencePath };
}
