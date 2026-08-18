import { useEffect } from 'react';
import { flushSync } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import useLatestRef from './useLatestRef.js';
import { runMcpFrontendRequest } from '../mcp/frontendBridge.js';
import { isTauriRuntime } from '../utils/lcadStorage.js';

const MCP_REQUEST_EVENT = 'lumcad://mcp-request';

export default function useLumcadMcpBridge(handlers) {
    const handlersRef = useLatestRef(handlers);

    useEffect(() => {
        if (!isTauriRuntime()) return undefined;
        const clientId = globalThis.crypto?.randomUUID?.() || `frontend-${Date.now()}-${Math.random()}`;
        let disposed = false;
        let unlisten = null;

        const start = async () => {
            unlisten = await listen(MCP_REQUEST_EVENT, async event => {
                const id = String(event.payload?.id || '');
                if (!id) return;
                let result;
                try {
                    const data = await runMcpFrontendRequest(event.payload.request, () => ({
                        ...handlersRef.current,
                        executeAction: action => flushHandlerUpdate(
                            () => handlersRef.current.executeAction(action),
                        ),
                        replaceDocument: document => flushHandlerUpdate(
                            () => handlersRef.current.replaceDocument(document),
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

function flushHandlerUpdate(callback) {
    let result;
    flushSync(() => { result = callback(); });
    return result;
}
