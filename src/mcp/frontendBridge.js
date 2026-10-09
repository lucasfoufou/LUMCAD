export const MCP_REQUEST_KINDS = Object.freeze({
    getState: 'get_state',
    executeCommand: 'execute_command',
    interact: 'interact',
    replaceDocument: 'replace_document',
});

export async function runMcpFrontendRequest(request, getHandlers, settle = settleReactState) {
    if (!request || typeof request !== 'object') throw new Error('The MCP request must be an object.');
    if (typeof getHandlers !== 'function') throw new Error('The MCP frontend handlers are unavailable.');

    const fileHandler = { open_document: 'openDocument', save_document: 'saveDocument', export_pdf: 'exportPdf' }[request.kind];
    if (fileHandler) {
        const result = await getHandlers()[fileHandler](request.path, request.layoutIds);
        await settle();
        return result;
    }

    if (request.kind === MCP_REQUEST_KINDS.getState) return getHandlers().getState();

    if (request.kind === MCP_REQUEST_KINDS.replaceDocument) {
        await getHandlers().replaceDocument(request.document);
        await settle();
        return getHandlers().getState();
    }

    if (request.kind === MCP_REQUEST_KINDS.executeCommand) {
        if (Array.isArray(request.selection)) {
            await executeStep(getHandlers, { type: 'selection', ids: request.selection }, settle);
        }
        await executeStep(getHandlers, {
            type: 'command',
            command: request.command,
            input: request.input ?? null,
        }, settle);
        for (const action of normalizeActions(request.actions)) {
            await executeStep(getHandlers, action, settle);
        }
        return getHandlers().getState();
    }

    if (request.kind === MCP_REQUEST_KINDS.interact) {
        for (const action of normalizeActions(request.actions)) {
            await executeStep(getHandlers, action, settle);
        }
        return getHandlers().getState();
    }

    throw new Error(`Unsupported MCP request kind: ${String(request.kind || '')}`);
}

export function normalizeMcpAction(action) {
    if (!action || typeof action !== 'object') throw new Error('Every MCP action must be an object.');
    if (!['point', 'input', 'enter', 'escape'].includes(action.type)) {
        throw new Error(`Unsupported MCP action: ${String(action.type || '')}`);
    }
    if (action.type === 'point') {
        const x = Number(action.x);
        const y = Number(action.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('MCP point actions require finite x and y coordinates.');
        return {
            type: 'point',
            x,
            y,
            targetId: typeof action.targetId === 'string' && action.targetId ? action.targetId : null,
            shift: Boolean(action.shift),
            snap: Boolean(action.snap),
        };
    }
    if (action.type === 'input') {
        if (typeof action.value !== 'string') throw new Error('MCP input actions require a string value.');
        return { type: 'input', value: action.value };
    }
    return { type: action.type };
}

function normalizeActions(actions) {
    if (actions === undefined || actions === null) return [];
    if (!Array.isArray(actions)) throw new Error('MCP actions must be an array.');
    return actions.map(normalizeMcpAction);
}

async function executeStep(getHandlers, action, settle) {
    await getHandlers().executeAction(action);
    await settle();
}

function settleReactState() {
    return new Promise(resolve => {
        if (typeof window === 'undefined') {
            queueMicrotask(resolve);
            return;
        }
        // requestAnimationFrame may be suspended for a background/minimized Tauri
        // window. A macrotask still lets React commit and refresh handlers without
        // making MCP calls depend on whether the canvas is currently visible.
        window.setTimeout(resolve, 16);
    });
}
