import { invoke } from '@tauri-apps/api/core';
import { isTauriRuntime } from './lcadStorage.js';
import { normalizeDrawingHyperlink } from './drawingHyperlinks.js';

export async function openDrawingHyperlink(value) {
    const link = normalizeDrawingHyperlink(value);
    if (!link) throw new Error('url');
    if (isTauriRuntime()) await invoke('open_drawing_hyperlink', { url: link.url });
    else window.open(link.url, '_blank', 'noopener,noreferrer');
}
