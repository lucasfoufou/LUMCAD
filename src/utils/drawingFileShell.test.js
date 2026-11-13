import assert from 'node:assert/strict';
import test from 'node:test';

import commandManifest from '../mcp/commands.json' with { type: 'json' };
import en from '../i18n/locales/en.js';
import fr from '../i18n/locales/fr.js';
import { appendDrawingCommandLog, formatDrawingCommandLog, DRAWING_COMMAND_LOG_LIMIT } from './drawingCommandLog.js';
import { DRAWING_COMMAND_GROUP_IDS, getDrawingCommandGroup, groupDrawingCommands } from './drawingCommandGroups.js';
import { foldDrawingSearchText, getDrawingCommandDefinition, searchDrawingCommands } from './drawingCommands.js';
import {
    DRAWING_EXPORT_FORMATS,
    DRAWING_IMPORT_FORMATS,
    getDrawingImportExtensions,
    getDrawingNameFromFile,
    resolveDrawingExportFormat,
    resolveDrawingImportFormat,
    resolveDrawingOpenFormat,
} from './drawingFileFormats.js';
import { takePreselectedDrawingFile, withPreselectedDrawingFile } from './drawingFileSelection.js';
import { resolveDrawingSaveStatus } from './drawingSaveStatus.js';

const french = key => fr[key] || key;
const english = key => en[key] || key;

test('IMPORT, EXPORT and OPEN route every format to an existing catalog command', () => {
    for (const format of [...DRAWING_IMPORT_FORMATS, ...DRAWING_EXPORT_FORMATS]) {
        assert.ok(getDrawingCommandDefinition(format.command), `${format.command} must exist`);
    }
    assert.equal(resolveDrawingImportFormat('C:\\plans\\Toiture.DWG').command, 'DWGIN');
    assert.equal(resolveDrawingImportFormat('plan.dxf').command, 'DXFIN');
    assert.equal(resolveDrawingImportFormat('relevé.pdf').command, 'PDFIMPORT');
    assert.equal(resolveDrawingImportFormat('photo.JPEG').command, 'IMAGEATTACH');
    assert.equal(resolveDrawingImportFormat('blocs.lcad').command, 'BLOCKIMPORT');
    assert.equal(resolveDrawingImportFormat('notes.txt'), null);
    assert.equal(resolveDrawingImportFormat('sans-extension'), null);
    assert.ok(!getDrawingImportExtensions({ desktop: false }).includes('dwg'));
    assert.ok(getDrawingImportExtensions().includes('dwg'));
    assert.equal(resolveDrawingOpenFormat('/home/a/plan.DXF'), 'dxf');
    assert.equal(resolveDrawingOpenFormat('plan.lcad'), 'lcad');
    assert.equal(resolveDrawingOpenFormat('plan.pdf'), null);
    assert.equal(resolveDrawingExportFormat('jpeg').command, 'JPGOUT');
    assert.equal(resolveDrawingExportFormat('.DWFX').command, 'DWFXOUT');
    assert.equal(resolveDrawingExportFormat(''), null);
    assert.equal(getDrawingNameFromFile('C:\\plans\\Maison Dupont.dwg', 'Sans titre'), 'Maison Dupont');
    assert.equal(getDrawingNameFromFile('', 'Sans titre'), 'Sans titre');
});

test('a preselected file answers one picker of its kind, then expires', async () => {
    const seen = await withPreselectedDrawingFile({ kind: 'path', value: '/tmp/a.dxf' }, async () => [
        takePreselectedDrawingFile('file'),
        takePreselectedDrawingFile('path'),
        takePreselectedDrawingFile('path'),
    ]);
    assert.deepEqual(seen, [null, '/tmp/a.dxf', null]);
    await withPreselectedDrawingFile({ kind: 'path', value: '/tmp/unused.dxf' }, async () => {});
    assert.equal(takePreselectedDrawingFile('path'), null);
    await assert.rejects(withPreselectedDrawingFile({ kind: 'path', value: '/x' }, async () => { throw new Error('boom'); }));
    assert.equal(takePreselectedDrawingFile('path'), null);
});

test('the save state is a warning while the drawing has no file', () => {
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'saved' }), { key: 'saveStatus.unsaved', tone: 'warning' });
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'saved', isRecovery: true }), { key: 'saveStatus.recovery', tone: 'warning' });
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'dirty' }), { key: 'saveStatus.recovery', tone: 'warning' });
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'saved', recovered: true }), { key: 'saveStatus.recovery', tone: 'warning' });
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'saved', filePath: '/a.lcad' }), { key: 'saveStatus.saved', tone: 'success' });
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'dirty', filePath: '/a.lcad' }), { key: 'saveStatus.saving', tone: 'progress' });
    assert.deepEqual(resolveDrawingSaveStatus({ status: 'error', filePath: '/a.lcad' }), { key: 'saveStatus.error', tone: 'danger' });
    for (const key of ['saveStatus.unsaved', 'saveStatus.recovery', 'saveStatus.saved', 'saveStatus.saving', 'saveStatus.error']) {
        assert.ok(en[key] && fr[key], key);
    }
});

test('command search matches translated labels without accents and ranks exact tokens first', () => {
    const names = (query, translate = french, limit = 50) => searchDrawingCommands(query, { translate, limit }).map(item => item.name);
    assert.equal(foldDrawingSearchText('  Paramètres '), 'parametres');
    assert.equal(names('import')[0], 'IMPORT');
    assert.ok(names('importer').includes('DWGIN'));
    assert.ok(names('importer').includes('DXFIN'));
    assert.equal(names('cote')[0], 'DIMENSION');
    assert.equal(names('calque')[0], 'LAYER');
    assert.ok(names('calque').length > 5, 'layer commands are found by their French label');
    assert.equal(names('parametres')[0], 'OPTIONS');
    assert.equal(names('PARAMÈTRES')[0], 'OPTIONS');
    assert.equal(names('aide')[0], 'HELP');
    assert.equal(names('?')[0], 'HELP');
    assert.equal(names('l')[0], 'LINE', 'an exact alias still wins');
    assert.ok(names('settings', english).includes('OPTIONS'));
    assert.ok(names('cercle').includes('CIRCLE'));
    assert.deepEqual(names('line move'), [], 'spaces mean command arguments in the command line');
    assert.ok(searchDrawingCommands('toutes les commandes', { translate: french, allowSpaces: true }).some(item => item.name === 'HELP'));
    assert.equal(names('d', french, 3).length, 3);
    assert.equal(searchDrawingCommands('zzzz', { translate: french }).length, 0);
});

test('French alternatives do not collide with another command', () => {
    const owners = new Map();
    for (const definition of commandManifest) {
        for (const token of [definition.name, definition.alias, ...definition.alternatives]) {
            const normalized = token.toUpperCase();
            assert.ok(!owners.has(normalized) || owners.get(normalized) === definition.command, `${normalized} is shared`);
            owners.set(normalized, definition.command);
        }
    }
    for (const [token, command] of [['CALQUE', 'layerFlags'], ['COTE', 'dimension'], ['HACHURES', 'hatch'],
        ['POLYLIGNE', 'widePolyline'], ['EFFACER', 'delete'], ['IMPRIMER', 'plot'], ['LIGNE', 'line'], ['DEPLACER', 'move']]) {
        assert.equal(getDrawingCommandDefinition(token)?.command, command, token);
    }
});

test('every command belongs to a palette family with translated titles', () => {
    for (const definition of commandManifest) {
        assert.notEqual(getDrawingCommandGroup(definition.command), 'other', `${definition.command} needs a family`);
    }
    for (const id of DRAWING_COMMAND_GROUP_IDS) {
        assert.ok(en[`commandPalette.group.${id}`] && fr[`commandPalette.group.${id}`], id);
    }
    const grouped = groupDrawingCommands([{ command: 'line' }, { command: 'move' }, { command: 'circle' }, { command: 'unknownThing' }]);
    assert.deepEqual(grouped.map(group => [group.id, group.commands.map(item => item.command)]), [
        ['draw', ['line', 'circle']], ['modify', ['move']], ['other', ['unknownThing']],
    ]);
});

test('the session log keeps commands and replies in order, bounded and copyable', () => {
    let log = [];
    log = appendDrawingCommandLog(log, { id: 1, kind: 'command', text: 'DWGIN' });
    log = appendDrawingCommandLog(log, { id: 2, kind: 'message', text: 'LibreDWG introuvable.' });
    log = appendDrawingCommandLog(log, { id: 3, kind: 'message', text: 'LibreDWG introuvable.' });
    log = appendDrawingCommandLog(log, { id: 4, kind: 'message', text: '   ' });
    assert.equal(formatDrawingCommandLog(log), '> DWGIN\nLibreDWG introuvable.');
    for (let index = 0; index < DRAWING_COMMAND_LOG_LIMIT + 5; index += 1) {
        log = appendDrawingCommandLog(log, { id: 10 + index, kind: 'command', text: `C${index}` });
    }
    assert.equal(log.length, DRAWING_COMMAND_LOG_LIMIT);
    assert.equal(log.at(-1).text, `C${DRAWING_COMMAND_LOG_LIMIT + 4}`);
});

test('the system language is used only when it is supported', async () => {
    const { detectSystemLanguage } = await import('../settings/appSettings.js');
    assert.equal(detectSystemLanguage(['fr-FR', 'en-US']), 'fr');
    assert.equal(detectSystemLanguage(['de-DE', 'fr-CA']), 'fr');
    assert.equal(detectSystemLanguage(['en_GB']), 'en');
    assert.equal(detectSystemLanguage(['de-DE', 'es']), null);
    assert.equal(detectSystemLanguage('fr'), 'fr');
    assert.equal(detectSystemLanguage([]), null);
});
