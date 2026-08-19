import assert from 'node:assert/strict';
import test from 'node:test';

import commandManifest from '../mcp/commands.json' with { type: 'json' };
import { TRANSLATIONS } from '../i18n/translator.js';
import { runMcpFrontendRequest } from '../mcp/frontendBridge.js';
import { drawingCommandDefinitions, getDrawingCommandDefinition } from './drawingCommands.js';

test('the MCP command manifest covers every drawing command exactly once', () => {
    assert.equal(commandManifest.length, 81);
    const editorCommands = drawingCommandDefinitions.map(definition => definition.command).sort();
    const mcpCommands = commandManifest.map(definition => definition.command).sort();
    assert.deepEqual(mcpCommands, editorCommands);
    assert.equal(new Set(mcpCommands).size, mcpCommands.length);
    assert.equal(new Set(commandManifest.map(definition => definition.name)).size, commandManifest.length);
    const tokens = new Map();
    for (const definition of commandManifest) {
        assert.ok(definition.description.trim(), `${definition.command} needs an MCP description`);
        assert.equal(getDrawingCommandDefinition(definition.command)?.name, definition.name);
        assert.equal(getDrawingCommandDefinition(definition.alias)?.command, definition.command);
        assert.ok(TRANSLATIONS.en[definition.labelKey], `${definition.command} needs an English command label`);
        assert.ok(TRANSLATIONS.fr[definition.labelKey], `${definition.command} needs a French command label`);
        for (const token of [definition.name, definition.alias, ...definition.alternatives]) {
            const normalized = token.trim().toUpperCase();
            assert.ok(normalized, `${definition.command} contains a blank command token`);
            assert.ok(!tokens.has(normalized) || tokens.get(normalized) === definition.command,
                `${normalized} is shared by multiple commands`);
            tokens.set(normalized, definition.command);
            assert.equal(getDrawingCommandDefinition(normalized)?.command, definition.command);
        }
    }
    assert.deepEqual(commandManifest
        .filter(definition => REQUESTED_TOOL_COMMANDS.has(definition.command))
        .map(definition => definition.command), [...REQUESTED_TOOL_COMMANDS]);
});

const REQUESTED_TOOL_COMMANDS = new Set([
    'trim', 'extend',
    'copy', 'copyBase', 'copyClip', 'cutClip', 'pasteClip', 'pasteOriginal', 'pasteBlock',
    'break', 'breakAtPoint', 'stretch', 'lengthen',
    'join', 'explode', 'xplode',
    'align',
    'fillet', 'chamfer', 'blend',
]);

test('an MCP command applies selection, command, and interactions in order', async () => {
    const calls = [];
    let revision = 0;
    const handlers = {
        executeAction(action) { calls.push(action); },
        getState() { return { revision }; },
        replaceDocument() {},
    };
    const result = await runMcpFrontendRequest({
        kind: 'execute_command',
        command: 'line',
        selection: ['line-1'],
        actions: [
            { type: 'point', x: 1, y: 2, snap: true },
            { type: 'input', value: '5' },
            { type: 'escape' },
        ],
    }, () => handlers, async () => { revision += 1; });

    assert.deepEqual(calls, [
        { type: 'selection', ids: ['line-1'] },
        { type: 'command', command: 'line', input: null },
        { type: 'point', x: 1, y: 2, targetId: null, shift: false, snap: true },
        { type: 'input', value: '5' },
        { type: 'escape' },
    ]);
    assert.deepEqual(result, { revision: 5 });
});

test('each MCP action settles before the next action reads refreshed interactive state', async () => {
    let state = { tool: 'select', firstPoint: null, entities: 0 };
    let pendingState = null;
    const settle = async () => {
        if (!pendingState) return;
        state = pendingState;
        pendingState = null;
    };
    const handlers = {
        executeAction(action) {
            if (action.type === 'command') {
                pendingState = { ...state, tool: action.command };
                return;
            }
            assert.equal(state.tool, 'line');
            if (action.type === 'point' && !state.firstPoint) {
                pendingState = { ...state, firstPoint: { x: action.x, y: action.y } };
            } else if (action.type === 'point') {
                pendingState = { ...state, entities: state.entities + 1 };
            } else if (action.type === 'escape') {
                pendingState = { ...state, tool: 'select', firstPoint: null };
            }
        },
        getState() { return state; },
        replaceDocument() {},
    };

    const result = await runMcpFrontendRequest({
        kind: 'execute_command',
        command: 'line',
        actions: [
            { type: 'point', x: 9000, y: 9000 },
            { type: 'point', x: 9001, y: 9000 },
            { type: 'escape' },
        ],
    }, () => handlers, settle);

    assert.deepEqual(result, { tool: 'select', firstPoint: null, entities: 1 });
});

test('MCP interaction validation rejects unsupported or malformed actions', async () => {
    const handlers = { executeAction() {}, getState() { return {}; }, replaceDocument() {} };
    await assert.rejects(
        runMcpFrontendRequest({ kind: 'interact', actions: [{ type: 'point', x: 'no', y: 1 }] }, () => handlers),
        /finite x and y/,
    );
    await assert.rejects(
        runMcpFrontendRequest({ kind: 'interact', actions: [{ type: 'drag' }] }, () => handlers),
        /Unsupported MCP action/,
    );
});
