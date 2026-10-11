// Thin wrapper around the Object API's confirmObject() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Confirms an object as it is (a chat object moves into the setting). See the State Engine API Reference, "Object API".
export async function confirmObject(extensionId, chatId, id, options) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.confirmObject(extensionId, ensureInstanceId(), chatId, id, options);
}
