// The user's persona ({{user}}) among the chat's characters: a character
// object is the persona when its name or an alias is the persona's name
// (by words - archivist-link.js nameKey - so "Syrvanus" and "syrvanus"
// match). Used to leave the persona out of character lists (Value
// Formatting > "Leave out your persona").

import { nameKey } from './archivist-link.js';

export function personaName() {
    try {
        return SillyTavern.getContext().name1 ?? '';
    } catch {
        return '';
    }
}

// Whether `character` ({ name, aliases }) is the persona named `name`
// (default: the current persona).
export function isPersonaCharacter(character, name = personaName()) {
    const key = nameKey(name);
    if (!character || !key) return false;
    return [character.name, ...(Array.isArray(character.aliases) ? character.aliases : [])].some((n) => nameKey(n) === key);
}
