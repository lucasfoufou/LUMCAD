import { useCallback, useEffect, useMemo, useState } from 'react';
import { drawingRepeatableCommandName } from '~utils/drawingCommandRepeat';

// Remembers the last command (typed, from the rail or from a menu) so an empty
// Enter, a Space tap or the canvas menu can repeat it, and drives the
// right-click menu: Enter while a command runs, a small menu when idle.
export default function useDrawingCommandRepeat({ activeTool, operationType, selectionCount, submitCommand, t }) {
    const [lastCommand, setLastCommand] = useState(null);
    const [menuPosition, setMenuPosition] = useState(null);

    const remember = useCallback(commandId => {
        const name = drawingRepeatableCommandName(commandId);
        if (name) setLastCommand(name);
    }, []);

    useEffect(() => {
        remember(operationType || (activeTool !== 'select' ? activeTool : null));
    }, [activeTool, operationType, remember]);

    const run = useCallback(value => { submitCommand(value).catch(() => {}); }, [submitCommand]);
    const closeMenu = useCallback(() => setMenuPosition(null), []);

    const requestContextMenu = useCallback(({ clientX, clientY, busy }) => {
        if (busy) { run(''); return; }
        setMenuPosition({ x: clientX, y: clientY });
    }, [run]);

    const menuItems = useMemo(() => [
        ...(lastCommand ? [{ id: 'repeat', label: t('contextMenu.repeat', { command: lastCommand }), shortcut: t('contextMenu.enterKey'), run: () => run(lastCommand) }] : []),
        ...(selectionCount ? [
            { id: 'move', label: t('commands.move'), shortcut: 'M', run: () => run('MOVE') },
            { id: 'copy', label: t('commands.copy'), shortcut: 'CO', run: () => run('COPY') },
            { id: 'rotate', label: t('commands.rotate'), shortcut: 'RO', run: () => run('ROTATE') },
            { id: 'delete', label: t('contextMenu.delete'), shortcut: 'E', danger: true, run: () => run('ERASE') },
            { id: 'properties', label: t('contextMenu.properties'), shortcut: 'PR', run: () => run('PROPERTIES') },
        ] : []),
    ], [lastCommand, run, selectionCount, t]);

    return { lastCommand, remember, requestContextMenu, menu: { position: menuPosition, items: menuItems, onClose: closeMenu } };
}
