// Thin wrapper around the Variable API's listVariables() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Every variable definition in one of this extension's own presets. See
// the State Engine API Reference, "Variable API".
export async function listVariables(extensionId, namespace, presetName) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.listVariables(extensionId, ensureInstanceId(), namespace, presetName);
}
