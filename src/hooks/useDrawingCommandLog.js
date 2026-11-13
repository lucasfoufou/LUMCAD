import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { appendDrawingCommandLog, formatDrawingCommandLog } from '~utils/drawingCommandLog';

/** Session log of submitted commands and the messages that followed them. */
export default function useDrawingCommandLog(message) {
    const [entries, setEntries] = useState([]);
    const nextId = useRef(1);
    const lastMessage = useRef(message);

    const add = useCallback((kind, text) => {
        const id = nextId.current++;
        setEntries(current => appendDrawingCommandLog(current, { id, kind, text }));
    }, []);

    useEffect(() => {
        if (message === lastMessage.current) return;
        lastMessage.current = message;
        if (message) add('message', message);
    }, [add, message]);

    const recordCommand = useCallback(command => {
        // An empty submission repeats or confirms; it is not worth a log line.
        if (command) add('command', command);
    }, [add]);

    return useMemo(() => ({
        entries,
        recordCommand,
        toText: () => formatDrawingCommandLog(entries),
    }), [entries, recordCommand]);
}
