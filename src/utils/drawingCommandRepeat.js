import { getDrawingCommandDefinition } from './drawingCommands.js';

// Commands that open a dialog, touch files or only move through history are
// not repeated by an empty Enter, Space or the canvas menu (AutoCAD repeats
// them, but here an accidental Enter would open a file picker).
const NOT_REPEATABLE = new Set([
    'select', 'pan', 'new', 'quickNew', 'open', 'saveAs', 'saveTemplate', 'pdf', 'plot', 'pdfAll', 'pdfSelected',
    'publish', 'dwfx', 'autoPublish', 'aliasEdit', 'undo', 'redo', 'recover', 'recoverAll', 'imageAttach',
]);

/** Command-line name used to repeat a command or tool id, or null when it is not repeatable. */
export function drawingRepeatableCommandName(commandId) {
    if (!commandId || NOT_REPEATABLE.has(commandId)) return null;
    const definition = getDrawingCommandDefinition(commandId);
    return definition && definition.command === commandId ? definition.name : null;
}

/** An empty submission with nothing running repeats the last command. */
export function resolveDrawingRepeatSubmission(value, { idle, lastCommand }) {
    return !String(value ?? '').trim() && idle && lastCommand ? lastCommand : value;
}
