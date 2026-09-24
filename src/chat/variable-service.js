// Live State Engine variable data for display:
//   - the CATALOG: every preset in every namespace with its variables
//     (for the variable picker and the element Binding field), and
//   - current VALUES for the variable names the active layout shows.
// Plain cache + listeners; src/chat/chat-session.js decides when to
// refresh (chat changes, State Engine's variables-changed event).

import { EXTENSION_ID } from '../constants.js';
import { listAllVariables } from '../api/list-all-variables.js';
import { getVariableValues } from '../api/get-variable-values.js';
import { notify } from '../ui/dialogs.js';

// Emitted by State Engine on SillyTavern's eventSource whenever variable
// values are saved (State Engine API Reference, "Variable Value API").
export const VARIABLES_CHANGED_EVENT = 'state_engine_variables_changed';

let values = new Map();
let watched = [];
let catalog = [];
let refreshToken = 0;
const valueListeners = new Set();
let warned = false;

// One warning per page load if State Engine is too old to have the
// Variable Value API - panels still work, elements just show no values.
function warnUnavailable(err) {
    console.warn('[PrettyPanels] State Engine variable reads failed', err);
    if (warned) return;
    warned = true;
    notify('warning', 'Pretty Panels could not read State Engine variables. Variable elements need a State Engine version with the Variable Value API.');
}

export function currentChatId() {
    try {
        const context = SillyTavern.getContext();
        const id = typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : context.chatId;
        return id || null;
    } catch {
        return null;
    }
}

// { value, def } for a watched name in the current chat, or undefined.
export function getValue(name) {
    return values.get(name);
}

// Sets which names to keep values for, then refreshes them.
export function watchNames(names) {
    watched = [...new Set(names)];
    return refreshValues();
}

export async function refreshValues() {
    const token = ++refreshToken;
    const chatId = currentChatId();
    const next = new Map();
    if (chatId && watched.length > 0) {
        try {
            const read = await getVariableValues(EXTENSION_ID, chatId, watched);
            for (const name of watched) next.set(name, read?.[name]);
        } catch (err) {
            warnUnavailable(err);
        }
    }
    // A newer refresh (e.g. after a chat switch) already started - drop this one.
    if (token !== refreshToken) return;
    values = next;
    for (const listener of valueListeners) listener();
}

export function onValuesChange(listener) {
    valueListeners.add(listener);
    return () => valueListeners.delete(listener);
}

// Re-reads the catalog (with `active` flags for the current chat).
export async function loadCatalog() {
    try {
        catalog = (await listAllVariables(EXTENSION_ID, currentChatId())) ?? [];
    } catch (err) {
        warnUnavailable(err);
        catalog = [];
    }
    return catalog;
}

export function getCatalog() {
    return catalog;
}

// The catalog entry (preset + display def) for a qualified name, or null.
export function findVariable(name) {
    for (const preset of catalog) {
        const def = preset.variables.find((v) => v.name === name);
        if (def) return { preset, def };
    }
    return null;
}
