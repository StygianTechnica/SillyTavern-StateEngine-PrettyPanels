// Thin wrapper around the Character API's addCharacterVariant() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Adds a named variant ({ name, overrides }). Returns the character, or null. See the State Engine API Reference, "Character API".
export async function addCharacterVariant(extensionId, chatId, id, variant, options) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.addCharacterVariant(extensionId, ensureInstanceId(), chatId, id, variant, options);
}
