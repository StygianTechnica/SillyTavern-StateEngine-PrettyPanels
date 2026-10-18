// The Icon element: one Font Awesome icon on its own - a bullet point
// (src/elements/element-model.js).

import { describe, it, expect } from 'vitest';
import {
    normalizeVariableElement, normalizeIconOptions, isUnboundType, elementLabel, ELEMENT_TYPES, DEFAULT_TYPE_SIZES, DEFAULT_Z_INDEX,
} from '../src/elements/element-model.js';

describe('Icon element', () => {
    it('is a listed, unbound type with a small default box', () => {
        expect(ELEMENT_TYPES.some(([id]) => id === 'icon')).toBe(true);
        expect(isUnboundType('icon')).toBe(true);
        expect(DEFAULT_TYPE_SIZES.icon).toEqual([24, 24]);
        expect(Number.isFinite(DEFAULT_Z_INDEX.icon)).toBe(true);
    });

    it('drops any binding and defaults to a small centred dot', () => {
        const icon = normalizeVariableElement({ type: 'icon', binding: { name: 'se__x' } });
        expect(icon.binding).toBeNull();
        expect(icon.icon).toEqual({ icon: 'circle', color: '', size: 10, align: 'center' });
        expect(elementLabel(icon, null)).toBe('Icon');
    });

    it('keeps a chosen look, clamping size and refusing unknown alignments', () => {
        expect(normalizeIconOptions({ icon: ' caret-right ', color: '#ff0000', size: 1000, align: 'left' }))
            .toEqual({ icon: 'caret-right', color: '#ff0000', size: 160, align: 'left' });
        expect(normalizeIconOptions({ size: 1, align: 'middle' })).toMatchObject({ size: 4, align: 'center' });
    });
});
