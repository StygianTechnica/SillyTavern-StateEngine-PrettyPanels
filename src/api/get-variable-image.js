// Thin wrapper around the Variable Value API's getVariableImage() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// The image an image / imageList / imageMap variable is showing in a chat
// (the tracker's rules), as a display-safe source string, or null. See
// the State Engine API Reference, "Variable Value API".
export async function getVariableImage(extensionId, chatId, name) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.getVariableImage(extensionId, ensureInstanceId(), chatId, name);
}
