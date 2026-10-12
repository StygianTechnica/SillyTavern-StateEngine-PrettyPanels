// Bars and gauges: the range they measure (Min / Max Value, else the
// variable's) and their gradient (src/elements/widgets.js).

import { percentOf, effectiveRange, gradientStops, colorAt } from '../src/elements/widgets.js';
import { characterFieldDef } from '../src/elements/character-fields.js';

describe('the range a widget measures', () => {
    it('defaults to the variable\'s range, else 0..100', () => {
        expect(effectiveRange({}, {})).toEqual([0, 100]);
        expect(effectiveRange({}, { min: 10, max: 20 })).toEqual([10, 20]);
        expect(percentOf(15, { min: 10, max: 20 }, {})).toBe(50);
    });

    it('takes a negative Min Value - a -3..3 score fills from -3', () => {
        const widget = { minValue: -3, maxValue: 3 };
        expect(percentOf(-3, null, widget)).toBe(0);
        expect(percentOf(0, null, widget)).toBe(50);
        expect(percentOf(2, null, widget)).toBeCloseTo(83.33, 1);
        expect(percentOf(-9, null, widget)).toBe(0);
    });

    it('falls back when the range would be empty or upside down', () => {
        expect(effectiveRange({ minValue: 5, maxValue: 5 }, {})).toEqual([5, 100]);
        expect(effectiveRange({ minValue: 200 }, {})).toEqual([200, 300]);
    });

    it('is -3..3 for Archivist\'s relationship score with nothing set', () => {
        const def = characterFieldDef('archivist.relationship_score');
        expect(effectiveRange({}, def)).toEqual([-3, 3]);
        expect(percentOf(-1, def, {})).toBeCloseTo(33.33, 1);
        // The reported template: Max 3 set, Min from the field.
        expect(percentOf(-2, def, { maxValue: 3 })).toBeCloseTo(16.67, 1);
    });

    it('is not a number for no value', () => {
        expect(percentOf(undefined, null, {})).toBeNull();
        expect(percentOf('', null, {})).toBeNull();
    });
});

describe('the gradient', () => {
    it('is off without a high-end colour, and runs low (fill) - middle - high', () => {
        expect(gradientStops({ fillColor: '#ff0000' })).toBeNull();
        expect(gradientStops({ fillColor: '#ff0000', gradientColor: '#00ff00' })).toEqual(['#ff0000', '#00ff00']);
        expect(gradientStops({ fillColor: '#ff0000', gradientMid: '#888888', gradientColor: '#00ff00' })).toEqual(['#ff0000', '#888888', '#00ff00']);
        expect(gradientStops({ gradientColor: '#00ff00' })[0]).toMatch(/^var\(/);
    });

    it('gives a gauge the colour for its value', () => {
        expect(colorAt(['red', 'green'], 25)).toBe('color-mix(in srgb, green 25.0%, red)');
        expect(colorAt(['red', 'grey', 'green'], 25)).toBe('color-mix(in srgb, grey 50.0%, red)');
        expect(colorAt(['red', 'grey', 'green'], 75)).toBe('color-mix(in srgb, green 50.0%, grey)');
    });
});
