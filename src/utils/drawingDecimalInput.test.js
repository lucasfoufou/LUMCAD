import { describe, expect, it } from 'vitest';
import { formatCommittedDecimal, resolveCommittedDecimal } from './drawingDecimalInput.js';

describe('committed decimal input', () => {
    it('rounds long values for display and uses the French decimal comma', () => {
        expect(formatCommittedDecimal(-0.6024524215023329)).toBe('-0.6025');
        expect(formatCommittedDecimal(-0.6024524215023329, { locale: 'fr' })).toBe('-0,6025');
        expect(formatCommittedDecimal(2)).toBe('2');
        expect(formatCommittedDecimal(-0.00001)).toBe('0');
        expect(formatCommittedDecimal(undefined)).toBe('');
    });

    it('accepts point and comma and clamps to the field range', () => {
        expect(resolveCommittedDecimal('0.2')).toBe(0.2);
        expect(resolveCommittedDecimal('0,2')).toBe(0.2);
        expect(resolveCommittedDecimal('0,001', { min: 0.01 })).toBe(0.01);
        expect(resolveCommittedDecimal('12', { max: 8 })).toBe(8);
    });

    it('discards incomplete, invalid and unchanged drafts', () => {
        expect(resolveCommittedDecimal('0,')).toBeNull();
        expect(resolveCommittedDecimal('abc')).toBeNull();
        expect(resolveCommittedDecimal('')).toBeNull();
        expect(resolveCommittedDecimal('-0,6025', { current: -0.6024524215023329 })).toBeNull();
        expect(resolveCommittedDecimal('-0,6', { current: -0.6024524215023329 })).toBe(-0.6);
    });
});
