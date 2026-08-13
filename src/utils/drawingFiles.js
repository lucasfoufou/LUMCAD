export function downloadDrawingBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export function safeDrawingFilename(value) {
    return String(value || 'drawing').replace(/[^a-zA-Z0-9À-ÿ._ -]+/g, '-').trim() || 'drawing';
}
