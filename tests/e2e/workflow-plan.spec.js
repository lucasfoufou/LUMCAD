import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import manifest from '../../src/mcp/commands.json' with { type: 'json' };
import { COVERED, TODO } from './workflow-plan.js';

const names = new Map(manifest.map(item => [item.command, item.name]));

test('every catalog command has a successful workflow or a planned one', () => {
    const planned = Object.values(TODO).flatMap(family => Object.keys(family));
    const duplicates = planned.filter((command, index) => planned.indexOf(command) !== index || Object.hasOwn(COVERED, command));
    expect(duplicates).toEqual([]);
    expect([...Object.keys(COVERED), ...planned].sort()).toEqual([...names.keys()].sort());
});

// Titles a COVERED reference may name: Playwright test titles of a spec file,
// or PASS lines of the native headless script. Template placeholders match any text.
const HEADLESS = 'npm run test:headless';
function knownTitles(source) {
    const path = source === HEADLESS ? new URL('../../scripts/test-headless.mjs', import.meta.url) : new URL(source, import.meta.url);
    const text = readFileSync(path, 'utf8');
    const pattern = source === HEADLESS
        ? /PASS: ((?:\\.|[^'`\\])*)['`]/g
        : /\btest(?:\.\w+)?\(\s*(['`])((?:\\.|(?!\1)[^\\])*)\1/g;
    return [...text.matchAll(pattern)].map(match => {
        const title = (source === HEADLESS ? match[1] : match[2]).replace(/\\(.)/g, '$1').replace(/\.$/, '');
        const escaped = title.split(/\$\{[^}]*\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        return new RegExp(`^${escaped.join('.+')}$`);
    });
}

test('every COVERED reference names an existing workflow test', () => {
    const titles = new Map();
    const missing = Object.entries(COVERED).filter(([, reference]) => {
        const parts = reference.split(' › ');
        const source = parts[0];
        const title = parts.at(-1).replace(/ \([^)]*\)$/, '').replace(/\.$/, '');
        if (!titles.has(source)) titles.set(source, knownTitles(source));
        return !titles.get(source).some(pattern => pattern.test(title));
    });
    expect(missing).toEqual([]);
});

for (const [family, commands] of Object.entries(TODO)) {
    test.describe(`workflow plan › ${family}`, () => {
        for (const [command, scenario] of Object.entries(commands)) {
            // TODO(e2e): replace with the scenario, then move the command to COVERED.
            test.fixme(`${names.get(command) || command} — ${scenario}`, async () => {});
        }
    });
}
