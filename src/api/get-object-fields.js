// Thin wrapper around the Object API's getObjectFields() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// A setting's field definitions for an object type (its object preset): baseline (scope 'global') then runtime (scope 'chat'). [] when State Engine has none. See the State Engine API Reference, "Object API".
export async function getObjectFields(extensionId, settingId, type) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    if (typeof stateEngine.getObjectFields !== 'function') return [];
    return stateEngine.getObjectFields(extensionId, ensureInstanceId(), settingId, type);
}
