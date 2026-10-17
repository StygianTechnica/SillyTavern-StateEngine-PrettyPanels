import { describe, it, expect } from 'vitest';
import { objectFieldList, sampleObject, characterFieldValue, COMMON_OBJECT_FIELDS } from '../src/elements/character-fields.js';
import { templateObjectType, templateFits } from '../src/library/character-template-library.js';

const location = { id: 'location', label: 'Location', hasPresence: false };
const creature = { id: 'creature', label: 'Creature', hasPresence: true };
const locationFields = [
    { name: 'name', scope: 'global', type: 'string' },
    { name: 'region', label: 'Region', scope: 'global', type: 'string' },
    { name: 'landmarks', scope: 'global', type: 'array' },
    { name: 'conditions', scope: 'chat', type: 'string' },
];

describe('card template palettes follow the object type', () => {
    it('offers only the shared fields for any object', () => {
        const fields = objectFieldList(null);
        expect(fields.map((f) => f.field)).toEqual(['name', 'image', 'aliases', 'present', 'description', 'introduction_snippet', 'confirmed', 'has_image', 'has_description']);
        expect(fields.every((f) => f.group === 'Any object')).toBe(true);
    });

    it('offers a location its own baseline and runtime fields, and no presence', () => {
        const fields = objectFieldList(location, { fields: locationFields, runtimeFields: [{ name: 'conditions', type: 'string' }, { name: 'mood', type: 'enum' }] });
        const names = fields.map((f) => f.field);
        expect(names).toContain('region');
        expect(names).toContain('landmarks');
        expect(names).toContain('custom.conditions');
        expect(names).toContain('icon.mood');
        expect(names).not.toContain('present');
        expect(names).not.toContain('personality');
        expect(fields.find((f) => f.field === 'region')).toMatchObject({ label: 'Region', group: 'Location' });
        expect(fields.find((f) => f.field === 'landmarks').type).toBe('list');
    });

    it('offers presence for types that have it', () => {
        expect(objectFieldList(creature).map((f) => f.field)).toContain('present');
    });

    it('keeps the character palette, with fields the setting added', () => {
        const fields = objectFieldList({ id: 'character', label: 'Character', hasPresence: true }, { fields: [{ name: 'oath', scope: 'global', type: 'string' }], archivist: true });
        const names = fields.map((f) => f.field);
        expect(names).toContain('personality');
        expect(names).toContain('oath');
        expect(names.some((n) => n.startsWith('archivist.'))).toBe(true);
        expect(names.indexOf('oath')).toBeLessThan(names.indexOf('mood'));
    });

    it('previews a type with a sample that fills every offered field', () => {
        const fields = objectFieldList(location, { fields: locationFields, runtimeFields: [{ name: 'conditions', type: 'string' }] });
        const sample = sampleObject(location, fields);
        expect(sample.name).toBe('Sample Location');
        for (const f of fields.filter((x) => !x.field.startsWith('icon.') && x.field !== 'image')) expect(characterFieldValue(sample, f.field), f.field).not.toBeUndefined();
        expect(COMMON_OBJECT_FIELDS.length).toBeGreaterThan(0);
    });
});

describe('card template object types', () => {
    it('treats templates made before types as character templates', () => {
        expect(templateObjectType({})).toBe('character');
        expect(templateObjectType({ objectType: '' })).toBe('');
        expect(templateObjectType({ objectType: 'item' })).toBe('item');
        expect(templateObjectType({ objectType: 'Bad Type!' })).toBe('');
    });

    it('offers an element the templates for its type and those for any object', () => {
        expect(templateFits({ objectType: 'item' }, 'item')).toBe(true);
        expect(templateFits({ objectType: '' }, 'item')).toBe(true);
        expect(templateFits({ objectType: 'character' }, 'item')).toBe(false);
        expect(templateFits({}, 'location')).toBe(false);
        expect(templateFits({ objectType: 'character' }, null)).toBe(true);
    });
});

describe('card template size', () => {
    it('may be as small as a portrait, unlike a layout panel', async () => {
        const { pickDesign, MIN_PANEL_WIDTH, MIN_CARD_WIDTH } = await import('../src/storage/design.js');
        expect(pickDesign({ width: 40, height: 40 }).width).toBe(MIN_PANEL_WIDTH);
        expect(pickDesign({ width: 40, height: 40 }, { width: MIN_CARD_WIDTH, height: 24 })).toMatchObject({ width: 40, height: 40 });
        expect(pickDesign({ width: 10, height: 10 }, { width: MIN_CARD_WIDTH, height: 24 })).toMatchObject({ width: 24, height: 24 });
    });
});
