// Panel registry: the single source of truth for every panel's persisted
// state, keyed by panel ID. Holds plain data only - no DOM. The DOM side
// (src/panels/panel.js) reads from and writes back to this registry
// through panel-manager.js; nothing else touches it directly.
//
// Stored in SillyTavern's extensionSettings (global, not per-chat) so a
// HUD layout survives refresh and chat switches alike. Every mutation
// saves immediately through saveSettingsDebounced() - callers never have
// to remember to persist.

const SETTINGS_KEY = 'prettyPanels';
const SCHEMA_VERSION = 1;

export const DEFAULT_PANEL_WIDTH = 280;
export const DEFAULT_PANEL_HEIGHT = 180;
export const MIN_PANEL_WIDTH = 80;
export const MIN_PANEL_HEIGHT = 48;

function defaultSettings() {
    return {
        version: SCHEMA_VERSION,
        editingMode: false,
        nextPanelNumber: 1,
        panels: {},
    };
}

function getContext() {
    return SillyTavern.getContext();
}

// Returns the live settings object, creating/backfilling it on first
// access. Unknown fields on stored panels are preserved untouched, so a
// later version's fields survive a round-trip through an older one.
function getStore() {
    const all = getContext().extensionSettings;
    if (!all[SETTINGS_KEY] || typeof all[SETTINGS_KEY] !== 'object') {
        all[SETTINGS_KEY] = defaultSettings();
    }
    const store = all[SETTINGS_KEY];
    const defaults = defaultSettings();
    for (const key of Object.keys(defaults)) {
        if (store[key] === undefined) store[key] = defaults[key];
    }
    if (!store.panels || typeof store.panels !== 'object') store.panels = {};
    return store;
}

function save() {
    getContext().saveSettingsDebounced();
}

function generateId() {
    return `pp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Fills any missing fields on a stored record with sane values, so a
// hand-edited or partially-written record can never break rendering.
function normalize(record) {
    return {
        ...record,
        name: typeof record.name === 'string' && record.name ? record.name : 'Panel',
        x: Number.isFinite(record.x) ? record.x : 0,
        y: Number.isFinite(record.y) ? record.y : 0,
        width: Math.max(MIN_PANEL_WIDTH, Number.isFinite(record.width) ? record.width : DEFAULT_PANEL_WIDTH),
        height: Math.max(MIN_PANEL_HEIGHT, Number.isFinite(record.height) ? record.height : DEFAULT_PANEL_HEIGHT),
        locked: record.locked === true,
    };
}

export function listPanels() {
    const store = getStore();
    return Object.values(store.panels)
        .filter((p) => p && typeof p.id === 'string')
        .map(normalize)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function getPanel(id) {
    const record = getStore().panels[id];
    return record ? normalize(record) : null;
}

// Creates and persists a new panel record. `init` may override any
// geometry field; name and ID are always generated here.
export function createPanelRecord(init = {}) {
    const store = getStore();
    const number = store.nextPanelNumber++;
    const record = normalize({
        ...init,
        id: generateId(),
        name: `Panel ${number}`,
        createdAt: Date.now(),
    });
    store.panels[record.id] = record;
    save();
    return { ...record };
}

// Shallow-merges `patch` into the stored record. `id` and `createdAt`
// are immutable.
export function updatePanelRecord(id, patch) {
    const store = getStore();
    const current = store.panels[id];
    if (!current) return null;
    const { id: _ignoredId, createdAt: _ignoredCreated, ...rest } = patch;
    store.panels[id] = normalize({ ...current, ...rest });
    save();
    return { ...store.panels[id] };
}

export function deletePanelRecord(id) {
    const store = getStore();
    if (!store.panels[id]) return false;
    delete store.panels[id];
    save();
    return true;
}

export function isEditingMode() {
    return getStore().editingMode === true;
}

export function setEditingModeFlag(enabled) {
    getStore().editingMode = enabled === true;
    save();
}
