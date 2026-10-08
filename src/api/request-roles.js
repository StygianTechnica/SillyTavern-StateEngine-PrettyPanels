// Thin wrapper around the Role API's requestRoles() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Declares the roles this extension needs: { key, label, chatId, roles:
// [{ name, type, label? }] }. Replaces the earlier request under the same
// key and chat; an empty `roles` removes it. Returns true if anything
// changed, false if not, null if rejected. See the State Engine API
// Reference, "Role API".
export async function requestRoles(extensionId, request) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.requestRoles(extensionId, ensureInstanceId(), request);
}
