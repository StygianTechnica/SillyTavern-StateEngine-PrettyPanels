// Thin wrapper around the Object API's listSettings() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Every setting (a world shared by chats), Default first: [{ id, name, autoConfirm, isDefault, counts, objectCount }]. See the State Engine API Reference, "Object API".
export async function listSettings(extensionId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.listSettings(extensionId, ensureInstanceId());
}
