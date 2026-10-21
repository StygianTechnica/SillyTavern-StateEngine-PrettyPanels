// The Action Button: an action another extension offers (Scenario Builder:
// open a page, leave the scene, open the map), run from a panel or a card
// (src/elements/element-model.js, src/chat/extension-actions.js).

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/ui/object-manager.js', () => ({ openObjectManager: vi.fn() }));
vi.mock('../src/ui/dialogs.js', () => ({ notify: vi.fn() }));
vi.mock('../src/storage/store.js', () => ({ getStore: () => ({}), save: vi.fn() }));

const {
    normalizeVariableElement, normalizeActionOptions, isUnboundType, elementLabel, ELEMENT_TYPES, DEFAULT_TYPE_SIZES, DEFAULT_Z_INDEX,
} = await import('../src/elements/element-model.js');
const { parseActionRef, actionsOf } = await import('../src/chat/extension-actions.js');

describe('Action Button element', () => {
    it('is a listed, unbound type', () => {
        expect(ELEMENT_TYPES.some(([id]) => id === 'action')).toBe(true);
        expect(isUnboundType('action')).toBe(true);
        expect(DEFAULT_TYPE_SIZES.action).toEqual([32, 32]);
        expect(Number.isFinite(DEFAULT_Z_INDEX.action)).toBe(true);
        expect(elementLabel({ type: 'action' })).toBe('Action');
    });

    it('drops any binding and starts with no action chosen', () => {
        const el = normalizeVariableElement({ type: 'action', binding: { name: 'se__x' } });
        expect(el.binding).toBeNull();
        expect(el.action).toEqual({ ref: '', icon: '', label: '', showLabel: false, color: '', size: 16 });
    });

    it('keeps a well-formed ref and clamps the size', () => {
        expect(normalizeActionOptions({ ref: 'scenario-builder:leave', size: 500, showLabel: true, label: ' Go ' }))
            .toMatchObject({ ref: 'scenario-builder:leave', size: 72, showLabel: true, label: 'Go' });
        expect(normalizeActionOptions({ ref: 'no ref here' }).ref).toBe('');
    });
});

describe('extension actions', () => {
    it('reads a ref', () => {
        expect(parseActionRef('scenario-builder:map')).toEqual({ provider: 'scenario-builder', action: 'map' });
        expect(parseActionRef('map')).toBeNull();
    });

    it('turns a provider\'s list into refs, skipping malformed ones', () => {
        const provider = { id: 'scenario-builder', name: 'Scenario Builder' };
        const list = actionsOf(provider, [
            { id: 'leave', label: 'Leave the scene', icon: 'fa-person-walking', scope: 'object', description: 'Out of the scene' },
            { id: 'map', label: 'Open the map' },
            { id: 'bad id!' },
            null,
        ]);
        expect(list.map((a) => a.ref)).toEqual(['scenario-builder:leave', 'scenario-builder:map']);
        expect(list[0]).toMatchObject({ providerName: 'Scenario Builder', icon: 'person-walking', scope: 'object' });
        expect(list[1]).toMatchObject({ scope: 'panel', icon: 'hand-pointer' });
    });
});
