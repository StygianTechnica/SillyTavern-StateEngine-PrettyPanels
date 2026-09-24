// Thin wrapper around the Variable Value API's getVariableValues() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Current values for several fully-qualified variable names in one chat:
// { [name]: { value, def } | undefined }. Any namespace. See the State
// Engine API Reference, "Variable Value API".
export async function getVariableValues(extensionId, chatId, names) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.getVariableValues(extensionId, ensureInstanceId(), chatId, names);
}
