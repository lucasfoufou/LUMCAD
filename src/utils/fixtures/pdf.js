export function createLayeredPdfFixture() {
    const stream = '/OC /Red BDC 1 0 0 RG 10 20 m 80 20 l S EMC\n/OC /Blue BDC 0 0 1 RG 10 60 m 80 60 l S EMC\n';
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] /D << /Order [5 0 R 6 0 R] /ON [5 0 R] /OFF [6 0 R] >> >> >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /Red 5 0 R /Blue 6 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
        '<< /Type /OCG /Name (Red layer) >>',
        '<< /Type /OCG /Name (Blue layer) >>',
    ];
    return createPdfFixture(objects);
}

export function createPdfFixture(objects) {
    let text = '%PDF-1.7\n'; const offsets = [0];
    objects.forEach((object, index) => { offsets.push(text.length); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
    const start = text.length;
    text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
    text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
    return new TextEncoder().encode(text);
}


export function createImageMaskPdfFixture() {
    const stream = 'q 1 0 0 rg 30 0 0 40 10 40 cm /Mask Do Q\n'
        + 'q 0 0 1 rg 20 0 0 20 60 60 cm /Mask Do Q\n'
        + 'q 0 1 0 rg 20 0 0 20 60 20 cm /Inverse Do Q\n';
    return createPdfFixture([
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << /XObject << /Mask 5 0 R /Inverse 6 0 R >> >> /Contents 4 0 R >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
        '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ImageMask true /BitsPerComponent 1 /Decode [0 1] /Filter /ASCIIHexDecode /Length 5 >>\nstream\n4080>\nendstream',
        '<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ImageMask true /BitsPerComponent 1 /Decode [1 0] /Filter /ASCIIHexDecode /Length 5 >>\nstream\n4080>\nendstream',
    ]);
}
