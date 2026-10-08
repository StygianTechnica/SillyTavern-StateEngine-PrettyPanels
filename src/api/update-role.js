// Thin wrapper around the Role API's updateRole() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Changes one of this extension's roles: { publicName?, type?, label?,
// description? }. A new publicName gives it a new id and every chat's
// assignment follows. Returns the definition, or null if rejected. See the
// State Engine API Reference, "Role API".
export async function updateRole(extensionId, id, patch) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.updateRole(extensionId, ensureInstanceId(), id, patch);
}
