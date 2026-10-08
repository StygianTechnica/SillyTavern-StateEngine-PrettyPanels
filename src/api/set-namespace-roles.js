// Thin wrapper around the Role API's setNamespaceRoles() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Replaces every role in this extension's namespace with `roles`
// ([{ publicName, type, label?, description? }]): roles that stay keep their
// chat assignments, roles left out are deleted. Returns { added, updated,
// removed } (ids), or null if rejected. See the State Engine API Reference,
// "Role API".
export async function setNamespaceRoles(extensionId, roles) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.setNamespaceRoles(extensionId, ensureInstanceId(), roles);
}
