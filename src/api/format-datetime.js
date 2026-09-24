// Thin wrapper around the Calendar API's formatDateTime() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Resolves a SYNCHRONOUS formatter bound to this extension's identity,
// so display code can format datetime values without awaiting per call:
// (calendarId, scalarTime, { style }) => string. The Calendar API throws
// on bad input; the formatter lets that propagate. See the State Engine
// API Reference, "Calendar API".
export async function loadDateTimeFormatter(extensionId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    const instanceId = ensureInstanceId();
    return (calendarId, scalarTime, options) => stateEngine.formatDateTime(extensionId, instanceId, calendarId, scalarTime, options);
}
