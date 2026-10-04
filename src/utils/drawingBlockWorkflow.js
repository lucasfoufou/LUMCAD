import { drawingAttributeDefinitions, normalizeDrawingAttributeTag, tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { setDrawingBasePoint } from './drawingBasePoint.js';
import { defineNamedDrawingBlock, findNamedDrawingBlock, insertNamedDrawingBlock, parseNamedBlockInput } from './drawingNamedBlocks.js';

export function createDrawingBlockWorkflow({ history, selectedIds, canvasRef, commandBarRef, setInteractiveOperation, setActiveTool, setSelectedIds, setMessage, t }) {
    const fail = key => { setMessage(t(`block.error.${key}`)); return true; };
    const finish = (result, key) => {
        if (result.error) return fail(result.error);
        history.commit(result.content);
        if (result.reference) setSelectedIds([result.reference.id]);
        setInteractiveOperation(null);
        setActiveTool('select');
        setMessage(t(key));
        return true;
    };
    const begin = operation => {
        canvasRef?.current?.cancel?.();
        setActiveTool('select');
        setInteractiveOperation(operation);
        setMessage(t(operation.stage === 'name' ? 'block.namePrompt' : ['blockDefine', 'blockBase'].includes(operation.type) ? 'block.basePrompt' : 'block.insertPrompt'));
        commandBarRef?.current?.focus?.('');
        return true;
    };
    const base = input => {
        const value = String(input || '').trim();
        if (!value) return begin({ type: 'blockBase', stage: 'base' });
        const parts = value.split(/\s+/);
        if (parts.length !== 2) return fail('baseSyntax');
        const content = setDrawingBasePoint(history.content, { x: Number(parts[0]), y: Number(parts[1]) });
        return content ? finish({ content }, 'block.baseSaved') : fail('baseSyntax');
    };
    const define = (input, ids = selectedIds) => {
        if (!ids.length) return fail('selection');
        if (!String(input || '').trim()) return begin({ type: 'blockDefine', stage: 'name', entityIds: ids });
        const options = parseNamedBlockInput(input, 'define');
        if (!options) return fail('defineSyntax');
        if (options.basePoint) return finish(defineNamedDrawingBlock(history.content, ids, options), 'block.defined');
        return begin({ type: 'blockDefine', stage: 'base', entityIds: ids, ...options });
    };
    const insert = (input, attributeValues) => {
        if (!String(input || '').trim()) return begin({ type: 'blockInsert', stage: 'name' });
        const options = parseNamedBlockInput(input, 'insert');
        if (!options) return fail('insertSyntax');
        if (attributeValues) options.attributeValues = attributeValues;
        if (!findNamedDrawingBlock(history.content, options.name)) return fail('missing');
        if (options.point) return finish(insertNamedDrawingBlock(history.content, options.name, options.point, options), 'block.inserted');
        return begin({ type: 'blockInsert', stage: 'insertion', ...options });
    };
    const point = (operation, value) => {
        if (!['blockDefine', 'blockInsert', 'blockBase'].includes(operation?.type)) return false;
        if (operation.type === 'blockBase') {
            const content = setDrawingBasePoint(history.content, value);
            return content ? finish({ content }, 'block.baseSaved') : fail('baseSyntax');
        }
        if (operation.stage === 'name') { setMessage(t('block.namePrompt')); return true; }
        if (operation.type === 'blockDefine') return finish(defineNamedDrawingBlock(history.content, operation.entityIds, { ...operation, basePoint: value }), 'block.defined');
        return finish(insertNamedDrawingBlock(history.content, operation.name, value, operation), 'block.inserted');
    };
    const input = (operation, rawValue) => {
        if (!['blockDefine', 'blockInsert', 'blockBase'].includes(operation?.type)) return false;
        if (operation.stage === 'name') return operation.type === 'blockDefine' ? define(rawValue, operation.entityIds) : insert(rawValue);
        if (operation.type === 'blockInsert') {
            const tokens = tokenizeDrawingAttributeInput(rawValue);
            if (tokens?.[0]?.toUpperCase() === 'ATTRIBUTE') {
                const tag = normalizeDrawingAttributeTag(tokens[1]);
                const definition = drawingAttributeDefinitions(findNamedDrawingBlock(history.content, operation.name)).find(entity => entity.attributeDefinition.tag === tag);
                const error = tokens.length !== 3 || tokens[2].length > 16384 ? 'editSyntax' : !definition ? 'missing' : definition.attributeDefinition.constant ? 'constant' : null;
                if (error) setMessage(t(`attribute.error.${error}`));
                else setInteractiveOperation({ ...operation, attributeValues: { ...operation.attributeValues, [tag]: tokens[2] } });
                return true;
            }
            const match = String(rawValue || '').trim().match(/^(SCALE|ROTATION)\s+([+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+))$/i);
            const value = match && Number(match[2].replace(',', '.'));
            if (match && Number.isFinite(value) && (match[1].toUpperCase() === 'ROTATION' || value > 1e-9 && value <= 1e9)) {
                setInteractiveOperation({ ...operation, [match[1].toUpperCase() === 'SCALE' ? 'scale' : 'angle']: value });
                setMessage(t('block.insertPrompt'));
                return true;
            }
        }
        setMessage(t(['blockDefine', 'blockBase'].includes(operation.type) ? 'block.basePrompt' : 'block.insertPrompt'));
        return true;
    };
    return { base, define, insert, point, input };
}
