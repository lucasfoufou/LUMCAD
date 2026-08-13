import assert from 'node:assert/strict';
import test from 'node:test';

import commandManifest from '../mcp/commands.json' with { type: 'json' };
import { runMcpFrontendRequest } from '../mcp/frontendBridge.js';
import { drawingCommandDefinitions, getDrawingCommandDefinition } from './drawingCommands.js';

test('the MCP command manifest covers every drawing command exactly once', () => {
    const editorCommands = drawingCommandDefinitions.map(definition => definition.command).sort();
    const mcpCommands = commandManifest.map(definition => definition.command).sort();
    assert.deepEqual(mcpCommands, editorCommands);
    assert.equal(new Set(mcpCommands).size, mcpCommands.length);
    assert.equal(new Set(commandManifest.map(definition => definition.name)).size, commandManifest.length);
    for (const definition of commandManifest) {
        assert.ok(definition.description.trim(), `${definition.command} needs an MCP description`);
        assert.equal(getDrawingCommandDefinition(definition.command)?.name, definition.name);
        assert.equal(getDrawingCommandDefinition(definition.alias)?.command, definition.command);
    }
});

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
