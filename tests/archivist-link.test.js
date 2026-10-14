// Character cards reading what the Archivist extension compiled about each
// character (src/chat/archivist-link.js, the "archivist.*" character fields).

import { characterInsights, withArchivistInsights } from '../src/chat/archivist-link.js';
import { characterFieldValue, characterEntry, characterFieldList, SAMPLE_CHARACTER } from '../src/elements/character-fields.js';
import { normalizeWidgets } from '../src/elements/element-model.js';

const lucian = { id: 'chr_lucian', name: 'Lucian', aliases: ['Luc'] };
const gavin = { id: 'chr_gavin', name: 'Gavin', aliases: [] };
const view = {
    character_profiles: [{
        entity_id: 'chr_lucian', name: 'Lucian', summary: 'A trainer keeping the gym afloat.', traits: ['diligent'], habits: ['early runs'], stressors: ['rent'], motivations: ['keep the gym open'],
        arc: 'From drifting to driven.', emotional_state: 'anxious',
    }],
    relationships: [
        { from: { id: 'chr_lucian', name: 'Lucian' }, to: { id: null, name: 'Sam' }, type: 'mentor', polarity: 2, polarity_label: 'close', intensity: 'high', trend: 'warming', text: 'Lucian looks out for Sam.' },
        { from: { id: 'chr_lucian', name: 'Lucian' }, to: { id: 'chr_gavin', name: 'Gavin' }, type: 'rival', polarity: -1, polarity_label: 'wary', intensity: 'medium', trend: '', text: '' },
    ],
    threads: [
        { title: 'The manager job', status: 'active', involved: [{ id: 'chr_lucian', name: 'Lucian' }] },
        { title: 'Old feud', status: 'resolved', involved: [{ id: 'chr_lucian', name: 'Lucian' }] },
    ],
    world: { secret: [{ name: 'The debt', known_by: [{ id: null, name: 'Luc' }] }] },
};

describe('characterInsights', () => {
    it('gathers a character\'s profile, its relationship toward the persona, open threads and secrets', () => {
        expect(characterInsights(view, lucian, { id: null, name: 'Sam' })).toEqual({
            summary: 'A trainer keeping the gym afloat.', traits: ['diligent'], habits: ['early runs'], stressors: ['rent'], motivations: ['keep the gym open'],
            arc: 'From drifting to driven.', feeling: 'anxious',
            relationship: { type: 'mentor', polarity: 2, polarity_label: 'close', intensity: 'high', trend: 'warming', text: 'Lucian looks out for Sam.', view: 'theirs' },
            threads: ['The manager job'],
            secrets: ['The debt'],
        });
    });

    it('matches the persona as a character object by id', () => {
        expect(characterInsights(view, lucian, gavin).relationship).toMatchObject({ type: 'rival', polarity: -1 });
    });

    it('falls back to the persona view of the character, matching names loosely (the reported gremlin)', () => {
        const gremlin = { id: 'chr_g', name: 'A lead gremlin', aliases: [] };
        const syrvanus = { id: 'chr_s', name: 'Syrvanus Voxaris', aliases: [] };
        const compiled = { relationships: [{ from: { id: 'chr_s', name: 'Syrvanus Voxaris' }, to: { id: null, name: 'gremlin (lead)' }, type: 'ally', polarity: 2, polarity_label: 'close', intensity: 'medium' }] };
        expect(characterInsights(compiled, gremlin, syrvanus).relationship).toMatchObject({ type: 'ally', polarity: 2, view: 'yours' });
        const withInsights = { ...gremlin, archivist: characterInsights(compiled, gremlin, syrvanus) };
        expect(characterFieldValue(withInsights, 'archivist.relationship_view')).toBe('your view of them');
        expect(characterFieldValue(withInsights, 'archivist.relationship_type')).toBe('ally');
    });

    it('is null when the view says nothing about the character', () => {
        expect(characterInsights(view, { id: 'chr_x', name: 'Nobody' }, { name: 'Sam' })).toBeNull();
        expect(characterInsights(null, lucian, { name: 'Sam' })).toBeNull();
    });
});

describe('withArchivistInsights', () => {
    // Node test environment: a bare `window` stands in for the page's.
    beforeEach(() => {
        globalThis.window = {};
    });
    afterEach(() => {
        delete globalThis.window;
        delete globalThis.SillyTavern;
    });

    it('attaches insights from Archivist\'s compiled view, relationships toward the user\'s persona', async () => {
        globalThis.SillyTavern = { getContext: () => ({ name1: 'Gavin' }) };
        window.StateEngineArchivist = { getCompiledMemory: vi.fn(async () => view) };
        const out = await withArchivistInsights('chat-1', new Map([[lucian.id, lucian], [gavin.id, gavin]]));
        expect(window.StateEngineArchivist.getCompiledMemory).toHaveBeenCalledWith('chat-1');
        expect(out.get('chr_lucian').archivist.relationship.type).toBe('rival');
        expect(out.get('chr_gavin').archivist).toBeUndefined();
    });

    it('leaves characters alone without Archivist', async () => {
        const characters = new Map([[lucian.id, lucian]]);
        expect(await withArchivistInsights('chat-1', characters)).toBe(characters);
    });
});

describe('archivist character fields', () => {
    const withInsights = { ...lucian, archivist: characterInsights(view, lucian, { name: 'Sam' }) };

    it('read the insights', () => {
        expect(characterFieldValue(withInsights, 'archivist.traits')).toEqual(['diligent']);
        expect(characterFieldValue(withInsights, 'archivist.relationship_type')).toBe('mentor');
        expect(characterFieldValue(withInsights, 'archivist.relationship_polarity')).toBe('close');
        expect(characterFieldValue(withInsights, 'archivist.relationship_score')).toBe(2);
        expect(characterFieldValue(withInsights, 'archivist.relationship_trend')).toBe('warming');
        expect(characterEntry(withInsights, 'archivist.threads')).toMatchObject({ value: ['The manager job'], def: { type: 'list', label: 'Open story threads' } });
    });

    it('have no value without insights', () => {
        expect(characterFieldValue(lucian, 'archivist.traits')).toBeUndefined();
        expect(characterFieldValue({ ...withInsights, archivist: { ...withInsights.archivist, relationship: null } }, 'archivist.relationship_type')).toBeUndefined();
    });

    it('are offered in the palette only with Archivist installed', () => {
        expect(characterFieldList([]).some((f) => f.field.startsWith('archivist.'))).toBe(false);
        const fields = characterFieldList([], { archivist: true }).filter((f) => f.group === 'Archivist (memory)').map((f) => f.field);
        expect(fields).toEqual(expect.arrayContaining(['archivist.traits', 'archivist.relationship_type', 'archivist.relationship_intensity', 'archivist.secrets']));
        for (const field of fields) expect(characterFieldValue(SAMPLE_CHARACTER, field), field).not.toBeUndefined();
    });
});

describe('a template element bound to an archivist field', () => {
    it('keeps its binding when saved (it used to be dropped to no binding)', () => {
        const [element] = normalizeWidgets([{ type: 'text', binding: { char: 'archivist.relationship_type' } }]);
        expect(element.binding).toEqual({ char: 'archivist.relationship_type' });
        const [other] = normalizeWidgets([{ type: 'text', binding: { char: 'archivist.Bad Name' } }]);
        expect(other.binding).toBeNull();
    });
});
