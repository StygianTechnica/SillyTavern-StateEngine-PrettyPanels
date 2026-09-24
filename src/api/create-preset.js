// Thin wrapper around the Preset API's createPreset() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Creates a preset in this extension's namespace. Returns the preset, or
// null on a duplicate name. See the State Engine API Reference, "Preset API".
export async function createPreset(extensionId, def) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.createPreset(extensionId, ensureInstanceId(), def);
}
