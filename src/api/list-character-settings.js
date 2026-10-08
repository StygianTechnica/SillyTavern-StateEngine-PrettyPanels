// Thin wrapper around the Character API's listCharacterSettings() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Every character setting (Default first): [{ id, name, autoPromote, isDefault, characterCount, createdAt }]. See the State Engine API Reference, "Character API".
export async function listCharacterSettings(extensionId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.listCharacterSettings(extensionId, ensureInstanceId());
}
