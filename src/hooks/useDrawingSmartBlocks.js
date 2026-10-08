import { useState } from 'react';
import { tokenizeDrawingAttributeInput } from '~utils/drawingBlockAttributes';
import { detectDrawingSmartBlocks, replaceDrawingSmartBlocks, replaceDrawingBlockInstances } from '~utils/drawingSmartBlocks';

export default function useDrawingSmartBlocks({ history, selectedIds, setSelectedIds, enabled, setMessage, t }) {
    const [lastDetection, setLastDetection] = useState(null);
    const run = (command, input) => {
        if (!['blockDetect', 'blockConvert', 'blockReplace'].includes(command)) return false;
        if (!enabled) { setMessage(t('block.error.closeFirst')); return true; }
        const tokens = tokenizeDrawingAttributeInput(input);
        if (!tokens || tokens.length !== (command === 'blockDetect' ? 0 : 1)) { setMessage(t('smartBlock.syntax')); return true; }
        const content = history.content;
        const result = command === 'blockDetect' ? detectDrawingSmartBlocks(content, selectedIds)
            : command === 'blockConvert' ? replaceDrawingSmartBlocks(content, selectedIds, tokens[0])
                : replaceDrawingBlockInstances(content, selectedIds, tokens[0]);
        if (result.error) { setMessage(t(`smartBlock.${result.error}`)); return true; }
        if (result.content) {
            history.commit(result.content); setSelectedIds(result.selectedIds); setLastDetection(null);
            setMessage(t('smartBlock.replaced', { count: result.count }));
        } else {
            setLastDetection({ content, ...result });
            setMessage(t('smartBlock.detected', { count: result.occurrences.length }));
        }
        return true;
    };
    const currentDetection = lastDetection?.content === history.content
        && lastDetection.sources.length === selectedIds.length && lastDetection.sources.every(id => selectedIds.includes(id));
    return { run, detection: currentDetection ? lastDetection : null };
}
