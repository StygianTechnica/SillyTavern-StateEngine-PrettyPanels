// Thin wrapper around the Calendar API's getDateTimeParts() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Resolves a SYNCHRONOUS reader bound to this extension's identity:
// (calendarId, scalarTime) => { year, month, day, hour, minute, second,
// weekdayIndex, weekdayName, weekdayShortName, time: { hour, minute,
// second, fraction }, calendar: { hoursPerDay, minutesPerHour,
// secondsPerMinute, daysPerWeek } }. Throws (at load) when State Engine
// is too old to have getDateTimeParts; the reader lets Calendar API
// errors propagate. See the State Engine API Reference, "Calendar API".
export async function loadDateTimePartsReader(extensionId) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    if (typeof stateEngine.getDateTimeParts !== 'function') throw new Error('State Engine has no getDateTimeParts()');
    const instanceId = ensureInstanceId();
    return (calendarId, scalarTime) => stateEngine.getDateTimeParts(extensionId, instanceId, calendarId, scalarTime);
}
