// Thin wrapper around the Preset API's activatePreset() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Binds a preset - in ANY namespace, not just this extension's own - to a
// chat. Seeding and recalculation happen inside State Engine. Returns
// true/false. See the State Engine API Reference, "Preset API".
export async function activatePreset(extensionId, chatId, namespace, name) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.activatePreset(extensionId, ensureInstanceId(), chatId, namespace, name);
}
