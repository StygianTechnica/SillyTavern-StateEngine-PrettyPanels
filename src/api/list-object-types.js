// Thin wrapper around the Object API's listObjectTypes() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// this path (adjust if your State Engine folder is named differently) is
// repeated per-file rather than centralized - each src/api/*.js file wraps
// exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';

// State Engine's object types: [{ id, label, plural, noun, scope, idPrefix, ... }]. No identity needed. See the State Engine API Reference, "Object API".
export async function listObjectTypes() {
    const { stateEngine } = await import(API_PATH);
    return stateEngine.listObjectTypes();
}
