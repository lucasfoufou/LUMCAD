import { failDxf, recordNumber, recordPoint, recordPointList, recordValue } from './drawingDxfReader.js';
import { importDxfText } from './drawingDxfText.js';
import { drawingLeaderGeometry } from './drawingLeaders.js';
import { transformDrawingEntityAffine } from './drawingBlocks.js';

/** Preserve cached MULTILEADER text, branches, landing and arrowheads as editable geometry. */
export function importDxfMultileader(source, local, factor, warnings, block = null) {
    const context = { groups: [], leaders: [] }; let leader = null; let branch = null; let inContext = false;
    for (const group of source.groups) {
        if (group[0] === 300 && group[1] === 'CONTEXT_DATA{') { inContext = true; continue; }
        if (group[0] === 301 && group[1] === '}') { inContext = false; continue; }
        if (!inContext) continue;
        if (group[0] === 302 && group[1] === 'LEADER{') { leader = { groups: [], branches: [] }; context.leaders.push(leader); continue; }
        if (group[0] === 303 && group[1] === '}') { leader = null; continue; }
        if (group[0] === 304 && group[1] === 'LEADER_LINE{') {
            if (!leader) failDxf('cadInvalid');
            branch = { groups: [] }; leader.branches.push(branch); continue;
        }
        if (group[0] === 305 && group[1] === '}') { branch = null; continue; }
        (branch || leader || context).groups.push(group);
    }
    const parts = [];
    if (recordNumber(context, 290, 0) === 1) {
        const position = recordPoint(context, 12); const direction = recordPoint(context, 13);
        if (!position || !direction) failDxf('cadInvalid');
        const textSource = { type: 'MTEXT', text: recordValue(context, 304) || '', height: recordNumber(context, 41, 0),
            width: recordNumber(context, 43, 0), attachment: 1, rotation: Math.atan2(direction.y, direction.x) * 180 / Math.PI };
        parts.push(importDxfText(textSource, local(position), factor, warnings));
    } else if (recordNumber(context, 296, 0)) {
        if (!block?.id) failDxf('cadUnsupported', 'missing multileader block');
        // Code 47 is an optional, potentially stale cache. AutoCAD renders the
        // context's insertion, scale and rotation, just like an ordinary INSERT.
        const insertion = recordPoint(context, 15); const scale = recordPoint(context, 16);
        const normal = recordPoint(context, 14) || { x: 0, y: 0, z: 1 };
        if (!insertion || !scale || !scale.x || !scale.y) failDxf('cadInvalid');
        if (normal.x || normal.y || normal.z !== 1) failDxf('cadUnsupported', 'multileader block plane');
        const origin = local(insertion); const angle = -recordNumber(context, 46, 0);
        parts.push({ type: 'blockReference', blockId: block.id, transform: {
            a: Math.cos(angle) * scale.x, b: Math.sin(angle) * scale.x,
            c: -Math.sin(angle) * scale.y, d: Math.cos(angle) * scale.y,
            e: origin.x * factor, f: -origin.y * factor } });
    }
    const world = point => { const p = local(point); return { x: p.x * factor, y: -p.y * factor }; };
    for (const item of context.leaders) {
        const end = recordPoint(item, 10); const dogleg = recordPoint(item, 11);
        if (!end || !dogleg) failDxf('cadInvalid');
        const distance = recordNumber(item, 40, 0);
        const landing = world({ x: end.x + dogleg.x * distance, y: end.y + dogleg.y * distance, z: end.z });
        for (const branch of item.branches) {
            if (recordNumber(branch, 170, 1) !== 1) failDxf('cadUnsupported', 'curved multileader');
            const points = [...recordPointList(branch, 10), end].map(world)
                .map(point => ({ x: point.x - landing.x, y: point.y - landing.y }));
            if (points.length < 2 || points.length > 128) failDxf('cadUnsupported', 'multileader branch');
            const geometry = drawingLeaderGeometry({ branches: [points], style: { landingLength: 0,
                arrowSize: recordNumber(context, 140, 0) * factor, arrowType: 'closed' } }, null);
            for (const part of geometry.filter(Boolean)) parts.push(transformDrawingEntityAffine(part,
                { a: 1, b: 0, c: 0, d: 1, e: landing.x, f: landing.y }));
        }
    }
    warnings.add('leaderGraphics');
    return parts;
}
