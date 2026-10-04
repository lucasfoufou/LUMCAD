const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

export function normalizeImageAdjustments(value) {
    const percent = value => Number.isFinite(value) ? clamp(value, 0, 200) : 100;
    const key = value?.transparentColor;
    const validKey = typeof key === 'string' && /^#[0-9a-f]{6}$/i.test(key);
    return { brightness: percent(value?.brightness), contrast: percent(value?.contrast), monochrome: value?.monochrome === true,
        ...(validKey ? { transparentColor: key.toLowerCase(), colorTolerance: Number.isFinite(value.colorTolerance) ? clamp(value.colorTolerance, 0, 100) : 0 } : {}) };
}

export function imageAdjustmentTransfer(value) {
    const settings = normalizeImageAdjustments(value);
    return { ...settings, slope: settings.brightness * settings.contrast / 10000, intercept: (1 - settings.contrast / 100) / 2 };
}

export function hasImageAdjustments(value) {
    const settings = normalizeImageAdjustments(value);
    return settings.brightness !== 100 || settings.contrast !== 100 || settings.monochrome || Boolean(settings.transparentColor);
}

export function parseImageAdjustmentInput(input, current) {
    const tokens = String(input || '').trim().toUpperCase().split(/\s+/);
    const settings = normalizeImageAdjustments(current);
    if (tokens[0] === 'RESET' && tokens.length === 1) return normalizeImageAdjustments();
    if (tokens[0] === 'MONO' && tokens.length === 2 && ['ON', 'OFF'].includes(tokens[1])) return { ...settings, monochrome: tokens[1] === 'ON' };
    if (tokens[0] === 'KEY') {
        if (tokens.length === 2 && tokens[1] === 'OFF') {
            const { transparentColor, colorTolerance, ...rest } = settings;
            return rest;
        }
        const tolerance = tokens.length === 3 ? Number(tokens[2]) : 0;
        if ((tokens.length === 2 || tokens.length === 3) && /^#[0-9a-f]{6}$/i.test(tokens[1])
            && Number.isFinite(tolerance) && tolerance >= 0 && tolerance <= 100) return { ...settings, transparentColor: tokens[1].toLowerCase(), colorTolerance: tolerance };
    }
    if (['BRIGHTNESS', 'CONTRAST'].includes(tokens[0]) && tokens.length === 2) {
        const value = Number(tokens[1]);
        if (Number.isFinite(value) && value >= 0 && value <= 200) return { ...settings, [tokens[0].toLowerCase()]: value };
    }
    return null;
}

/** Bake the same sRGB transfer used by SVG into RGBA pixels for vector PDF image resources. */
export function applyImageAdjustmentsToPixels(pixels, value) {
    const { slope, intercept, monochrome } = imageAdjustmentTransfer(value);
    const key = imageTransparencyKey(value);
    for (let index = 0; index + 3 < pixels.length; index += 4) {
        if (key && key.channels.every((channel, component) => Math.abs(pixels[index + component] - channel) <= key.cutoff)) pixels[index + 3] = 0;
        const rgb = [0, 1, 2].map(channel => clamp(pixels[index + channel] * slope + intercept * 255, 0, 255));
        const gray = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        for (let channel = 0; channel < 3; channel += 1) pixels[index + channel] = Math.round(monochrome ? gray : rgb[channel]);
    }
    return pixels;
}

export function imageTransparencyKey(value) {
    const settings = normalizeImageAdjustments(value);
    if (!settings.transparentColor) return null;
    const channels = [1, 3, 5].map(index => parseInt(settings.transparentColor.slice(index, index + 2), 16));
    const cutoff = Math.floor(settings.colorTolerance * 255 / 100);
    return { channels, cutoff, tables: channels.map(channel => Array.from({ length: 256 }, (_, value) => Math.abs(value - channel) <= cutoff ? 1 : 0).join(' ')) };

}

export function imageAdjustmentFilterMarkup(id, value) {
    const { slope, intercept, monochrome } = imageAdjustmentTransfer(value);
    const key = imageTransparencyKey(value);
    const mask = key ? `<feComponentTransfer in="SourceGraphic">${['R', 'G', 'B'].map((channel, index) => `<feFunc${channel} type="discrete" tableValues="${key.tables[index]}"/>`).join('')}<feFuncA type="linear" slope="0" intercept="1"/></feComponentTransfer><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 1 1 0 -2"/><feComponentTransfer result="keyMask"><feFuncA type="table" tableValues="1 0"/></feComponentTransfer><feComposite in="SourceGraphic" in2="keyMask" operator="in"/>` : '';

    return `<filter id="${id}" color-interpolation-filters="sRGB">${mask}<feComponentTransfer>${['R', 'G', 'B'].map(channel => `<feFunc${channel} type="linear" slope="${slope}" intercept="${intercept}"/>`).join('')}</feComponentTransfer>${monochrome ? '<feColorMatrix type="saturate" values="0"/>' : ''}</filter>`;
}
