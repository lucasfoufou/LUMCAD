import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pdfjsAssets } from './scripts/pdfjs-assets.mjs';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
    plugins: [react(), pdfjsAssets()],
    resolve: {
        alias: [{ find: /^~/, replacement: fileURLToPath(new URL('./src/', import.meta.url)) }],
    },
    clearScreen: false,
    server: {
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
        watch: { ignored: ['**/src-tauri/**'] },
    },
});
