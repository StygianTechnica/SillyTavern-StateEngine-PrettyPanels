// Thin wrapper around the Role API's getRoleCandidates() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// The chat's existing variables that could fulfil role `id`:
// [{ name, label, type }]. See the State Engine API Reference, "Role API".
export async function getRoleCandidates(extensionId, chatId, id) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.getRoleCandidates(extensionId, ensureInstanceId(), chatId, id);
}
