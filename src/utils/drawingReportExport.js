/** Preserve text as text when spreadsheet software opens a report. */
export function drawingReportText(value) {
    const text = String(value ?? '');
    return /^[\s\u0000-\u001f]*[=+@-]/.test(text) ? `'${text}` : text;
}

export function drawingReportCsvCell(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return `"${drawingReportText(value).replaceAll('"', '""')}"`;
}

export function serializeDrawingReportCsv(rows) {
    const text = `\uFEFF${rows.map(row => row.map(drawingReportCsvCell).join(',')).join('\r\n')}\r\n`;
    if (new TextEncoder().encode(text).length > 64 * 1024 * 1024) throw new Error('dataExtractionLimit');
    return text;
}
