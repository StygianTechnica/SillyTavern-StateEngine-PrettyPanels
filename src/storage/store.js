// Root of everything Pretty Panels persists, stored in SillyTavern's
// extensionSettings (global, not per-chat). Owns the schema, the
// migration from older schemas, and the library-change signal the
// drawer listens to. Nothing outside src/panels/panel-registry.js and
// src/library/ touches the store directly.
//
// Schema v2:
//   {
//     version, enabled, editingMode,
//     snapToGrid, gridSize, showGrid,
//     toolbar: { x, y, collapsed },   the Layout Tools toolbar
//     activeLayoutId,     the layout on screen (or, while a chat has not
//                         chosen one, the last one edited - see
//                         src/chat/chat-session.js). There is no default
//                         layout: a chat that has not chosen one shows none.
//     layouts:   { [id]: { id, name, createdAt, nextPanelNumber, backgrounds, panels: { [id]: instance } } },
//                instance.zIndex: stacking order within the layout, 0..MAX_Z_INDEX
//                layout.groups: { [id]: { id, panelIds: [...] } } - panels that move
//                together; a panel is in at most one group, a group has 2+ panels
//                layout.roles: [publicName] - the State Engine roles the layout
//                carries (src/library/role-library.js)
//     roles:     { [publicName]: { type, label, description } } - Pretty Panels'
//                State Engine roles ("prettyPanels__<publicName>"), shared by
//                every layout that carries them
//     templates: { [id]: { id, name, createdAt, updatedAt, ...design } },
//     characterTemplates: { [id]: { id, name, createdAt, updatedAt, ...design, roles } } -
//                character templates (src/library/character-template-library.js):
//                panels drawn once per character inside a Character element;
//                they KEEP their bindings (character fields, variables, roles)
//     userFonts: { [font_id]: sanitized user font record } - see
//                src/fonts/font-registry.js; never a raw font file
//     atmosphere: { enabled, scale } - atmosphere's global settings; each
//                layout keeps its own effect layers in layout.atmosphere
//                (src/atmosphere/atmosphere-model.js)
//   }
//
// Layouts hold design data plus their elements' variable bindings - a
// layout is what a chat chooses, so it carries what it displays.
// Templates hold design data only: bindings are stripped (design.js).

import { NAMESPACE } from '../constants.js';
import { normalizeWidgets, parseRoleId, roleTypeForElement } from '../elements/element-model.js';

const SETTINGS_KEY = 'prettyPanels';
const SCHEMA_VERSION = 2;
// The layout created when the library is empty (it always holds one).
const FIRST_LAYOUT_NAME = 'My Layout';
export const DEFAULT_GRID_SIZE = 8;
export const MIN_GRID_SIZE = 2;
export const MAX_GRID_SIZE = 64;
// Panel stacking order within a layout. Kept small so panels always stay
// below SillyTavern's own popups (see panel-manager.js BASE_Z_INDEX).
export const MAX_Z_INDEX = 99;

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
        roles: [],
    };
}

// v1 kept one flat set of panels; it becomes the first layout.
function migrate(store) {
    if (isObject(store.panels) && !isObject(store.layouts)) {
        const layout = newLayoutRecord(FIRST_LAYOUT_NAME);
        layout.panels = store.panels;
        if (Number.isFinite(store.nextPanelNumber)) layout.nextPanelNumber = store.nextPanelNumber;
        store.layouts = { [layout.id]: layout };
        store.activeLayoutId = layout.id;
    }
    delete store.panels;
    delete store.nextPanelNumber;
    store.version = SCHEMA_VERSION;
}

// Role bindings from before role namespaces (a bare name, or the older
// free-text Role tag) normalize to this extension's layout roles
// (element-model.js); here the layout gains them and the registry their
// definitions, typed by the element (number for bars and gauges, date for a
// clock, any for text). Returns true if anything changed.
function migrateRoleBindings(store, layout) {
    let changed = false;
    for (const panel of Object.values(layout.panels)) {
        if (!Array.isArray(panel?.widgets)) continue;
        panel.widgets.forEach((widget, i) => {
            if (!widget || typeof widget !== 'object') return;
            const legacy = typeof widget.role === 'string' || (widget.binding?.role && !parseRoleId(widget.binding.role));
            const role = parseRoleId(normalizeWidgets([widget])[0]?.binding?.role);
            if (legacy) {
                const { role: _tag, ...rest } = widget;
                panel.widgets[i] = { ...rest, binding: normalizeWidgets([widget])[0]?.binding ?? null };
                changed = true;
            }
            if (!role || role.namespace !== NAMESPACE) return;
            if (!store.roles[role.publicName]) {
                store.roles[role.publicName] = { type: roleTypeForElement(widget.type), label: '', description: '' };
                changed = true;
            }
            if (!layout.roles.includes(role.publicName)) {
                layout.roles.push(role.publicName);
                changed = true;
            }
        });
    }
    return changed;
}

// Panel Styling's "Opacity" was stored as backgroundOpacity before it
// became panelOpacity - same meaning, renamed.
function migratePanelStyles(layout) {
    let changed = false;
    for (const panel of Object.values(layout.panels)) {
        const style = isObject(panel) ? panel.style : null;
        if (isObject(style) && style.backgroundOpacity !== undefined) {
            if (style.panelOpacity === undefined) style.panelOpacity = style.backgroundOpacity;
            delete style.backgroundOpacity;
            changed = true;
        }
    }
    return changed;
}

// Panels saved before zIndex existed get one from their creation order,
// above every panel that already has one - so an old layout keeps the
// stacking it had (newest on top).
function assignMissingZIndexes(layout) {
    const panels = Object.values(layout.panels).filter((p) => isObject(p));
    const missing = panels
        .filter((p) => !Number.isInteger(p.zIndex))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    if (missing.length === 0) return false;
    let next = panels.reduce((max, p) => (Number.isInteger(p.zIndex) ? Math.max(max, p.zIndex + 1) : max), 0);
    for (const panel of missing) panel.zIndex = Math.min(MAX_Z_INDEX, next++);
    return true;
}

// Keeps groups consistent with the panels that exist: unknown panels are
// dropped, a panel stays in only its first group, and a group left with
// fewer than two panels disappears.
function repairGroups(layout) {
    let changed = false;
    if (!isObject(layout.groups)) {
        layout.groups = {};
        changed = true;
    }
    const seen = new Set();
    for (const [id, group] of Object.entries(layout.groups)) {
        const ids = Array.isArray(group?.panelIds) ? group.panelIds : [];
        const kept = [...new Set(ids)].filter((pid) => layout.panels[pid] && !seen.has(pid));
        if (kept.length < 2) {
            delete layout.groups[id];
            changed = true;
            continue;
        }
        kept.forEach((pid) => seen.add(pid));
        if (group.id !== id || kept.length !== ids.length) {
            layout.groups[id] = { ...group, id, panelIds: kept };
            changed = true;
        }
    }
    return changed;
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
    if (typeof store.snapToGrid !== 'boolean') {
        store.snapToGrid = store.snapToGrid !== false;
        changed = true;
    }
    if (!Number.isInteger(store.gridSize) || store.gridSize < MIN_GRID_SIZE || store.gridSize > MAX_GRID_SIZE) {
        store.gridSize = DEFAULT_GRID_SIZE;
        changed = true;
    }
    if (typeof store.showGrid !== 'boolean') {
        store.showGrid = false;
        changed = true;
    }
    if (!isObject(store.toolbar)) {
        store.toolbar = { x: null, y: null, collapsed: false };
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
    if (!isObject(store.characterTemplates)) {
        store.characterTemplates = {};
        changed = true;
    }
    if (!isObject(store.roles)) {
        store.roles = {};
        changed = true;
    }
    for (const [name, def] of Object.entries(store.roles)) {
        if (!isObject(def) || typeof def.type !== 'string') {
            delete store.roles[name];
            changed = true;
        }
    }
    if (!isObject(store.userFonts)) {
        store.userFonts = {};
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
        if (assignMissingZIndexes(layout)) changed = true;
        if (repairGroups(layout)) changed = true;
        if (migratePanelStyles(layout)) changed = true;
        if (!Array.isArray(layout.roles)) { layout.roles = []; changed = true; }
        if (migrateRoleBindings(store, layout)) changed = true;
    }

    if (Object.keys(store.layouts).length === 0) {
        const layout = newLayoutRecord(FIRST_LAYOUT_NAME);
        store.layouts[layout.id] = layout;
        changed = true;
    }
// The default layout is gone (a chat that has not chosen a layout shows
    // none); a stored default id is dropped.
    if ('defaultLayoutId' in store) {
        delete store.defaultLayoutId;
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
