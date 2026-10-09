import { test, expect } from '@playwright/test';
import manifest from '../../src/mcp/commands.json' with { type: 'json' };
import { COVERED, TODO } from './workflow-plan.js';

const names = new Map(manifest.map(item => [item.command, item.name]));

test('every catalog command has a successful workflow or a planned one', () => {
    const planned = Object.values(TODO).flatMap(family => Object.keys(family));
    const duplicates = planned.filter((command, index) => planned.indexOf(command) !== index || Object.hasOwn(COVERED, command));
    expect(duplicates).toEqual([]);
    expect([...Object.keys(COVERED), ...planned].sort()).toEqual([...names.keys()].sort());
});

for (const [family, commands] of Object.entries(TODO)) {
    test.describe(`workflow plan › ${family}`, () => {
        for (const [command, scenario] of Object.entries(commands)) {
            // TODO(e2e): replace with the scenario, then move the command to COVERED.
            test.fixme(`${names.get(command) || command} — ${scenario}`, async () => {});
        }
    });
}
