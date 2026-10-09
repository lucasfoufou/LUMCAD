export function isHeadlessRuntime() {
    return globalThis.__LUMCAD_HEADLESS__ === true;
}
