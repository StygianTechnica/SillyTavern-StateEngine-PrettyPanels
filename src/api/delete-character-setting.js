// Thin wrapper around the Character API's deleteCharacterSetting() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Deletes a setting and its characters (not Default). Returns true if deleted. See the State Engine API Reference, "Character API".
export async function deleteCharacterSetting(extensionId, settingId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.deleteCharacterSetting(extensionId, ensureInstanceId(), settingId);
}
