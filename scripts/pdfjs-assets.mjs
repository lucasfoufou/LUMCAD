import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Resolve an allowlist from the installed dependency, never from requested paths.
export function pdfjsAssets() {
    const require = createRequire(import.meta.url);
    const root = dirname(require.resolve('pdfjs-dist/package.json'));
    const files = new Map();
    for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
        for (const name of readdirSync(join(root, folder)).sort()) files.set(`pdfjs/${folder}/${name}`, join(root, folder, name));
    }
    return {
        name: 'lumcad-pdfjs-assets',
        configureServer(server) {
            server.middlewares.use((request, response, next) => {
                const file = files.get(request.url?.split('?')[0].replace(/^\//, ''));
                if (!file || !['GET', 'HEAD'].includes(request.method)) return next();
                response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
                response.end(request.method === 'HEAD' ? undefined : readFileSync(file));
            });
        },
        generateBundle() {
            for (const [fileName, file] of files) this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
        },
    };
}
