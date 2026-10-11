// State Engine OBJECT variables (State Engine API Reference, "Object API"):
// a story entity's id - a character, a location, a faction... One object is
// { type: 'object', objectType }; a list is { type: 'array', itemType:
// 'object', itemObjectType }. Character cards draw the 'character' ones.
//
// Kept apart from element-model.js so text-format.js (which element-model.js
// imports) can use it too.

export const CHARACTER_OBJECT_TYPE = 'character';

// The object type a variable holds ('character', 'location'...), or null
// for a variable that holds no objects.
export function objectTypeOf(def) {
    if (def?.type === 'object') return def.objectType ?? null;
    if (def?.type === 'array' && def.itemType === 'object') return def.itemObjectType ?? null;
    return null;
}

// A character variable, or a list of characters.
export function isCharacterDefinition(def) {
    return objectTypeOf(def) === CHARACTER_OBJECT_TYPE;
}
