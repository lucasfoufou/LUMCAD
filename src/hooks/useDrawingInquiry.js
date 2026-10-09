import { drawingWorldToUcs } from '~utils/drawingCoordinates';
import { useRef, useState } from 'react';
import { canSelectEntity } from '~utils/drawingDocument';
import { measureDrawingEntity, measureDrawingPoints } from '~utils/drawingInquiry';

const COMMANDS = new Set(['measureGeometry', 'distanceInquiry', 'areaInquiry', 'coordinateInquiry', 'entityList', 'drawingStatus', 'massProperties']);

export default function useDrawingInquiry({ content, selectedIds, operation, setOperation, setActiveTool, setMessage, setSidebarPanel, enabled, t, initialResult = null }) {
    const [result, setResult] = useState(initialResult);
    const resultRef = useRef(initialResult);
    const [cumulativeArea, setCumulativeArea] = useState(0);
    const present = data => {
        if (data?.mode === 'id') data = { ...data, world: { x: data.x, y: data.y }, ...drawingWorldToUcs({ x: data.x, y: data.y }, content.settings?.ucs), coordinateSystem: content.settings?.ucs };
        // Native requests can read immediately after asynchronous file work,
        // before a background WebKit window has committed its next render.
        resultRef.current = data;
        setResult(data); setOperation(null); setSidebarPanel('inquiry');
        setMessage(t('inquiry.complete'));
    };
    const copy = async () => {
        if (!result) return;
        try { await navigator.clipboard.writeText(JSON.stringify(result, null, 2)); setMessage(t('inquiry.copied')); }
        catch { setMessage(t('inquiry.copyFailed')); }
    };
    const measureEntities = (mode, ids, accumulation = null) => {
        const idSet = new Set(ids);
        const entities = content.entities.filter(entity => idSet.has(entity.id) && canSelectEntity(content, entity));
        if (!entities.length || entities.length > 256) { setMessage(t('inquiry.selection')); return; }
        const measurements = entities.map(measureDrawingEntity);
        const field = mode === 'radius' ? 'radius' : mode === 'length' ? 'perimeter' : 'area';
        if (measurements.some(value => !value || !Number.isFinite(value[field])) || mode === 'mass' && entities.length !== 1) {
            setMessage(t('inquiry.unsupported')); return;
        }
        if (accumulation) {
            const area = cumulativeArea + (accumulation === 'SUBTRACT' ? -1 : 1) * measurements.reduce((sum, value) => sum + value.area, 0);
            setCumulativeArea(area); present({ cumulativeArea: area, unit: 'm²' });
        } else {
            present({ mode, units: { length: 'm', area: 'm²', inertia: 'm⁴' },
                objects: entities.map((entity, i) => ({ id: entity.id, type: entity.type, ...measurements[i] })),
                ...(mode === 'area' ? { totalArea: measurements.reduce((sum, value) => sum + value.area, 0), totalPerimeter: measurements.reduce((sum, value) => sum + value.perimeter, 0) } : {}) });
        }
    };
    const run = (command, input) => {
        if (!COMMANDS.has(command)) return false;
        if (!enabled) { setMessage(t('namedView.modelRequired')); return true; }
        const tokens = input.trim().split(/\s+/).filter(Boolean);
        let mode = { distanceInquiry: 'distance', areaInquiry: 'area', coordinateInquiry: 'id', massProperties: 'mass' }[command];
        if (command === 'entityList') {
            if (tokens.length && input.toUpperCase() !== 'ALL') { setMessage(t('inquiry.syntax')); return true; }
            const selectedIdSet = new Set(selectedIds);
            const entities = content.entities.filter(entity => (tokens.length || selectedIdSet.has(entity.id)) && canSelectEntity(content, entity));
            if (!entities.length || entities.length > 256) setMessage(t('inquiry.selection'));
            else present({ unit: 'm', objects: entities });
            return true;
        }
        if (command === 'drawingStatus') {
            present({ unit: 'm', objects: content.entities.length, layers: content.layers.length, blocks: content.blocks?.length || 0, selected: selectedIds.length });
            return true;
        }
        if (command === 'measureGeometry') {
            const option = (tokens.shift() || 'DISTANCE').toUpperCase();
            if (option === 'COPY') { copy(); return true; }
            if (option === 'RESET') { setCumulativeArea(0); present({ cumulativeArea: 0, unit: 'm²' }); return true; }
            mode = { DISTANCE: 'distance', ANGLE: 'angle', AREA: 'area', RADIUS: 'radius', LENGTH: 'length', PERIMETER: 'length', ADD: 'area', SUBTRACT: 'area' }[option];
            if (option === 'ADD' || option === 'SUBTRACT') { measureEntities('area', selectedIds, option); return true; }
        }
        if (!mode) { setMessage(t('inquiry.syntax')); return true; }
        if (tokens.length && ['distance', 'angle', 'id'].includes(mode)) {
            const values = tokens.map(value => Number(value.replace(',', '.')));
            const points = values.reduce((all, value, index) => index % 2 ? all : [...all, { x: value, y: values[index + 1] }], []);
            const measured = measureDrawingPoints(mode, points);
            if (measured) present({ mode, lengthUnit: 'm', angleUnit: '°', ...measured });
            else setMessage(t('inquiry.syntax'));
            return true;
        }
        if (tokens.length) { setMessage(t('inquiry.syntax')); return true; }
        if (['area', 'radius', 'length', 'mass'].includes(mode) && selectedIds.length) measureEntities(mode, selectedIds);
        else {
            setActiveTool('select'); setOperation({ type: 'inquiry', stage: 'pick', mode, points: [] });
            setMessage(t(mode === 'area' ? 'inquiry.areaPrompt' : ['radius', 'length', 'mass'].includes(mode) ? 'inquiry.objectPrompt' : 'inquiry.pointPrompt'));
        }
        return true;
    };
    const point = ({ point, targetId }) => {
        if (operation?.type !== 'inquiry') return false;
        if (['radius', 'length', 'mass'].includes(operation.mode)) { measureEntities(operation.mode, [targetId]); return true; }
        if (!point || operation.points.length >= 256) { setMessage(t('inquiry.unsupported')); return true; }
        const points = [...operation.points, { x: point.x, y: point.y }];
        const count = { distance: 2, angle: 3, id: 1 }[operation.mode];
        if (points.length === count) {
            const measured = measureDrawingPoints(operation.mode, points);
            if (measured) present({ mode: operation.mode, lengthUnit: 'm', angleUnit: '°', ...measured });
            else setMessage(t('inquiry.unsupported'));
        } else { setOperation({ ...operation, points }); setMessage(t(operation.mode === 'area' ? 'inquiry.areaPrompt' : 'inquiry.pointPrompt')); }
        return true;
    };
    const input = value => {
        if (operation?.type !== 'inquiry' || operation.mode !== 'area' || !['', 'DONE'].includes(value.trim().toUpperCase())) return false;
        const measured = operation.points.length >= 3 && measureDrawingEntity({ type: 'polyline', closed: true, points: operation.points });
        if (measured?.area) present({ mode: 'area', lengthUnit: 'm', areaUnit: 'm²', ...measured });
        else setMessage(t('inquiry.unsupported'));
        return true;
    };
    return { result, getResult: () => resultRef.current, run, point, input, copy, present };
}
