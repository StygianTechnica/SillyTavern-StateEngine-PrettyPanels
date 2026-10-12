// Leaving the user's persona ({{user}}) out of character lists
// (src/chat/persona.js, character-card.js withoutPersona, Value Formatting
// characterHideUser).

import { isPersonaCharacter } from '../src/chat/persona.js';
import { withoutPersona } from '../src/elements/character-card.js';
import { normalizeFormat } from '../src/elements/text-format.js';

const characters = {
    chr_s: { id: 'chr_s', name: 'Syrvanus Voxaris', aliases: ['Syr'] },
    chr_g: { id: 'chr_g', name: 'A lead gremlin', aliases: [] },
};
const get = (id) => characters[id] ?? null;

describe('the persona among the characters', () => {
    it('is the character with the persona’s name or alias, by words', () => {
        expect(isPersonaCharacter(characters.chr_s, 'syrvanus voxaris')).toBe(true);
        expect(isPersonaCharacter(characters.chr_s, 'Syr')).toBe(true);
        expect(isPersonaCharacter(characters.chr_g, 'Syrvanus Voxaris')).toBe(false);
        expect(isPersonaCharacter(characters.chr_s, '')).toBe(false);
        expect(isPersonaCharacter(null, 'Syr')).toBe(false);
    });

    it('is left out of a list when asked, and only then', () => {
        globalThis.SillyTavern = { getContext: () => ({ name1: 'Syrvanus Voxaris' }) };
        try {
            expect(withoutPersona(['chr_s', 'chr_g', 'chr_x'], get, true)).toEqual(['chr_g', 'chr_x']);
            expect(withoutPersona(['chr_s', 'chr_g'], get, false)).toEqual(['chr_s', 'chr_g']);
        } finally {
            delete globalThis.SillyTavern;
        }
    });

    it('the option is kept in an element’s format (off by default)', () => {
        expect(normalizeFormat({ value: { characterHideUser: true } }).value.characterHideUser).toBe(true);
        expect(normalizeFormat({}).value.characterHideUser).toBe(false);
    });
});
