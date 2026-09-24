// Panel registry: persisted panel INSTANCES of the active layout, keyed
// by panel ID, plus the Enabled/Editing Mode flags. Holds plain data
// only - no DOM. The DOM side (src/panels/panel.js) reads from and
// writes back to this registry through panel-manager.js; nothing else
// touches it directly.
//
// Every mutation saves immediately through saveSettingsDebounced() -
// callers never have to remember to persist. See src/storage/store.js
// for the overall schema and src/library/ for layout/template management.

import { getStore, getActiveLayout, save, generateId, MIN_GRID_SIZE, MAX_GRID_SIZE, MAX_Z_INDEX } from '../storage/store.js';
import { pickDesign } from '../storage/design.js';

// Fills any missing fields on a stored record with sane values, so a
// hand-edited or partially-written record can never break rendering.
// Unknown fields are preserved, so a later version's fields survive a
// round-trip through an older one.
function normalize(record) {
    return {
        ...record,
        ...pickDesign(record),
        name: typeof record.name === 'string' && record.name ? record.name : 'Panel',
        locked: record.locked === true,
        zIndex: clampZIndex(record.zIndex),
    };
}

export function clampZIndex(value) {
    return Number.isFinite(value) ? Math.min(MAX_Z_INDEX, Math.max(0, Math.round(value))) : 0;
}

// The highest zIndex in the active layout, or -1 if it has no panels.
export function maxZIndex(excludeId = null) {
    return Object.values(getActiveLayout().panels)
        .filter((p) => p && p.id !== excludeId)
        .reduce((max, p) => Math.max(max, clampZIndex(p.zIndex)), -1);
}

export function listPanels() {
    return Object.values(getActiveLayout().panels)
        .filter((p) => p && typeof p.id === 'string')
        .map(normalize)
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

export function getPanel(id) {
    const record = getActiveLayout().panels[id];
    return record ? normalize(record) : null;
}

// Creates and persists a new panel instance in the active layout.
// `init` may supply any design field, a name and a zIndex; ID is always
// generated here, the name defaults to "Panel N", and the zIndex to just
// above every existing panel.
export function createPanelRecord(init = {}) {
    const layout = getActiveLayout();
    const number = layout.nextPanelNumber++;
    const name = typeof init.name === 'string' && init.name.trim() ? init.name.trim() : `Panel ${number}`;
    const record = normalize({
        ...init,
        id: generateId('pp'),
        name,
        createdAt: Date.now(),
        zIndex: Number.isFinite(init.zIndex) ? init.zIndex : maxZIndex() + 1,
    });
    layout.panels[record.id] = record;
    save();
    return { ...record };
}

// Shallow-merges `patch` into the stored record. `id` and `createdAt`
// are immutable.
export function updatePanelRecord(id, patch) {
    const panels = getActiveLayout().panels;
    const current = panels[id];
    if (!current) return null;
    const { id: _ignoredId, createdAt: _ignoredCreated, ...rest } = patch;
    panels[id] = normalize({ ...current, ...rest });
    save();
    return { ...panels[id] };
}

export function deletePanelRecord(id) {
    const panels = getActiveLayout().panels;
    if (!panels[id]) return false;
    delete panels[id];
    save();
    return true;
}

export function isEnabled() {
    return getStore().enabled !== false;
}

export function setEnabledFlag(enabled) {
    getStore().enabled = enabled === true;
    save();
}

export function isEditingMode() {
    return getStore().editingMode === true;
}

export function setEditingModeFlag(enabled) {
    getStore().editingMode = enabled === true;
    save();
}

// Soft snap-to-grid (src/panels/snap.js): one grid size, shared by the
// layout grid panels snap to and the panel grid elements snap to.
export function getGridSettings() {
    const store = getStore();
    return { snap: store.snapToGrid, size: store.gridSize };
}

export function setGridSettings({ snap, size } = {}) {
    const store = getStore();
    if (typeof snap === 'boolean') store.snapToGrid = snap;
    if (Number.isFinite(size)) store.gridSize = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(size)));
    save();
    return getGridSettings();
}
