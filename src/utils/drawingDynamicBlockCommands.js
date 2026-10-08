import { tokenizeDrawingAttributeInput } from './drawingBlockAttributes.js';
import { normalizeDrawingDynamicBlock } from './drawingDynamicBlocks.js';
import { editDrawingDynamicBlockInstances } from './drawingDynamicBlockOperations.js';

const number = token => token !== undefined && token.trim() !== '' ? Number(token.replace(',', '.')) : NaN;
const point = tokens => ({ x: number(tokens.shift()), y: number(tokens.shift()) });
const parameterValue = (type, tokens) => type === 'point' ? point(tokens) : type === 'flip'
    ? ({ ON: true, OFF: false })[tokens.shift()?.toUpperCase()] : type === 'choice' ? tokens.shift() : number(tokens.shift());

export function runDrawingDynamicBlockCommand(content, command, input, selectedIds, { editing = false } = {}) {
    const tokens = tokenizeDrawingAttributeInput(input);
    if (!tokens) return { error: 'syntax' };
    if (command === 'resetBlock') return editing || tokens.length ? { error: 'syntax' }
        : editDrawingDynamicBlockInstances(content, selectedIds, {}, { reset: true });
    const verb = tokens.shift()?.toUpperCase();
    if (!editing) {
        if (selectedIds.length !== 1) return { error: 'selection' };
        const entity = content.entities.find(entity => entity.id === selectedIds[0]);
        const block = content.blocks.find(block => block.id === entity?.blockId);
        if (command === 'blockTable' && verb === 'APPLY' && tokens.length === 2) {
            const table = block?.dynamic?.lookups?.find(table => table.name.toLowerCase() === tokens[0].toLowerCase());
            return table ? editDrawingDynamicBlockInstances(content, selectedIds, { [table.parameter]: tokens[1] }) : { error: 'values' };
        }
        if (command !== 'blockParameter' || verb !== 'SET') return { error: 'editor' };
        const name = tokens.shift();
        const parameter = block?.dynamic?.parameters.find(parameter => parameter.name.toLowerCase() === name?.toLowerCase());
        if (!parameter) return { error: 'values' };
        const value = parameterValue(parameter.type, tokens);
        return tokens.length ? { error: 'syntax' } : editDrawingDynamicBlockInstances(content, selectedIds, { [parameter.name]: value });
    }
    const source = content.blockDynamicDraft || { parameters: [], actions: [] };
    if (verb === 'LIST' && !tokens.length) return { report: JSON.stringify(source, null, 2) };
    const dynamic = structuredClone(source);
    if (command === 'blockParameter') {
        const name = tokens.shift();
        const index = dynamic.parameters.findIndex(parameter => parameter.name.toLowerCase() === name?.toLowerCase());
        if (verb === 'DELETE' && !tokens.length && index >= 0) dynamic.parameters.splice(index, 1);
        else if (verb === 'SET' && name) {
            const type = tokens.shift()?.toLowerCase();
            const parameter = { name: index >= 0 ? dynamic.parameters[index].name : name, type, default: parameterValue(type, tokens) };
            if (type === 'choice') parameter.choices = tokens.splice(0);
            else while (tokens.length) {
                const key = tokens.shift()?.toLowerCase();
                if (!['min', 'max', 'step'].includes(key)) return { error: 'syntax' };
                parameter[key] = number(tokens.shift());
            }
            if (index >= 0) dynamic.parameters[index] = parameter;
            else dynamic.parameters.push(parameter);
        } else return { error: 'syntax' };
    } else if (command === 'blockAction') {
        const id = tokens.shift();
        const index = dynamic.actions.findIndex(action => action.id === id);
        if (verb === 'DELETE' && !tokens.length && index >= 0) dynamic.actions.splice(index, 1);
        else if (verb === 'SET' && id && selectedIds.length) {
            const type = tokens.shift()?.toLowerCase(); const parameter = tokens.shift();
            const spec = dynamic.parameters.find(item => item.name.toLowerCase() === parameter?.toLowerCase());
            const action = { id, type, parameter, targets: [...selectedIds] };
            if (['move', 'stretch'].includes(type) && spec?.type !== 'point') action.direction = point(tokens);
            if (type === 'stretch') {
                const first = point(tokens); const second = point(tokens);
                action.window = { minX: Math.min(first.x, second.x), minY: Math.min(first.y, second.y), maxX: Math.max(first.x, second.x), maxY: Math.max(first.y, second.y) };
            }
            if (['rotate', 'scale', 'flip'].includes(type)) action.origin = point(tokens);
            if (type === 'flip') action.axisEnd = point(tokens);
            if (type === 'array') action.offset = point(tokens);
            if (tokens.length) return { error: 'syntax' };
            if (index >= 0) dynamic.actions[index] = action;
            else dynamic.actions.push(action);
        } else return { error: 'syntax' };
    } else if (['blockLookupTable', 'blockTable'].includes(command)) {
        const name = tokens.shift();
        dynamic.lookups ||= [];
        const index = dynamic.lookups.findIndex(table => table.name.toLowerCase() === name?.toLowerCase());
        if (verb === 'DELETE' && !tokens.length && index >= 0) dynamic.lookups.splice(index, 1);
        else if (verb === 'SET' && name) {
            const selectorName = tokens.shift(); const choice = tokens.shift();
            const selector = dynamic.parameters.find(parameter => parameter.name.toLowerCase() === selectorName?.toLowerCase());
            if (selector?.type !== 'choice' || !selector.choices.includes(choice) || !tokens.length) return { error: 'values' };
            const patch = {};
            while (tokens.length) {
                const parameterName = tokens.shift();
                const parameter = dynamic.parameters.find(parameter => parameter.name.toLowerCase() === parameterName.toLowerCase());
                if (!parameter || Object.hasOwn(patch, parameter.name)) return { error: 'values' };
                patch[parameter.name] = parameterValue(parameter.type, tokens);
            }
            const previous = index >= 0 && dynamic.lookups[index].parameter === selector.name ? dynamic.lookups[index] : null;
            const columns = new Set([...Object.keys(previous?.rows[0]?.values || {}), ...Object.keys(patch)]);
            const rows = selector.choices.map(key => ({ key, values: Object.fromEntries([...columns].map(column => [column,
                key === choice && Object.hasOwn(patch, column) ? patch[column]
                    : previous?.rows.find(row => row.key === key)?.values[column] ?? dynamic.parameters.find(parameter => parameter.name === column).default])) }));
            const table = { name, parameter: selector.name, rows };
            if (index >= 0) dynamic.lookups[index] = table;
            else dynamic.lookups.push(table);
        } else return { error: 'syntax' };
    } else if (command === 'blockVisibility') {
        if (verb === 'DELETE' && !tokens.length) delete dynamic.visibility;
        else if (verb === 'SET' && tokens.length === 2) {
            const parameter = dynamic.parameters.find(parameter => parameter.name.toLowerCase() === tokens[0].toLowerCase());
            const state = tokens[1];
            if (parameter?.type !== 'choice' || !parameter.choices.includes(state)) return { error: 'values' };
            const previous = dynamic.visibility?.parameter === parameter.name ? dynamic.visibility.states : {};
            dynamic.visibility = { parameter: parameter.name, states: Object.fromEntries(parameter.choices.map(choice => [choice,
                choice === state ? [...selectedIds] : previous[choice] || content.entities.map(entity => entity.id)])) };
        } else return { error: 'syntax' };
    } else return { error: 'syntax' };
    const normalized = normalizeDrawingDynamicBlock(dynamic, content.entities);
    if (!normalized) return { error: 'definition' };
    return { content: { ...content, blockDynamicDraft: normalized }, selectedIds };
}
