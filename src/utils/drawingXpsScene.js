import { createDrawingXpsGlyphReader } from './drawingXpsGlyphs.js';
import { drawingDashPaths } from './drawingDashPaths.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';
import { normalizeCurvePrimitive } from './drawingCurveKernel.js';
import { readDrawingXpsImage } from './drawingXpsImages.js';
import { multiplyAffineMatrices, normalizeAffineMatrix } from './drawingAffine.js';
import { readDrawingPackageXml, resolveDrawingPackagePart } from './drawingDwfxPackage.js';
import { parseDrawingXpsGeometry } from './drawingXpsGeometry.js';
import { drawingCurvePathToSvgData } from './drawingCurveSvg.js';

const XPS = 'http://schemas.microsoft.com/xps/2005/06';
const common = ['Name', 'RenderTransform', 'Clip', 'Opacity'];
const pathAttributes = [...common, 'Data', 'Fill', 'Stroke', 'StrokeThickness', 'StrokeDashArray', 'StrokeDashOffset',
    'StrokeStartLineCap', 'StrokeEndLineCap', 'StrokeDashCap', 'StrokeLineJoin', 'StrokeMiterLimit'];
const invalid = () => { throw new Error('dwfxVisual'); };
const unsupported = () => { throw new Error('dwfxUnsupported'); };
function scalar(value, fallback, minimum = -1e12, maximum = 1e12) {
    if (value === null || value === '') return fallback;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) invalid();
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) invalid();
    return number;
}
function list(value, maximum = 10000) {
    if (!value?.trim() || /^,|,$|,\s*,/.test(value.trim())) invalid();
    if (value.length > 1024 * 1024) throw new Error('dwfxLimit');
    const tokens = value.trim().split(/[\s,]+/);
    if (tokens.length > maximum) throw new Error('dwfxLimit');
    return tokens.map(number => scalar(number, NaN));
}
function brush(value) {
    if (value === null || value === '') return null;
    if (!/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) unsupported();
    let hex = value.slice(1);
    if (hex.length <= 4) hex = [...hex].map(character => character.repeat(2)).join('');
    if (hex.length === 6) hex = `ff${hex}`;
    return { color: `#${hex.slice(2).toLowerCase()}`, opacity: parseInt(hex.slice(0, 2), 16) / 255 };
}
function attributes(element, allowed, resource = false) {
    for (const attribute of Array.from(element.attributes)) {
        if (attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/' || attribute.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && attribute.localName === 'lang') continue;
        if (resource && ['http://schemas.microsoft.com/winfx/2006/xaml', 'http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key'].includes(attribute.namespaceURI) && attribute.localName === 'Key') continue;
        if (attribute.namespaceURI || !allowed.includes(attribute.name)) unsupported();
    }
}

/** Interpret a page into an inert scene. Unsupported visuals reject the entire candidate. */
export function readDrawingXpsScene(files, page, { maxNodes = 100000, maxParts = 100000, maxDepth = 64 } = {}) {
    const root = readDrawingPackageXml(files, page.path, 'FixedPage', XPS);
    const width = scalar(root.getAttribute('Width'), NaN, 0, 1e7);
    const height = scalar(root.getAttribute('Height'), NaN, 0, 1e7);
    if (!(width > 0 && height > 0)) invalid();
    let nodes = 0; let parts = 0;
    const geometry = value => {
        const parsed = parseDrawingXpsGeometry(value);
        parts += parsed.paths.reduce((sum, path) => sum + path.parts.length, 0);
        if (parts > maxParts) throw new Error('dwfxLimit');
        return parsed;
    };
    const elements = element => {
        const result = [];
        for (let child = element.firstChild; child; child = child.nextSibling) {
            if (child.nodeType === 1) {
                if (child.namespaceURI !== XPS) unsupported();
                result.push(child);
            } else if ((child.nodeType === 3 || child.nodeType === 4) && child.data.trim()) invalid();
        }
        return result;
    };
    const count = () => { if (++nodes > maxNodes) throw new Error('dwfxLimit'); };
    const matrixElement = (element, resource = false) => {
        count();
        if (element.localName !== 'MatrixTransform') unsupported();
        attributes(element, ['Matrix'], resource);
        if (elements(element).length) unsupported();
        const matrix = list(element.getAttribute('Matrix'), 6);
        if (matrix.length !== 6) invalid();
        return { kind: 'matrix', matrix };
    };
    const resourceValue = (value, scope) => {
        const reference = /^\{StaticResource\s+([^{}\s]+)\}$/.exec(value || '');
        if (!reference) return null;
        for (let current = scope; current; current = current.parent) {
            if (current.values.has(reference[1])) return current.values.get(reference[1]);
        }
        throw new Error('dwfxResource');
    };
    const matrixProperty = (element, name, children, scope = null) => {
        const properties = children.filter(child => child.localName === `${element.localName}.${name}`);
        if (properties.length > 1 || properties.length && element.hasAttribute(name)) invalid();
        let matrix;
        if (properties.length) {
            count(); attributes(properties[0], []);
            const entries = elements(properties[0]);
            if (entries.length !== 1) invalid();
            matrix = matrixElement(entries[0]).matrix;
        } else {
            const value = element.getAttribute(name);
            const resource = resourceValue(value, scope);
            if (resource && resource.kind !== 'matrix') invalid();
            matrix = resource ? resource.matrix : value ? list(value, 6) : [1, 0, 0, 1, 0, 0];
        }
        if (matrix.length !== 6 || !matrix.every(Number.isFinite)) invalid();
        return { matrix, children: children.filter(child => child !== properties[0]) };
    };
    const boolean = (value, fallback) => {
        if (value === null || value === '') return fallback;
        if (!['true', 'false', '1', '0'].includes(value)) invalid();
        return value === 'true' || value === '1';
    };
    const geometryElement = (element, resource = false, scope = null) => {
        count();
        if (element.localName !== 'PathGeometry') unsupported();
        attributes(element, ['Figures', 'FillRule', 'Transform'], resource);
        const rule = element.getAttribute('FillRule') || 'EvenOdd';
        if (!['EvenOdd', 'NonZero'].includes(rule)) invalid();
        const { matrix, children: figures } = matrixProperty(element, 'Transform', elements(element), scope);
        let parsed;
        if (element.hasAttribute('Figures')) {
            if (figures.length || /^\s*F/.test(element.getAttribute('Figures'))) invalid();
            parsed = geometry(element.getAttribute('Figures'));
        } else {
            const paths = []; const strokePaths = []; let hasGaps = false; let closedGaps = false;
            for (const figure of figures) {
                const commands = [];
                count();
                if (figure.localName !== 'PathFigure') unsupported();
                attributes(figure, ['StartPoint', 'IsClosed', 'IsFilled']);
                const filled = boolean(figure.getAttribute('IsFilled'), true);
                const start = list(figure.getAttribute('StartPoint'), 2);
                if (start.length !== 2) invalid();
                commands.push(`M ${start.join(' ')}`);
                const runs = []; let run = null; let current = start; let gap = false; let firstStroked = null;
                let endPoint;
                for (const segment of elements(figure)) {
                    count();
                    const arc = segment.localName === 'ArcSegment';
                    attributes(segment, arc ? ['Point', 'Size', 'RotationAngle', 'IsLargeArc', 'SweepDirection', 'IsStroked'] : ['Points', 'IsStroked']);
                    if (elements(segment).length) unsupported();
                    const stroked = boolean(segment.getAttribute('IsStroked'), true);
                    if (firstStroked === null) firstStroked = stroked;
                    if (arc) {
                        const point = list(segment.getAttribute('Point'), 2); const size = list(segment.getAttribute('Size'), 2);
                        const angle = scalar(segment.getAttribute('RotationAngle'), NaN);
                        const large = boolean(segment.getAttribute('IsLargeArc'), null);
                        const sweep = segment.getAttribute('SweepDirection');
                        if (point.length !== 2 || size.length !== 2 || size.some(value => value < 0)
                            || !Number.isFinite(angle) || large === null || !['Clockwise', 'Counterclockwise'].includes(sweep)) invalid();
                        commands.push(`A ${size.join(' ')} ${angle} ${large ? 1 : 0} ${sweep === 'Clockwise' ? 1 : 0} ${point.join(' ')}`);
                        endPoint = point;
                    } else {
                        const types = { PolyLineSegment: ['L', 2], PolyBezierSegment: ['C', 6], PolyQuadraticBezierSegment: ['Q', 4] };
                        const type = types[segment.localName];
                        if (!type) unsupported();
                        const points = list(segment.getAttribute('Points'));
                        if (points.length % type[1]) invalid();
                        commands.push(`${type[0]} ${points.join(' ')}`);
                        endPoint = points.slice(-2);
                    }
                    if (stroked) {
                        if (!run) { run = [`M ${current.join(' ')}`]; runs.push(run); }
                        run.push(commands[commands.length - 1]);
                    } else { run = null; gap = true; }
                    current = endPoint;
                }
                const closed = boolean(figure.getAttribute('IsClosed'), false);
                if (closed) commands.push('Z');
                const figurePaths = geometry(commands.join(' ')).paths;
                paths.push(...figurePaths.map(path => filled ? path : { ...path, filled: false }));
                if (gap) {
                    hasGaps = true; closedGaps ||= closed;
                    if (closed) {
                        if (!run) { run = [`M ${current.join(' ')}`]; runs.push(run); }
                        run.push(`L ${start.join(' ')}`);
                        if (firstStroked && runs.length > 1) {
                            run.dashRestartAfter = geometry(run.join(' ')).paths.reduce((sum, path) => sum + path.parts.length, 0);
                            run.push(...runs[0].slice(1)); runs.shift();
                        }
                    }
                    for (const commands of runs) strokePaths.push(...geometry(commands.join(' ')).paths.map(path => ({ ...path, ...(commands.dashRestartAfter ? { dashRestartAfter: commands.dashRestartAfter } : {}) })));
                } else strokePaths.push(...figurePaths);

            }
            parsed = { paths, ...(hasGaps ? { strokePaths, closedGaps } : {}) };
        }
        const affine = normalizeAffineMatrix(matrix);
        if (Math.abs(affine.a * affine.d - affine.b * affine.c) < 1e-12) unsupported();
        const identity = matrix.every((value, index) => value === [1, 0, 0, 1, 0, 0][index]);
        const transformPaths = paths => paths.map(path => ({ ...path, parts: path.parts.map(part => {
            const transformed = identity ? part : transformDrawingEntityAffine(part, affine);
            if (!normalizeCurvePrimitive(transformed)) invalid();
            return transformed;
        }) }));
        const paths = transformPaths(parsed.paths);
        return { kind: 'geometry', paths, ...(parsed.strokePaths ? { strokePaths: transformPaths(parsed.strokePaths), closedGaps: parsed.closedGaps } : {}), rule: rule === 'NonZero' ? 'nonzero' : 'evenodd' };
    };
    const images = new Map(); let imagePixels = 0;
    const paintElement = (element, resource = false, base = page.path, scope = null) => {
        count();
        const opacity = scalar(element.getAttribute('Opacity'), 1, 0, 1);
        if (element.localName === 'SolidColorBrush') {
            attributes(element, ['Color', 'Opacity'], resource);
            if (elements(element).length) unsupported();
            const paint = brush(element.getAttribute('Color'));
            if (!paint) invalid();
            return { ...paint, opacity: paint.opacity * opacity };
        }
        if (element.localName === 'ImageBrush') {
            attributes(element, ['ImageSource', 'Opacity', 'Viewbox', 'Viewport', 'ViewboxUnits', 'ViewportUnits', 'TileMode', 'Transform'], resource);
            const { matrix, children } = matrixProperty(element, 'Transform', elements(element), scope);
            if (children.length || element.getAttribute('ViewboxUnits') !== 'Absolute'
                || element.getAttribute('ViewportUnits') !== 'Absolute' || !['', 'None', 'Tile', 'FlipX', 'FlipY', 'FlipXY'].includes(element.getAttribute('TileMode') || '')) unsupported();
            const source = resolveDrawingPackagePart(base, element.getAttribute('ImageSource'));
            if (!images.has(source)) {
                const image = readDrawingXpsImage(files.get(source), { maxPixels: 16000000 - imagePixels });
                imagePixels += image.width * image.height;
                if (imagePixels > 16000000) throw new Error('dwfxLimit');
                images.set(source, image);
            }
            const viewbox = list(element.getAttribute('Viewbox'), 4); const viewport = list(element.getAttribute('Viewport'), 4);
            if ([viewbox, viewport].some(rect => rect.length !== 4 || rect[2] <= 0 || rect[3] <= 0)) invalid();
            const sx = viewport[2] / viewbox[2]; const sy = viewport[3] / viewbox[3];
            const image = images.get(source);
            if (![sx, sy, image.widthUnits * sx, image.heightUnits * sy, viewport[0] - viewbox[0] * sx, viewport[1] - viewbox[1] * sy].every(Number.isFinite)) invalid();
            return { kind: 'image', image: images.get(source), viewbox, viewport, matrix, opacity, tileMode: element.getAttribute('TileMode') || 'None' };
        }
        const radial = element.localName === 'RadialGradientBrush';
        if (!radial && element.localName !== 'LinearGradientBrush') unsupported();
        attributes(element, ['Opacity', ...(radial ? ['Center', 'GradientOrigin', 'RadiusX', 'RadiusY'] : ['StartPoint', 'EndPoint']), 'MappingMode', 'SpreadMethod', 'ColorInterpolationMode', 'Transform'], resource);
        if (element.getAttribute('MappingMode') !== 'Absolute') unsupported();
        const start = list(element.getAttribute(radial ? 'Center' : 'StartPoint'), 2);
        const end = list(element.getAttribute(radial ? 'GradientOrigin' : 'EndPoint'), 2);
        if (start.length !== 2 || end.length !== 2) invalid();
        const radii = radial ? [scalar(element.getAttribute('RadiusX'), NaN, 0), scalar(element.getAttribute('RadiusY'), NaN, 0)] : null;
        if (radial && !radii.every(value => Number.isFinite(value) && value > 0)) unsupported();
        if (radial && Math.hypot((end[0] - start[0]) / radii[0], (end[1] - start[1]) / radii[1]) >= 1) unsupported();
        const { matrix, children: properties } = matrixProperty(element, 'Transform', elements(element), scope);
        const spread = element.getAttribute('SpreadMethod') || 'Pad';
        if (!['Pad', 'Reflect', 'Repeat'].includes(spread)) unsupported();
        const interpolation = element.getAttribute('ColorInterpolationMode') || 'SRgbLinearInterpolation';
        if (!['SRgbLinearInterpolation', 'ScRgbLinearInterpolation'].includes(interpolation)) unsupported();
        if (properties.length !== 1 || properties[0].localName !== `${element.localName}.GradientStops`) unsupported();
        attributes(properties[0], []);
        const stops = elements(properties[0]).map(stop => {
            count();
            if (stop.localName !== 'GradientStop') unsupported();
            attributes(stop, ['Color', 'Offset']);
            if (elements(stop).length) unsupported();
            const color = brush(stop.getAttribute('Color'));
            const offset = scalar(stop.getAttribute('Offset'), NaN, 0, 1);
            if (!color || !Number.isFinite(offset)) invalid();
            return { ...color, offset };
        });
        if (!stops.length) invalid();
        stops.sort((a, b) => a.offset - b.offset);
        return { kind: radial ? 'radial' : 'linear', start, end, radii, matrix, opacity, stops, spread: spread.toLowerCase(),
            interpolation: interpolation === 'ScRgbLinearInterpolation' ? 'linearRGB' : 'sRGB' };
    };
    const glyphReader = createDrawingXpsGlyphReader(files, page.path);
    const dictionaries = new Map();
    const dictionary = (element, base, depth, visited = new Set()) => {
        count();
        if (depth > maxDepth) throw new Error('dwfxLimit');
        if (element.localName !== 'ResourceDictionary') unsupported();
        attributes(element, ['Source']);
        const items = elements(element);
        if (element.hasAttribute('Source')) {
            if (items.length) invalid();
            const path = resolveDrawingPackagePart(base, element.getAttribute('Source'));
            if (visited.has(path)) throw new Error('dwfxResourceCycle');
            if (dictionaries.has(path)) return dictionaries.get(path);
            visited.add(path);
            const result = dictionary(readDrawingPackageXml(files, path, 'ResourceDictionary', XPS), path, depth + 1, visited);
            dictionaries.set(path, result);
            return result;
        }
        const result = new Map();
        for (const item of items) {
            const key = item.getAttributeNS('http://schemas.microsoft.com/xps/2005/06/resourcedictionary-key', 'Key')
                || item.getAttributeNS('http://schemas.microsoft.com/winfx/2006/xaml', 'Key');
            if (!key || result.has(key)) invalid();
            result.set(key, item.localName === 'MatrixTransform' ? matrixElement(item, true)
                : item.localName === 'PathGeometry' ? geometryElement(item, true, { values: result }) : paintElement(item, true, base, { values: result }));
        }
        return result;
    };
    const read = (element, depth, inherited = null) => {
        if (++nodes > maxNodes || depth > maxDepth) throw new Error('dwfxLimit');
        if (element.namespaceURI !== XPS || !['FixedPage', 'Canvas', 'Path', 'Glyphs'].includes(element.localName)) unsupported();
        if (element.localName === 'FixedPage' && depth !== 0) invalid();
        const isGlyphs = element.localName === 'Glyphs';
        const isPath = element.localName === 'Path' || isGlyphs;
        attributes(element, isGlyphs ? [...common, 'FontUri', 'FontRenderingEmSize', 'OriginX', 'OriginY', 'UnicodeString', 'Indices', 'Fill', 'BidiLevel', 'IsSideways', 'StyleSimulations', 'DeviceFontName'] : isPath ? pathAttributes : element.localName === 'FixedPage' ? ['Width', 'Height', 'ContentBox', 'BleedBox', ...common] : common);
        let children = elements(element);
        const scope = { parent: inherited, values: new Map() };
        const resources = children.filter(child => child.localName === `${element.localName}.Resources`);
        if (resources.length > 1) invalid();
        if (resources.length) {
            attributes(resources[0], []);
            const entries = elements(resources[0]);
            if (entries.length !== 1) invalid();
            scope.values = dictionary(entries[0], page.path, depth + 1);
            children = children.filter(child => child !== resources[0]);
        }
        const transformed = matrixProperty(element, 'RenderTransform', children, scope);
        const matrix = transformed.matrix; children = transformed.children;
        const readGeometry = name => {
            const properties = children.filter(child => child.localName === `${element.localName}.${name}`);
            if (properties.length > 1 || properties.length && element.hasAttribute(name)) invalid();
            if (properties.length) {
                count();
                attributes(properties[0], []);
                const entries = elements(properties[0]);
                if (entries.length !== 1) invalid();
                children = children.filter(child => child !== properties[0]);
                return geometryElement(entries[0], false, scope);
            }
            const value = element.getAttribute(name);
            if (!element.hasAttribute(name)) return null;
            const resource = resourceValue(value, scope);
            if (resource && resource.kind !== 'geometry') invalid();
            if (resource) {
                parts += [...resource.paths, ...(resource.strokePaths || [])].reduce((sum, path) => sum + path.parts.length, 0);
                if (parts > maxParts) throw new Error('dwfxLimit');
            }
            return resource || geometry(value);
        };
        const node = { type: isPath ? 'path' : 'group', matrix,
            opacity: scalar(element.getAttribute('Opacity'), 1, 0, 1),
            clip: readGeometry('Clip') };
        if (!isPath) return { ...node, children: children.map(child => read(child, depth + 1, scope)) };
        const paint = name => {
            const properties = children.filter(child => child.localName === `${element.localName}.${name}`);
            if (properties.length > 1 || properties.length && element.hasAttribute(name)) invalid();
            if (properties.length) {
                attributes(properties[0], []);
                const entries = elements(properties[0]);
                if (entries.length !== 1) invalid();
                return paintElement(entries[0], false, page.path, scope);
            }
            const value = element.getAttribute(name);
            const resource = resourceValue(value, scope);
            if (['matrix', 'geometry'].includes(resource?.kind)) invalid();
            return resource || brush(value);
        };
        if (isGlyphs) {
            if (children.some(child => child.localName !== 'Glyphs.Fill')) unsupported();
            node.geometry = glyphReader({ fontUri: element.getAttribute('FontUri'), unicodeString: element.getAttribute('UnicodeString') || '',
                indices: element.getAttribute('Indices') || '', fontSize: scalar(element.getAttribute('FontRenderingEmSize'), NaN, 0, 1e6),
                x: scalar(element.getAttribute('OriginX'), NaN), y: scalar(element.getAttribute('OriginY'), NaN),
                bidiLevel: scalar(element.getAttribute('BidiLevel'), 0, 0, 61),
                isSideways: boolean(element.getAttribute('IsSideways'), false),
                style: element.getAttribute('StyleSimulations') || 'None' }, { maxParts: maxParts - parts });
            node.fill = paint('Fill');
            parts += node.geometry.paths.reduce((sum, path) => sum + path.parts.length, 0) + (node.fill?.stops?.length || 0);
            parts += node.geometry.boldMask?.glyphs.reduce((sum, glyph) => sum + glyph.geometry.paths.reduce((count, path) => count + path.parts.length, 0), 0) || 0;
            if (parts > maxParts) throw new Error('dwfxLimit');
            return { ...node, stroke: null, strokeWidth: 0, lineJoin: 'miter', lineCap: 'butt', miterLimit: 10, dashes: [], dashOffset: 0 };
        }
        node.geometry = readGeometry('Data');
        if (!node.geometry) invalid();
        if (children.some(child => !['Path.Fill', 'Path.Stroke'].includes(child.localName))) unsupported();
        node.fill = paint('Fill');
        node.stroke = paint('Stroke');
        if (node.stroke?.kind === 'image' && node.stroke.tileMode === 'None') unsupported();
        parts += (node.fill?.stops?.length || 0) + (node.stroke?.stops?.length || 0);
        if (parts > maxParts) throw new Error('dwfxLimit');
        node.strokeWidth = scalar(element.getAttribute('StrokeThickness'), 1, 0);
        node.miterLimit = scalar(element.getAttribute('StrokeMiterLimit'), 10, 1);
        const join = element.getAttribute('StrokeLineJoin') || 'Miter';
        if (!['Miter', 'Round', 'Bevel'].includes(join)) unsupported();
        node.lineJoin = join.toLowerCase();
        const start = element.getAttribute('StrokeStartLineCap') || 'Flat';
        const end = element.getAttribute('StrokeEndLineCap') || 'Flat';
        const dash = element.getAttribute('StrokeDashCap') || 'Flat';
        node.dashes = element.hasAttribute('StrokeDashArray') ? list(element.getAttribute('StrokeDashArray')) : [];
        parts += node.dashes.length;
        if (parts > maxParts) throw new Error('dwfxLimit');
        if (node.dashes.some(value => !Number.isFinite(value) || value < 0) || node.dashes.length && !node.dashes.some(value => value > 0)) invalid();
        if (!['Flat', 'Square', 'Round'].includes(start) || start !== end || node.dashes.length && start !== dash) unsupported();
        node.lineCap = start === 'Flat' ? 'butt' : start.toLowerCase();
        node.dashOffset = scalar(element.getAttribute('StrokeDashOffset'), 0);
        if (node.dashes.length && node.geometry.closedGaps) {
            if (node.lineCap === 'square' && node.dashes.some((value, index) => value === 0 && (index % 2 === 0 || node.dashes.length % 2))) unsupported();
            if (node.strokeWidth === 0) node.expandedStrokePaths = [];
            else {
                node.expandedStrokePaths = drawingDashPaths(node.geometry.strokePaths,
                    node.dashes.map(value => value * node.strokeWidth), node.dashOffset * node.strokeWidth,
                    { maxSteps: Math.min(10000, maxParts - parts) });
                parts += node.expandedStrokePaths.reduce((sum, path) => sum + path.parts.length + (path.dot ? 1 : 0), 0);
                if (parts > maxParts) throw new Error('dwfxLimit');
            }
        }
        return node;
    };
    return { width, height, root: read(root, 0), report: { nodes, parts } };
}

/** Serialize only interpreted numeric geometry and paint, never source XML. */
export function drawingXpsSceneSvg(scene, { width = scene.width, height = scene.height } = {}) {
    if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 1e7)) throw new Error('dwfxLimit');
    let id = 0;
    const imageIds = new Map(); const imageDefinitions = [];
    const imageSource = image => {
        if (!imageIds.has(image)) {
            const key = `xps-source-${id++}`;
            imageIds.set(image, key);
            imageDefinitions.push(`<image id="${key}" xlink:href="${image.link}" width="${image.widthUnits}" height="${image.heightUnits}" preserveAspectRatio="none"/>`);
        }
        return imageIds.get(image);
    };
    const data = (geometry, fill = false) => geometry.paths.filter(path => !fill || path.filled !== false).map(path => path.dot ? `M ${path.dot.x} ${path.dot.y} h 0` : drawingCurvePathToSvgData(path)).join(' ');
    const render = node => {
        let clip = ''; let definition = '';
        if (node.clip) {
            const name = `xps-clip-${id++}`;
            definition = `<defs><clipPath id="${name}" clipPathUnits="userSpaceOnUse"><path d="${data(node.clip, true)}" clip-rule="${node.clip.rule}"/></clipPath></defs>`;
            clip = ` clip-path="url(#${name})"`;
        }
        let body;
        if (node.geometry?.boldMask) {
            const mask = node.geometry.boldMask; const name = `xps-bold-${id++}`;
            const area = `x="${mask.x}" y="${mask.y}" width="${mask.spanX}" height="${mask.spanY}"`;
            definition += `<defs><mask id="${name}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" ${area}>`
                + mask.glyphs.map(glyph => `<path transform="matrix(${glyph.matrix.join(' ')})" d="${data(glyph.geometry)}" fill="white" fill-rule="nonzero" stroke="white" stroke-width="${mask.width}" stroke-linejoin="round"/>`).join('') + '</mask></defs>';
            const geometry = parseDrawingXpsGeometry(`M${mask.x} ${mask.y}h${mask.spanX}v${mask.spanY}h${-mask.spanX}Z`);
            body = `<g mask="url(#${name})">${render({ ...node, geometry, matrix: [1, 0, 0, 1, 0, 0], opacity: 1, clip: null })}</g>`;
        } else if (node.type === 'group') body = node.children.map(render).join('');
        else {
            const paint = name => {
                const value = node[name];
                if (!value || value.kind === 'image' && value.tileMode === 'None') return `${name}="none"`;
                if (value.kind === 'image') {
                    const key = `xps-pattern-${id++}`;
                    const source = imageSource(value.image);
                    const [bx, by, bw, bh] = value.viewbox; const [vx, vy, vw, vh] = value.viewport;
                    const sx = vw / bw; const sy = vh / bh;
                    const flipX = ['FlipX', 'FlipXY'].includes(value.tileMode);
                    const flipY = ['FlipY', 'FlipXY'].includes(value.tileMode);
                    const matrix = Object.values(multiplyAffineMatrices(normalizeAffineMatrix(value.matrix), { a: 1, b: 0, c: 0, d: 1, e: vx, f: vy }));
                    const tile = `<g clip-path="url(#${key}-clip)"><use xlink:href="#${source}" transform="matrix(${sx} 0 0 ${sy} ${-bx * sx} ${-by * sy})"/></g>`;
                    definition += `<defs><clipPath id="${key}-clip" clipPathUnits="userSpaceOnUse"><rect width="${vw}" height="${vh}"/></clipPath><pattern id="${key}" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" width="${vw * (flipX ? 2 : 1)}" height="${vh * (flipY ? 2 : 1)}" patternTransform="matrix(${matrix.join(' ')})">`
                        + tile + (flipX ? `<g transform="translate(${2 * vw} 0) scale(-1 1)">${tile}</g>` : '')
                        + (flipY ? `<g transform="translate(0 ${2 * vh}) scale(1 -1)">${tile}</g>` : '')
                        + (flipX && flipY ? `<g transform="translate(${2 * vw} ${2 * vh}) scale(-1 -1)">${tile}</g>` : '') + '</pattern></defs>';
                    return `${name}="url(#${key})" ${name}-opacity="${value.opacity}"`;
                }
                if (!['linear', 'radial'].includes(value.kind)) return `${name}="${value.color}" ${name}-opacity="${value.opacity}"`;
                const key = `xps-gradient-${id++}`;
                const radial = value.kind === 'radial';
                let matrix = value.matrix;
                let coordinates = `x1="${value.start[0]}" y1="${value.start[1]}" x2="${value.end[0]}" y2="${value.end[1]}"`;
                if (radial) {
                    const [cx, cy] = value.start; const [rx, ry] = value.radii;
                    matrix = Object.values(multiplyAffineMatrices(normalizeAffineMatrix(matrix), { a: rx, b: 0, c: 0, d: ry, e: cx, f: cy }));
                    coordinates = `cx="0" cy="0" r="1" fx="${(value.end[0] - cx) / rx}" fy="${(value.end[1] - cy) / ry}"`;
                }
                const tag = radial ? 'radialGradient' : 'linearGradient';
                definition += `<defs><${tag} id="${key}" gradientUnits="userSpaceOnUse" ${coordinates} gradientTransform="matrix(${matrix.join(' ')})" spreadMethod="${value.spread}" color-interpolation="${value.interpolation}">`
                    + value.stops.map(stop => `<stop offset="${stop.offset}" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join('') + `</${tag}></defs>`;
                return `${name}="url(#${key})" ${name}-opacity="${value.opacity}"`;
            };
            const separateFill = Boolean(node.geometry.strokePaths) || node.geometry.paths.some(path => path.filled === false);
            const strokeGeometry = node.expandedStrokePaths ? { paths: node.expandedStrokePaths } : node.geometry.strokePaths ? { paths: node.geometry.strokePaths } : node.geometry;
            const fill = paint('fill');
            body = (separateFill ? `<path d="${data(node.geometry, true)}" fill-rule="${node.geometry.rule}" ${fill} stroke="none"/>` : '')
                + `<path d="${data(strokeGeometry)}" fill-rule="${node.geometry.rule}" ${separateFill ? 'fill="none"' : fill} ${paint('stroke')} stroke-width="${node.strokeWidth}" stroke-linejoin="${node.lineJoin}" stroke-linecap="${node.lineCap}" stroke-miterlimit="${node.miterLimit}"`
                + (node.dashes.length && !node.expandedStrokePaths ? ` stroke-dasharray="${node.dashes.map(value => value * node.strokeWidth).join(' ')}" stroke-dashoffset="${node.dashOffset * node.strokeWidth}"` : '') + '/>';
        }
        if (!node.geometry?.boldMask && node.fill?.kind === 'image' && node.fill.tileMode === 'None') {
            const value = node.fill; const key = `xps-image-${id++}`;
            const [bx, by, bw, bh] = value.viewbox; const [vx, vy, vw, vh] = value.viewport;
            const sx = vw / bw; const sy = vh / bh;
            const imageId = imageSource(value.image);
            definition += `<defs><clipPath id="${key}" clipPathUnits="userSpaceOnUse"><path d="${data(node.geometry, true)}" clip-rule="${node.geometry.rule}"/></clipPath><clipPath id="${key}-tile" clipPathUnits="userSpaceOnUse"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}"/></clipPath></defs>`;
            body = `<g clip-path="url(#${key})" opacity="${value.opacity}"><g transform="matrix(${value.matrix.join(' ')})"><g clip-path="url(#${key}-tile)"><use xlink:href="#${imageId}" transform="matrix(${sx} 0 0 ${sy} ${vx - bx * sx} ${vy - by * sy})"/></g></g></g>` + body;
        }
        return `<g transform="matrix(${node.matrix.join(' ')})" opacity="${node.opacity}">${definition}<g${clip}>${body}</g></g>`;
    };
    const content = render(scene.root);
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${scene.width} ${scene.height}"><defs>${imageDefinitions.join('')}<clipPath id="xps-page"><rect width="${scene.width}" height="${scene.height}"/></clipPath></defs><g clip-path="url(#xps-page)">${content}</g></svg>`;
}
