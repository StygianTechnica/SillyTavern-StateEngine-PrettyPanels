// Thin wrapper around the Role API's assignRole() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Assigns a fully-qualified variable to role `id` in one chat (null
// clears it). Returns the role's updated entry, or null if refused (wrong
// type, preset not active, unknown role). See the State Engine API
// Reference, "Role API".
export async function assignRole(extensionId, chatId, id, variableName) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.assignRole(extensionId, ensureInstanceId(), chatId, id, variableName);
}
