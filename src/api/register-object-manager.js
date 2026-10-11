// Thin wrapper around the Object API's registerObjectManager() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Registers the function that opens this extension's object manager window (State Engine's "Manage objects" button and "new ... detected" notifications call it). See the State Engine API Reference, "Object API".
export async function registerObjectManager(extensionId, opener) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.registerObjectManager(extensionId, ensureInstanceId(), opener);
}
