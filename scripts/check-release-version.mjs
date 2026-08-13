import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tag = process.argv[2] || process.env.GITHUB_REF_NAME || '';
const semverTag = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!semverTag.test(tag)) {
    fail(`Expected a semantic version tag such as v0.1.0, received "${tag || '(empty)'}".`);
}

const expected = tag.slice(1);
const packageJson = readJson('package.json');
const packageLock = readJson('package-lock.json');
const tauriConfig = readJson('src-tauri/tauri.conf.json');
const cargoToml = readText('src-tauri/Cargo.toml');
const lcadDocument = readText('src/utils/lcadDocument.js');

const versions = new Map([
    ['package.json', packageJson.version],
    ['package-lock.json', packageLock.version],
    ['package-lock.json root package', packageLock.packages?.['']?.version],
    ['src-tauri/Cargo.toml', matchVersion(cargoToml, /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m, 'Cargo package version')],
    ['src-tauri/tauri.conf.json', tauriConfig.version],
    ['src/utils/lcadDocument.js', matchVersion(lcadDocument, /^export const LCAD_APP_VERSION\s*=\s*['"]([^'"]+)['"];?$/m, 'LCAD application version')],
]);

const mismatches = [...versions].filter(([, version]) => version !== expected);
if (mismatches.length > 0) {
    const details = mismatches.map(([source, version]) => `  - ${source}: ${String(version)}`).join('\n');
    fail(`Tag ${tag} requires version ${expected} everywhere, but found:\n${details}`);
}

console.log(`Release ${tag} is consistent across ${versions.size} version declarations.`);

function readJson(path) {
    try {
        return JSON.parse(readText(path));
    } catch (error) {
        fail(`Cannot parse ${path}: ${error.message}`);
    }
}

function readText(path) {
    try {
        return readFileSync(resolve(root, path), 'utf8');
    } catch (error) {
        fail(`Cannot read ${path}: ${error.message}`);
    }
}

function matchVersion(source, pattern, label) {
    const value = source.match(pattern)?.[1];
    if (!value) fail(`Cannot find ${label}.`);
    return value;
}

function fail(message) {
    console.error(message);
    process.exit(1);
}
