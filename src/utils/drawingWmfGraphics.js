import { readDrawingWmfRecords } from './drawingWmfRecords.js';
import { readDrawingWmfFont, readDrawingWmfTextOut, readDrawingWmfExtTextOut } from './drawingWmfText.js';
import { decodeDrawingDib } from './drawingDib.js';

/** Interpret vector records into metre-space primitives before any document mutation. */
export function readDrawingWmfGraphics(input, { dpi = 96, maxPrimitives = 100000, maxPoints = 1000000, maxCharacters = 1000000, maxPixels = 16000000, ...limits } = {}) {
    if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 9600
        || ![maxPrimitives, maxPoints, maxCharacters, maxPixels].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('wmfLimit');
    const file = readDrawingWmfRecords(input, limits);
    const units = file.placeable?.unitsPerInch || dpi;
    const objects = Array(file.header.objects).fill(null); const saved = []; const primitives = [];
    let pointsRead = 0; let charactersRead = 0; let pixelsRead = 0;
    let state = { mode: file.placeable ? 8 : 1, window: { x: 0, y: 0 }, viewport: { x: 0, y: 0 },
        extent: { x: 1, y: 1 }, viewportExtent: { x: 1, y: 1 }, position: { x: 0, y: 0 },
        pen: { kind: 'pen', color: '#000000', width: 0, style: 0 }, brush: { kind: 'brush', color: '#ffffff', style: 0 }, fillRule: 'evenodd',
        font: null, textColor: '#000000', backgroundColor: '#ffffff', backgroundMode: 2, textAlign: 0, clip: null };
    const point = p => {
        const physical = { 1: 0.0254 / units, 2: 0.0001, 3: 0.00001, 4: 0.000254, 5: 0.0000254, 6: 0.0254 / 1440 };
        let sx = state.viewportExtent.x / state.extent.x; let sy = state.viewportExtent.y / state.extent.y;
        if (state.mode === 7) { const scale = Math.min(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * scale; sy = Math.sign(sy) * scale; }
        const fixed = physical[state.mode];
        const x = fixed ? (p.x - state.window.x) * fixed + state.viewport.x * 0.0254 / units
            : ((p.x - state.window.x) * sx + state.viewport.x) * 0.0254 / units;
        const y = fixed ? (p.y - state.window.y) * fixed * (state.mode === 1 ? 1 : -1) + state.viewport.y * 0.0254 / units
            : ((p.y - state.window.y) * sy + state.viewport.y) * 0.0254 / units;
        if (![x, y].every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('wmfLimit');
        return { x, y };
    };
    const emit = (kind, points, filled = false, contourLengths = null) => {
        pointsRead += points.length;
        if (primitives.length >= maxPrimitives || pointsRead > maxPoints) throw new Error('wmfLimit');
        const pen = state.pen; const brush = state.brush;
        const origin = point({ x: 0, y: 0 }); const width = point({ x: pen.width, y: 0 });
        // GDI cosmetic pens stay one device pixel wide under every mapping mode.
        const strokeWidth = pen.width === 0 ? 0.0254 / dpi : Math.abs(width.x - origin.x);
        primitives.push({ kind, ...(state.clip ? { deviceClip: { ...state.clip } } : {}), points: points.map(point), stroke: pen.style === 5 ? null
            : { color: pen.color, width: strokeWidth, cosmetic: pen.width === 0, style: pen.style,
                ...(pen.endCap ? { endCap: pen.endCap } : {}), ...(pen.join ? { join: pen.join } : {}) },
        fill: filled && brush.style !== 1 ? brush.color : null, fillRule: state.fillRule,
        ...(filled && brush.style === 2 ? { fillHatch: { style: brush.hatch,
            background: state.backgroundMode === 2 ? state.backgroundColor : null } } : {}),
        ...(contourLengths ? { contourLengths } : {}) });
    };
    const allocate = object => { const index = objects.indexOf(null); if (index < 0) throw new Error('wmfObjects'); objects[index] = object; };
    for (const record of file.records) {
        const data = new DataView(record.parameters.buffer, record.parameters.byteOffset, record.parameters.byteLength);
        const size = expected => { if (data.byteLength !== expected) throw new Error('wmfInvalid'); };
        const u16 = offset => data.getUint16(offset, true); const i16 = offset => data.getInt16(offset, true);
        const pair = () => ({ x: i16(2), y: i16(0) });
        const color = offset => {
            if (data.getUint8(offset + 3)) throw new Error('wmfUnsupportedColor');
            return '#' + [0, 1, 2].map(i => data.getUint8(offset + i).toString(16).padStart(2, '0')).join('');
        };
        switch (record.opcode) {
        case 0: size(0); break;
        case 0x0107:
            size(2);
            // COLORONCOLOR keeps source colors; native image placement retains source pixels.
            if (u16(0) !== 3) throw new Error('wmfUnsupportedRasterOperation');
            break;
        case 0x0d33: {
            // SETDIBTODEV supplies scanCount rows, starting at startScan in the DIB.
            const header = 18;
            if (data.byteLength < header + 12) throw new Error('wmfInvalidBitmap');
            const core = data.getUint32(header, true) === 12;
            const signedHeight = core ? data.getUint16(header + 6, true) : data.getInt32(header + 8, true);
            const fullHeight = Math.abs(signedHeight); const scanCount = u16(2); const startScan = u16(4);
            if (!scanCount) break;
            if (startScan + scanCount > fullHeight) throw new Error('wmfInvalidBitmap');
            const bitmap = decodeDrawingDib(record.parameters.subarray(header), {
                maxPixels: maxPixels - pixelsRead, colorUsage: u16(0), scanCount,
            });
            pixelsRead += bitmap.width * bitmap.height;
            const width = u16(12); const height = u16(10); const x = u16(8);
            if (!width || !height) break;
            const sourceTop = signedHeight > 0 ? fullHeight - u16(6) - height : u16(6);
            if (x + width > bitmap.width || sourceTop < 0 || sourceTop + height > fullHeight) throw new Error('wmfUnsupportedBitmapCrop');
            const bandTop = signedHeight > 0 ? fullHeight - startScan - scanCount : startScan;
            const top = Math.max(sourceTop, bandTop); const bottom = Math.min(sourceTop + height, bandTop + scanCount);
            if (top >= bottom) break;
            const destination = { x: u16(16), y: u16(14) + top - sourceTop };
            if (primitives.length >= maxPrimitives || (pointsRead += 2) > maxPoints) throw new Error('wmfLimit');
            primitives.push({ kind: 'bitmap', bitmap, crop: { x, y: top - bandTop, width, height: bottom - top },
                points: [point(destination), point({ x: destination.x + width, y: destination.y + bottom - top })],
                ...(state.clip ? { deviceClip: { ...state.clip } } : {}) });
            break;
        }
        case 0x0f43: case 0x0b41: case 0x0940: {
            const stretchDib = record.opcode === 0x0f43; const copy = record.opcode === 0x0940;
            const header = stretchDib ? 22 : copy ? 16 : 20;
            if (data.byteLength < header + 12) throw new Error('wmfInvalidBitmap');
            if (data.getUint32(0, true) !== 0x00cc0020) throw new Error('wmfUnsupportedRasterOperation');
            const bitmap = decodeDrawingDib(record.parameters.subarray(header), { maxPixels: maxPixels - pixelsRead, colorUsage: stretchDib ? u16(4) : 0 });
            pixelsRead += bitmap.width * bitmap.height;
            const offset = stretchDib ? 2 : 0;
            const width = i16(copy ? 10 : 6 + offset); const height = i16(copy ? 8 : 4 + offset);
            const x = i16(copy ? 6 : 10 + offset); const sourceY = i16(copy ? 4 : 8 + offset);
            const core = data.getUint32(header, true) === 12;
            const bottomUp = core || data.getInt32(header + 8, true) > 0;
            const y = bottomUp ? bitmap.height - sourceY - height : sourceY;
            if (width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > bitmap.width || y + height > bitmap.height) throw new Error('wmfUnsupportedBitmapCrop');
            const destination = { x: i16(header - 2), y: i16(header - 4) };
            const destinationWidth = i16(header - 6); const destinationHeight = i16(header - 8);
            if (!destinationWidth || !destinationHeight) break;
            if (primitives.length >= maxPrimitives || (pointsRead += 2) > maxPoints) throw new Error('wmfLimit');
            primitives.push({ kind: 'bitmap', bitmap, crop: { x, y, width, height },
                points: [point(destination), point({ x: destination.x + destinationWidth, y: destination.y + destinationHeight })],
                ...(state.clip ? { deviceClip: { ...state.clip } } : {}) });
            break;
        }
        case 0x0416: {
            size(8);
            const a = point({ x: i16(6), y: i16(4) }); const b = point({ x: i16(2), y: i16(0) });
            const rectangle = { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
            state.clip = state.clip ? { minX: Math.max(state.clip.minX, rectangle.minX), minY: Math.max(state.clip.minY, rectangle.minY),
                maxX: Math.min(state.clip.maxX, rectangle.maxX), maxY: Math.min(state.clip.maxY, rectangle.maxY) } : rectangle;
            break;
        }
        case 0x0220: {
            size(4);
            if (state.clip) {
                const zero = point({ x: 0, y: 0 }); const delta = point(pair());
                state.clip = { minX: state.clip.minX + delta.x - zero.x, maxX: state.clip.maxX + delta.x - zero.x,
                    minY: state.clip.minY + delta.y - zero.y, maxY: state.clip.maxY + delta.y - zero.y };
                if (!Object.values(state.clip).every(value => Number.isFinite(value) && Math.abs(value) <= 1e9)) throw new Error('wmfLimit');
            }
            break;
        }
        case 0x02fb: allocate(readDrawingWmfFont(record.parameters)); break;
        case 0x0209: size(4); state.textColor = color(0); break;
        case 0x0201: size(4); state.backgroundColor = color(0); break;
        case 0x0102: size(2); if (![1, 2].includes(u16(0))) throw new Error('wmfInvalid'); state.backgroundMode = u16(0); break;
        case 0x012e:
            size(2); state.textAlign = u16(0);
            if ((state.textAlign & ~0x011f) || ![0, 2, 6].includes(state.textAlign & 6)
                || ![0, 8, 24].includes(state.textAlign & 24)) throw new Error('wmfInvalid');
            break;
        case 0x0521: case 0x0a32: {
            if (!state.font) throw new Error('wmfUnsupportedDefaultFont');
            // Updating the current point requires resolved font metrics, not guessed widths.
            if (state.textAlign & 1) throw new Error('wmfUnsupportedTextAlignment');
            const text = (record.opcode === 0x0521 ? readDrawingWmfTextOut : readDrawingWmfExtTextOut)(record.parameters,
                state.font, { maxCharacters: maxCharacters - charactersRead });
            charactersRead += text.text.length;
            if (primitives.length >= maxPrimitives || ++pointsRead > maxPoints) throw new Error('wmfLimit');
            const zero = point({ x: 0, y: 0 }); const unit = point({ x: 1, y: 1 });
            primitives.push({ kind: 'text', ...text, ...(state.clip ? { deviceClip: { ...state.clip } } : {}), points: [point(text)], font: { ...state.font },
                textColor: state.textColor, backgroundColor: state.backgroundColor, backgroundMode: state.backgroundMode,
                textAlign: state.textAlign, mapping: { scaleX: unit.x - zero.x, scaleY: unit.y - zero.y,
                    offsetX: zero.x, offsetY: zero.y } });
            break;
        }
        case 0x001e: size(0); if (saved.length >= 256) throw new Error('wmfLimit'); saved.push(structuredClone(state)); break;
        case 0x0127: {
            size(2); const level = i16(0); const index = level < 0 ? saved.length + level : level - 1;
            if (index < 0 || index >= saved.length) throw new Error('wmfInvalid');
            state = saved[index]; saved.length = index; break;
        }
        case 0x0103: size(2); state.mode = u16(0); if (state.mode < 1 || state.mode > 8) throw new Error('wmfInvalid'); break;
        case 0x020b: size(4); state.window = pair(); break;
        case 0x020d: size(4); state.viewport = pair(); break;
        case 0x020f: case 0x0211: {
            size(4); const key = record.opcode === 0x020f ? 'window' : 'viewport'; const delta = pair();
            state[key] = { x: state[key].x + delta.x, y: state[key].y + delta.y }; break;
        }
        case 0x020c: case 0x020e:
            size(4); if (state.mode >= 7) { const value = pair(); if (!value.x || !value.y) throw new Error('wmfInvalid'); state[record.opcode === 0x020c ? 'extent' : 'viewportExtent'] = value; } break;
        case 0x0410: case 0x0412: {
            size(8);
            if (state.mode < 7) break;
            const yd = i16(0); const yn = i16(2); const xd = i16(4); const xn = i16(6);
            if (!yd || !yn || !xd || !xn) throw new Error('wmfInvalid');
            const key = record.opcode === 0x0410 ? 'extent' : 'viewportExtent';
            const value = { x: Math.trunc(state[key].x * xn / xd), y: Math.trunc(state[key].y * yn / yd) };
            if (!value.x || !value.y) throw new Error('wmfInvalid');
            if (![value.x, value.y].every(number => Number.isSafeInteger(number) && Math.abs(number) <= 0x7fffffff)) throw new Error('wmfLimit');
            state[key] = value; break;
        }
        case 0x0214: size(4); state.position = pair(); break;
        case 0x0213: { size(4); const end = pair(); emit('polyline', [state.position, end]); state.position = end; break; }
        case 0x0324: case 0x0325: {
            if (data.byteLength < 2 || u16(0) < 2 || u16(0) > 32767 || data.byteLength !== 2 + u16(0) * 4) throw new Error('wmfInvalid');
            if (u16(0) > maxPoints - pointsRead) throw new Error('wmfLimit');
            const points = Array.from({ length: u16(0) }, (_, i) => ({ x: i16(2 + i * 4), y: i16(4 + i * 4) }));
            emit(record.opcode === 0x0324 ? 'polygon' : 'polyline', points, record.opcode === 0x0324); break;
        }
        case 0x0538: {
            // Keep all contours in one fill operation: splitting them loses holes.
            if (data.byteLength < 2 || !u16(0) || data.byteLength < 2 + u16(0) * 2) throw new Error('wmfInvalid');
            const count = u16(0); const contourLengths = [];
            let total = 0;
            for (let i = 0; i < count; i++) {
                const length = u16(2 + i * 2);
                if (length < 2) throw new Error('wmfInvalid');
                total += length; contourLengths.push(length);
            }
            const start = 2 + count * 2;
            if (data.byteLength !== start + total * 4) throw new Error('wmfInvalid');
            if (total > maxPoints - pointsRead) throw new Error('wmfLimit');
            const points = Array.from({ length: total }, (_, i) => ({ x: i16(start + i * 4), y: i16(start + i * 4 + 2) }));
            emit('polypolygon', points, true, contourLengths); break;
        }
        case 0x041b: case 0x0418: {
            size(8); const corners = [{ x: i16(6), y: i16(4) }, { x: i16(2), y: i16(0) }];
            emit(record.opcode === 0x041b ? 'rectangle' : 'ellipse', corners, true); break;
        }
        case 0x061c: {
            size(12);
            const corners = [{ x: i16(10), y: i16(8) }, { x: i16(6), y: i16(4) }];
            const zero = point({ x: 0, y: 0 }); const diameter = point({ x: i16(2), y: i16(0) });
            emit('roundRectangle', corners, true);
            Object.assign(primitives.at(-1), { cornerRadiusX: Math.abs(diameter.x - zero.x) / 2,
                cornerRadiusY: Math.abs(diameter.y - zero.y) / 2 });
            break;
        }
        case 0x0817: case 0x0830: case 0x081a: {
            size(16);
            const corners = [{ x: i16(14), y: i16(12) }, { x: i16(10), y: i16(8) }];
            const radialStart = { x: i16(6), y: i16(4) }; const radialEnd = { x: i16(2), y: i16(0) };
            const mapped = corners.map(point); const cx = (mapped[0].x + mapped[1].x) / 2; const cy = (mapped[0].y + mapped[1].y) / 2;
            const rx = Math.abs(mapped[1].x - mapped[0].x) / 2; const ry = Math.abs(mapped[1].y - mapped[0].y) / 2;
            if (!rx || !ry) throw new Error('wmfInvalid');
            const angle = radial => {
                const p = point(radial); const dx = (p.x - cx) / rx; const dy = (p.y - cy) / ry;
                if (Math.hypot(dx, dy) < 1e-12) throw new Error('wmfInvalid');
                return Math.atan2(dy, dx);
            };
            const startAngle = angle(radialStart); const endAngle = angle(radialEnd);
            const zero = point({ x: 0, y: 0 }); const one = point({ x: 1, y: 1 });
            const counterClockwise = (one.x - zero.x) * (one.y - zero.y) < 0;
            const fullEllipse = Math.abs(Math.sin((endAngle - startAngle) / 2)) < 1e-12;
            const kind = record.opcode === 0x0817 ? 'ellipseArc' : record.opcode === 0x0830 ? 'chord' : 'pie';
            emit(kind, corners, kind !== 'ellipseArc');
            Object.assign(primitives.at(-1), { startAngle, endAngle, counterClockwise, fullEllipse });
            break;
        }
        case 0x02fa: {
            size(10); const flags = u16(0); const style = flags & 0xf;
            const endCap = flags & 0x0f00; const join = flags & 0xf000;
            if ((flags & 0x00f0) || style > 6 || ![0, 0x100, 0x200].includes(endCap) || ![0, 0x1000, 0x2000].includes(join)) throw new Error('wmfUnsupportedPen');
            allocate({ kind: 'pen', style, width: Math.abs(i16(2)), color: color(6),
                endCap: endCap === 0x100 ? 'square' : endCap === 0x200 ? 'flat' : null,
                join: join === 0x1000 ? 'bevel' : join === 0x2000 ? 'miter' : null }); break;
        }
        case 0x02fc: {
            size(8); const style = u16(0);
            if (![0, 1, 2].includes(style)) throw new Error('wmfUnsupportedBrush');
            if (style === 2 && u16(6) > 5) throw new Error('wmfInvalid');
            // BS_NULL ignores ColorRef and BrushHatch; their unused bytes may be arbitrary.
            allocate({ kind: 'brush', style, color: style === 1 ? '#000000' : color(2),
                ...(style === 2 ? { hatch: u16(6) } : {}) });
            break;
        }
        case 0x012d: { size(2); const object = objects[u16(0)]; if (!object) throw new Error('wmfObjects'); state[object.kind] = object; break; }
        case 0x01f0: size(2); if (!objects[u16(0)]) throw new Error('wmfObjects'); objects[u16(0)] = null; break;
        case 0x0106: size(2); if (![1, 2].includes(u16(0))) throw new Error('wmfInvalid'); state.fillRule = u16(0) === 1 ? 'evenodd' : 'nonzero'; break;
        case 0x0104: size(2); if (u16(0) !== 13) throw new Error('wmfUnsupportedRasterOperation'); break;
        default: throw new Error(`wmfUnsupportedRecord:${record.opcode.toString(16)}`);
        }
    }
    return { primitives, placeable: file.placeable, units: 'm' };
}
