import { describe, it, expect } from 'vitest';
import { relationsOfObject, characterFieldValue, characterFieldDef, characterFieldList, SAMPLE_CHARACTER, characterEntry, objectRefsOf } from '../src/elements/character-fields.js';
import { characterInsights } from '../src/chat/archivist-link.js';
import { drawsOnCard, cardTemplateId } from '../src/elements/element-model.js';
import { isObjectCardDefinition } from '../src/elements/object-defs.js';

const remus = {
    id: 'chr_remus', name: 'Remus',
    authoredRelations: [{ otherId: 'chr_varyn', otherName: 'Varyn', kind: 'friend', note: '', direction: 'out' }],
    archivist: {
        relationships: [
            { other: { id: 'chr_varyn', name: 'Varyn' }, type: 'rival', polarity: -2, polarity_label: 'antagonistic', view: 'theirs' },
            { other: { id: 'chr_niamh', name: 'Niamh' }, type: 'ally', polarity: 1, polarity_label: 'friendly', view: 'theirs' },
            { other: { id: null, name: 'The Death God' }, type: 'enemy', polarity: -3, polarity_label: 'hostile', view: 'about' },
        ],
    },
};

describe('relationships on a card', () => {
    it('put the user\'s first, then the story\'s for the other pairs', () => {
        expect(relationsOfObject(remus).map((r) => `${r.name}:${r.kind}:${r.source}`)).toEqual(['Varyn:friend:yours', 'Niamh:ally:story', 'The Death God:enemy:story']);
    });

    it('offer lines, names, friends, foes, a count and the people', () => {
        expect(characterFieldValue(remus, 'relations.list')).toEqual(['Varyn - friend', 'Niamh - ally (friendly)', 'The Death God - enemy (hostile)']);
        expect(characterFieldValue(remus, 'relations.names')).toEqual(['Varyn', 'Niamh', 'The Death God']);
        expect(characterFieldValue(remus, 'relations.friends')).toEqual(['Varyn - friend', 'Niamh - ally (friendly)']);
        expect(characterFieldValue(remus, 'relations.foes')).toEqual(['The Death God - enemy (hostile)']);
        expect(characterFieldValue(remus, 'relations.count')).toBe(3);
        // Only those that are objects can be drawn as cards.
        expect(characterFieldValue(remus, 'relations.people')).toEqual(['chr_varyn', 'chr_niamh']);
        expect(characterFieldValue({ name: 'Nobody' }, 'relations.list')).toBeUndefined();
    });

    it('draw the related people as cards, and are in the palette', () => {
        expect(isObjectCardDefinition(characterFieldDef('relations.people'))).toBe(true);
        expect(characterFieldDef('relations.list').type).toBe('list');
        expect(characterFieldList([]).filter((f) => f.group === 'Relationships').map((f) => f.field)).toContain('relations.people');
        expect(characterFieldValue(SAMPLE_CHARACTER, 'relations.list')).toEqual(['Sample Friend - ally', 'Sample Rival - rival (wary)']);
    });

    it('come from every relationship Archivist compiled for the character', () => {
        const view = {
            relationships: [
                { from: { id: 'chr_remus', name: 'Remus' }, to: { id: 'chr_niamh', name: 'Niamh' }, type: 'ally', polarity: 1, polarity_label: 'friendly' },
                { from: { id: 'chr_niamh', name: 'Niamh' }, to: { id: 'chr_remus', name: 'Remus' }, type: 'host', polarity: 2 },
                { from: { id: 'chr_varyn', name: 'Varyn' }, to: { id: 'chr_remus', name: 'Remus' }, type: 'rival', polarity: -1 },
            ],
        };
        const rels = characterInsights(view, { id: 'chr_remus', name: 'Remus' }, null).relationships;
        expect(rels.map((r) => `${r.other.name}:${r.type}:${r.view}`)).toEqual(['Niamh:ally:theirs', 'Varyn:rival:about']);
    });
});

describe('cards inside cards', () => {
    const people = { type: 'character', binding: { char: 'relations.people' }, character: { templateId: 'ppc_x' } };
    it('are only a card\'s own object\'s people', () => {
        expect(drawsOnCard(people)).toBe(true);
        expect(drawsOnCard({ type: 'character', binding: { variable: 'se__scene_characters' } })).toBe(false);
        expect(drawsOnCard({ type: 'text', binding: { char: 'name' } })).toBe(true);
    });
    it('use their own template one level deep, never in a loop', () => {
        // On a panel, and on one card: its own template.
        expect(cardTemplateId(people, [])).toBe('ppc_x');
        expect(cardTemplateId(people, ['ppc_outer'])).toBe('ppc_x');
        // Never a template inside itself, and never deeper than two.
        expect(cardTemplateId(people, ['ppc_x'])).toBeNull();
        expect(cardTemplateId(people, ['ppc_a', 'ppc_b'])).toBeNull();
    });
});

describe('object fields on a card', () => {
    const remus = { id: 'chr_remus', name: 'Remus', runtime: { values: { factions: ['fac_redhaven', 'fac_wardens'], mood: 'Calm' } }, owner: 'chr_x' };
    it('keep their ids, marked as the objects they are, so a card element can draw them', () => {
        expect(characterEntry(remus, 'factions')).toEqual({ value: ['fac_redhaven', 'fac_wardens'], def: expect.objectContaining({ type: 'array', itemType: 'object', itemObjectType: 'faction' }) });
        expect(isObjectCardDefinition(characterEntry(remus, 'factions').def)).toBe(true);
        expect(objectRefsOf(remus, 'faction')).toEqual({ ids: ['fac_redhaven', 'fac_wardens'], list: true, type: 'faction' });
        expect(characterEntry(remus, 'owner').def).toMatchObject({ type: 'object', objectType: 'character' });
    });
    it('leave other fields as they were', () => {
        expect(objectRefsOf(remus, 'mood')).toBeNull();
        expect(characterEntry(remus, 'mood').value).toBe('Calm');
        expect(characterEntry(remus, 'relations.list')).toBeUndefined();
    });
});
