// Character templates and cards read State Engine's character OBJECTS
// (State Engine API Reference, "Object API"): object variables
// ({ type: 'object', objectType: 'character' } / arrays of them), and
// characters shaped { ...identity, ...the type's fields, runtime: { present,
// values, images } }.

import { isCharacterDefinition, objectTypeOf } from '../src/elements/object-defs.js';
import { valueKind } from '../src/elements/text-format.js';
import {
    characterFieldValue, characterEntry, characterFieldDef, characterFieldList, CHARACTER_IDENTITY_FIELDS, SAMPLE_CHARACTER,
} from '../src/elements/character-fields.js';

// A character as State Engine's listObjects() returns it.
const mira = {
    id: 'chr_mira', type: 'character', name: 'Mira', aliases: ['the courier'], image: 'user/images/mira.png',
    description: 'A courier who never reads the letters.', introduction_snippet: 'Mira slipped in from the rain.',
    personality: 'Wry', faction: 'Brass Guild', role: 'Courier', goals: '', relationships: 'Owes Kael a favour.',
    confirmed: true, scope: 'setting', settingId: 'default', present: true,
    runtime: { present: true, values: { thought: 'Late again.', mood: 'Determined', intent: null, loyalty: 7 }, images: { mood: 'user/images/determined.png' } },
};

describe('object variable definitions', () => {
    it.each([
        [{ type: 'object', objectType: 'character' }, true],
        [{ type: 'array', itemType: 'object', itemObjectType: 'character' }, true],
        [{ type: 'object', objectType: 'location' }, false],
        [{ type: 'array', itemType: 'object', itemObjectType: 'faction' }, false],
        [{ type: 'string' }, false],
        [{ type: 'character' }, false],
        [undefined, false],
    ])('%j is a character definition: %s', (def, expected) => {
        expect(isCharacterDefinition(def)).toBe(expected);
    });

    it('names the object type a variable holds', () => {
        expect(objectTypeOf({ type: 'object', objectType: 'location' })).toBe('location');
        expect(objectTypeOf({ type: 'array', itemType: 'object', itemObjectType: 'item' })).toBe('item');
        expect(objectTypeOf({ type: 'array', itemType: 'string' })).toBeNull();
    });

    it('draws character object variables as cards', () => {
        expect(valueKind({ type: 'object', objectType: 'character' }, 'chr_mira')).toBe('character');
        expect(valueKind({ type: 'array', itemType: 'object', itemObjectType: 'character' }, ['chr_mira'])).toBe('character');
        expect(valueKind({ type: 'array', itemType: 'object', itemObjectType: 'location' }, ['loc_inn'])).toBe('list');
    });
});

describe('character fields', () => {
    it('reads identity and the character type\'s fields', () => {
        expect(characterFieldValue(mira, 'name')).toBe('Mira');
        expect(characterFieldValue(mira, 'description')).toBe('A courier who never reads the letters.');
        expect(characterFieldValue(mira, 'relationships')).toBe('Owes Kael a favour.');
        expect(characterFieldValue(mira, 'aliases')).toEqual(['the courier']);
        expect(characterFieldValue(mira, 'present')).toBe(true);
    });

    it('treats empty values as none', () => {
        expect(characterFieldValue(mira, 'goals')).toBeUndefined();
        expect(characterFieldValue({ ...mira, aliases: [] }, 'aliases')).toBeUndefined();
        expect(characterFieldValue(null, 'name')).toBeUndefined();
    });

    it('reads a template saved with "biography" from description', () => {
        expect(characterFieldValue(mira, 'biography')).toBe('A courier who never reads the letters.');
        expect(characterFieldDef('biography')).toMatchObject({ name: 'char:biography', label: 'Description', type: 'text', characterField: 'biography' });
    });

    it('reads built-in and custom runtime fields from runtime.values', () => {
        expect(characterFieldValue(mira, 'thought')).toBe('Late again.');
        expect(characterFieldValue(mira, 'mood')).toBe('Determined');
        expect(characterFieldValue(mira, 'intent')).toBeUndefined();
        expect(characterFieldValue(mira, 'custom.loyalty')).toBe(7);
    });

    it('reads an enum field\'s icon, and falls back to its word without one', () => {
        expect(characterEntry(mira, 'icon.mood')).toMatchObject({ value: 'user/images/determined.png', def: { type: 'image' } });
        const noIcon = { ...mira, runtime: { ...mira.runtime, images: {} } };
        expect(characterEntry(noIcon, 'icon.mood')).toMatchObject({ value: 'Determined', def: { type: 'string' } });
    });

    it('offers the object fields in the palette, and State Engine\'s runtime fields', () => {
        const fields = characterFieldList([
            { name: 'thought', type: 'string', builtIn: true },
            { name: 'mood', type: 'enum', values: ['Calm'], builtIn: true },
            { name: 'loyalty', type: 'number', builtIn: false },
        ]).map((f) => f.field);
        expect(fields).toEqual(expect.arrayContaining(['description', 'goals', 'relationships', 'thought', 'mood', 'custom.loyalty', 'icon.mood']));
        expect(fields).not.toContain('biography');
        expect(CHARACTER_IDENTITY_FIELDS.map(([f]) => f)).not.toContain('biography');
    });

    it('has a sample character in the object shape, every field filled', () => {
        for (const [field] of CHARACTER_IDENTITY_FIELDS.filter(([f]) => f !== 'image')) {
            expect(characterFieldValue(SAMPLE_CHARACTER, field), field).not.toBeUndefined();
        }
        expect(characterFieldValue(SAMPLE_CHARACTER, 'mood')).toBe('Curious');
    });
});

describe('yes/no fields of an object (for showing elements only when there is something to show)', () => {
    it('confirmed, has an image, has a description', async () => {
        const { characterFieldValue, objectsFieldValue } = await import('../src/elements/character-fields.js');
        const docks = { id: 'loc_d', name: 'The Docks', confirmed: true, image: 'user/images/docks.png', description: '' };
        const alley = { id: 'loc_a', name: 'The Alley', confirmed: false, image: null, description: 'Narrow.' };
        expect(characterFieldValue(docks, 'confirmed')).toBe(true);
        expect(characterFieldValue(docks, 'has_image')).toBe(true);
        expect(characterFieldValue(docks, 'has_description')).toBe(false);
        expect(characterFieldValue(alley, 'has_image')).toBe(false);
        // A list: on when any of them is; nothing held: no value.
        expect(objectsFieldValue([alley, docks], 'has_image')).toBe(true);
        expect(objectsFieldValue([alley], 'confirmed')).toBe(false);
        expect(objectsFieldValue(null, 'confirmed')).toBeUndefined();
    });
});
