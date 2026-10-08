/** Binary Excel 97-2004 output. The codec is loaded only for spreadsheet export. */
export async function createDrawingSpreadsheet(rows) {
    if (!Array.isArray(rows) || !rows.length || rows.length > 65536 || !Array.isArray(rows[0]) || !rows[0].length || rows[0].length > 256
        || rows.some(row => !Array.isArray(row) || row.length !== rows[0].length
            || row.some(value => value !== null && (typeof value !== 'string' || value.length > 32767) && (typeof value !== 'number' || !Number.isFinite(value))))) {
        throw new Error('dataExtractionLimit');
    }
    const { utils, write } = await import('xlsx');
    // Explicit cell types retain literal '=' text without adding formulas or apostrophes.
    const cells = rows.map(row => row.map(value => value === null ? null : { t: typeof value === 'number' ? 'n' : 's', v: value }));
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, utils.aoa_to_sheet(cells), 'Quantities');
    const bytes = new Uint8Array(write(workbook, { type: 'array', bookType: 'biff8', bookSST: true }));
    if (bytes.length > 64 * 1024 * 1024) throw new Error('dataExtractionLimit');
    return bytes;
}
