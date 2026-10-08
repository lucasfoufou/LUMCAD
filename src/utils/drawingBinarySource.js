/** Bounded data-URL transport shared by embedded CAD source assets. */
export function drawingBinarySourceCodec({ mimeType, maxBytes, validate, sourceError, limitError }) {
    const prefix = `data:${mimeType};base64,`;
    const checked = bytes => {
        if (!(bytes instanceof Uint8Array)) throw new Error(sourceError);
        if (bytes.length > maxBytes) throw new Error(limitError);
        validate(bytes);
        return bytes;
    };
    return {
        dataUrl(bytes) {
            checked(bytes);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
            return prefix + btoa(binary);
        },
        bytes(link) {
            if (typeof link !== 'string' || !link.startsWith(prefix)) throw new Error(sourceError);
            if (link.length > prefix.length + Math.ceil(maxBytes / 3) * 4) throw new Error(limitError);
            let binary;
            try { binary = atob(link.slice(prefix.length)); } catch { throw new Error(sourceError); }
            return checked(Uint8Array.from(binary, character => character.charCodeAt(0)));
        },
    };
}
