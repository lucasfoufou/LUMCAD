import { createServer } from 'vite';
process.env.VITE_LUMCAD_E2E = '1';
const server = await createServer({ server: { host: '127.0.0.1', port: 1429, strictPort: true, open: false } });
await server.listen();
server.printUrls();
