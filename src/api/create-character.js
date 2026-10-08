// Thin wrapper around the Character API's createCharacter() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Creates a canonical (confirmed) character in a setting. Returns it, or null. See the State Engine API Reference, "Character API".
export async function createCharacter(extensionId, settingId, data) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.createCharacter(extensionId, ensureInstanceId(), settingId, data);
}
