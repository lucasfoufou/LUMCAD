// First prompt of the common creation tools: what to click or type, with an
// x;y example (x,y in English) instead of a bare "tool active" notice.
const TOOLS_WITH_PROMPT = new Set(['line', 'rectangle', 'circle', 'arc', 'polygon', 'ellipse', 'spline', 'point', 'xline', 'ray']);

export function drawingToolPromptMessage(tool, t) {
    return TOOLS_WITH_PROMPT.has(tool)
        ? t(`toolPrompt.${tool}`)
        : t('messages.toolActive', { tool: t(`commands.${tool}`) });
}

export function drawingToolPromptKey(tool) {
    return TOOLS_WITH_PROMPT.has(tool) ? `toolPrompt.${tool}` : 'messages.toolActive';
}
