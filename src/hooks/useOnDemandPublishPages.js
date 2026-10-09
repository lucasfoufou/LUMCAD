import { useCallback, useRef, useState } from 'react';

import { waitForPrintRendering } from '~utils/drawingPrint';

const MAX_MOUNT_WAITS = 20;

/**
 * Offscreen pages of every layout for unattended publication (AUTOPUBLISH, MCP
 * export_pdf). They are mounted only while a request runs: kept mounted, they
 * re-rendered every layout and viewport on each edit, pan and zoom.
 */
export default function useOnDemandPublishPages() {
    const rendererRef = useRef(null);
    const [requests, setRequests] = useState(0);
    const withPublishPages = useCallback(async use => {
        setRequests(count => count + 1);
        try {
            for (let attempt = 0; attempt < MAX_MOUNT_WAITS && !rendererRef.current; attempt += 1) {
                await waitForPrintRendering(window);
            }
            await waitForPrintRendering(window);
            return await use(rendererRef.current?.getPages() || []);
        } finally {
            setRequests(count => count - 1);
        }
    }, []);
    return { rendererRef, active: requests > 0, withPublishPages };
}
