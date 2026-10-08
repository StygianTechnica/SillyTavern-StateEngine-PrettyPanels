// Thin wrapper around the Role API's listRoles() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Every role of a chat - defined there or requested by an extension - with
// its assigned variable and whether that assignment is usable:
// [{ name, type, label, description, defined, requestedBy, variable, valid, problem }].
// See the State Engine API Reference, "Role API".
export async function listRoles(extensionId, chatId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.listRoles(extensionId, ensureInstanceId(), chatId);
}
