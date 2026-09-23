// Root of everything Pretty Panels persists, stored in SillyTavern's
// extensionSettings (global, not per-chat). Owns the schema, the
// migration from older schemas, and the library-change signal the
// drawer listens to. Nothing outside src/panels/panel-registry.js and
// src/library/ touches the store directly.
//
// Schema v2:
//   {
//     version, enabled, editingMode,
//     activeLayoutId,
//     layouts:   { [id]: { id, name, createdAt, nextPanelNumber, backgrounds, panels: { [id]: instance } } },
//     templates: { [id]: { id, name, createdAt, updatedAt, ...design } },
//   }
//
// Layouts and templates hold DESIGN data only (see design.js). Variable
// bindings, visibility rules and theme overrides are chat-scoped and
// never live here.

const SETTINGS_KEY = 'prettyPanels';
const SCHEMA_VERSION = 2;
const DEFAULT_LAYOUT_NAME = 'Default';

const libraryListeners = new Set();

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function generateId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Returns `name`, or `name (2)`, `name (3)`... - whichever is not in `taken`.
export function uniqueName(name, taken) {
    const names = new Set(taken);
    if (!names.has(name)) return name;
    for (let n = 2; ; n++) {
        const candidate = `${name} (${n})`;
        if (!names.has(candidate)) return candidate;
    }
}

export function newLayoutRecord(name) {
    return {
        id: generateId('ppl'),
        name,
        createdAt: Date.now(),
        nextPanelNumber: 1,
        backgrounds: [],
        panels: {},
    };
}

// v1 kept one flat set of panels; it becomes the "Default" layout.
function migrate(store) {
    if (isObject(store.panels) && !isObject(store.layouts)) {
        const layout = newLayoutRecord(DEFAULT_LAYOUT_NAME);
        layout.panels = store.panels;
        if (Number.isFinite(store.nextPanelNumber)) layout.nextPanelNumber = store.nextPanelNumber;
        store.layouts = { [layout.id]: layout };
        store.activeLayoutId = layout.id;
    }
    delete store.panels;
    delete store.nextPanelNumber;
    store.version = SCHEMA_VERSION;
}

export function save() {
    SillyTavern.getContext().saveSettingsDebounced();
}

// Returns the live store, creating, migrating and repairing it as
// needed so callers can always rely on: at least one layout, a valid
// activeLayoutId, and a templates map. Unknown fields are preserved.
export function getStore() {
    const all = SillyTavern.getContext().extensionSettings;
    let changed = false;

    if (!isObject(all[SETTINGS_KEY])) {
        all[SETTINGS_KEY] = { version: SCHEMA_VERSION };
        changed = true;
    }
    const store = all[SETTINGS_KEY];

    if ((store.version ?? 1) < SCHEMA_VERSION) {
        migrate(store);
        changed = true;
    }
    if (typeof store.enabled !== 'boolean') {
        store.enabled = store.enabled !== false;
        changed = true;
    }
    if (typeof store.editingMode !== 'boolean') {
        store.editingMode = store.editingMode === true;
        changed = true;
    }
    if (!isObject(store.layouts)) {
        store.layouts = {};
        changed = true;
    }
    if (!isObject(store.templates)) {
        store.templates = {};
        changed = true;
    }

    for (const [id, layout] of Object.entries(store.layouts)) {
        if (!isObject(layout)) {
            delete store.layouts[id];
            changed = true;
            continue;
        }
        if (layout.id !== id) { layout.id = id; changed = true; }
        if (typeof layout.name !== 'string' || !layout.name) { layout.name = 'Layout'; changed = true; }
        if (!isObject(layout.panels)) { layout.panels = {}; changed = true; }
        if (!Array.isArray(layout.backgrounds)) { layout.backgrounds = []; changed = true; }
        if (!Number.isFinite(layout.nextPanelNumber)) { layout.nextPanelNumber = 1; changed = true; }
    }

    if (Object.keys(store.layouts).length === 0) {
        const layout = newLayoutRecord(DEFAULT_LAYOUT_NAME);
        store.layouts[layout.id] = layout;
        changed = true;
    }
    if (!store.layouts[store.activeLayoutId]) {
        store.activeLayoutId = sortedLayouts(store)[0].id;
        changed = true;
    }

    if (changed) save();
    return store;
}

export function sortedLayouts(store = getStore()) {
    return Object.values(store.layouts).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function getActiveLayout() {
    const store = getStore();
    return store.layouts[store.activeLayoutId];
}

// Layout Library / Panel Library contents changed (added, renamed,
// removed, active layout switched). Panel instance edits do NOT fire
// this - they are not library metadata.
export function emitLibraryChange() {
    for (const listener of libraryListeners) listener();
}

export function onLibraryChange(listener) {
    libraryListeners.add(listener);
    return () => libraryListeners.delete(listener);
}
