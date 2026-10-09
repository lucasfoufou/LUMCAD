import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import useLatestRef from './useLatestRef.js';
import { runMcpFrontendRequest } from '../mcp/frontendBridge.js';
import { isTauriRuntime } from '../utils/lcadStorage.js';

const MCP_REQUEST_EVENT = 'lumcad://mcp-request';

export default function useLumcadMcpBridge(handlers) {
    const handlersRef = useLatestRef(handlers);
    const [, setRenderRevision] = useState(0);

    useEffect(() => {
        if (import.meta.env.VITE_LUMCAD_E2E !== '1') return undefined;
        const api = { getState: () => handlersRef.current.getState() };
        window.__LUMCAD_E2E_STATE__ = api;
        return () => { if (window.__LUMCAD_E2E_STATE__ === api) delete window.__LUMCAD_E2E_STATE__; };
    }, [handlersRef]);

    useEffect(() => {
        if (!isTauriRuntime()) return undefined;
        const clientId = globalThis.crypto?.randomUUID?.() || `frontend-${Date.now()}-${Math.random()}`;
        let disposed = false;
        let unlisten = null;
        const handledRequests = new Set();

        const start = async () => {
            unlisten = await listen(MCP_REQUEST_EVENT, async event => {
                const id = String(event.payload?.id || '');
                if (disposed || !id || handledRequests.has(id)) return;
                // Hot reload can leave a native event subscription delivering
                // the same request twice. Never execute a CAD mutation twice or
                // let an early duplicate answer race the actual async command.
                handledRequests.add(id);
                if (handledRequests.size > 256) handledRequests.delete(handledRequests.values().next().value);
                let result;
                try {
                    const data = await runMcpFrontendRequest(event.payload.request, () => ({
                        ...handlersRef.current,
                        executeAction: action => flushHandlerUpdate(
                            () => handlersRef.current.executeAction(action),
                            () => { if (!disposed) setRenderRevision(value => value + 1); },
                        ),
                        openDocument: path => flushHandlerUpdate(
                            () => handlersRef.current.openDocument(path),
                            () => { if (!disposed) setRenderRevision(value => value + 1); },
                        ),
                        saveDocument: path => flushHandlerUpdate(
                            () => handlersRef.current.saveDocument(path),
                            () => { if (!disposed) setRenderRevision(value => value + 1); },
                        ),
                        replaceDocument: document => flushHandlerUpdate(
                            () => handlersRef.current.replaceDocument(document),
                            () => { if (!disposed) setRenderRevision(value => value + 1); },
                        ),
                    }));
                    result = { ok: true, data };
                } catch (error) {
                    result = { ok: false, error: error instanceof Error ? error.message : String(error) };
                }
                await invoke('complete_mcp_request', { id, result }).catch(() => {});
            });
            if (disposed) {
                unlisten();
                unlisten = null;
                return;
            }
            await invoke('set_mcp_frontend_ready', { clientId, ready: true });
        };

        start().catch(() => {});
        return () => {
            disposed = true;
            unlisten?.();
            invoke('set_mcp_frontend_ready', { clientId, ready: false }).catch(() => {});
        };
    }, [handlersRef]);
}

async function flushHandlerUpdate(callback, render) {
    let result;
    flushSync(() => { result = callback(); });
    const value = await result;
    // Async file/decoder work schedules state after the initial flushSync scope.
    // A real update on the editor owner flushes those updates even when WebKit
    // suspends background rendering, before the next MCP action reads handlers.
    flushSync(render);
    return value;
}
