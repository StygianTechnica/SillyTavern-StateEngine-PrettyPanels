// Thin wrapper around the Variable Value API's listAllVariables() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Every preset in every namespace, grouped, each with its variables'
// display definitions. `chatId` (optional) adds `active` per preset. See
// the State Engine API Reference, "Variable Value API".
export async function listAllVariables(extensionId, chatId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.listAllVariables(extensionId, ensureInstanceId(), chatId);
}
