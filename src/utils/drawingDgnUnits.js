import { DRAWING_UNITS } from './drawingCoordinates.js';

const units = Object.freeze({ ...DRAWING_UNITS, 'us-ft': 1200 / 3937 });
const normalizedUnit = value => typeof value === 'string' ? value.trim().toLowerCase() : '';

/** Labels are user-editable in V7: unknown or inconsistent labels require an explicit unit. */
export function resolveDrawingDgnUnits(header, override = null) {
    const master = normalizedUnit(header?.masterUnit); const sub = normalizedUnit(header?.subUnit);
    if (override !== null && override !== undefined) {
        const unit = normalizedUnit(override);
        if (!Object.hasOwn(units, unit)) throw new Error('dgnUnits');
        return { unit, metresPerMaster: units[unit], source: 'override' };
    }
    const ratio = header?.subunitsPerMaster;
    if (!Number.isSafeInteger(ratio) || ratio <= 0) throw new Error('dgnInvalid');
    const masterFactor = Object.hasOwn(units, master) ? units[master] : null;
    const subFactor = Object.hasOwn(units, sub) ? units[sub] * ratio : null;
    if (masterFactor !== null && subFactor !== null
        && Math.abs(masterFactor - subFactor) > 1e-10 * Math.max(masterFactor, subFactor)) throw new Error('dgnUnits');
    const metresPerMaster = masterFactor ?? subFactor;
    if (metresPerMaster === null || metresPerMaster < 1e-12 || metresPerMaster > 1e9) throw new Error('dgnUnits');
    return { unit: masterFactor !== null ? master : null, metresPerMaster, source: masterFactor !== null ? 'master' : 'subunit' };
}
