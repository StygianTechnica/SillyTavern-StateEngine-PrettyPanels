// Thin wrapper around the Variable Value API's setVariableValue() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Writes a value for one of THIS extension's own variables in one chat.
// `ref: { namespace, presetName, variableName }`. Returns true/false. See
// the State Engine API Reference, "Variable Value API".
export async function setVariableValue(extensionId, chatId, ref, value) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    return stateEngine.setVariableValue(extensionId, ensureInstanceId(), chatId, ref, value);
}
