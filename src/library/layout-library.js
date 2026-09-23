// Layout Library: global HUD layouts, each a named set of panel
// instances plus layout-level background layers. Exactly one layout is
// active; only the active one is shown on screen and edited. Switching
// or deleting the active layout must go through panel-manager.js
// (switchLayout/removeLayout) so the on-screen panels follow.
//
// Layouts store design data only (see src/storage/design.js) - bindings,
// visibility rules and theme overrides stay chat-scoped.

import {
    getStore,
    save,
    generateId,
    newLayoutRecord,
    sortedLayouts,
    uniqueName,
    emitLibraryChange,
    clone,
} from '../storage/store.js';
import { pickDesign } from '../storage/design.js';
import { KIND, makePayload } from './format.js';

function layoutNames(store) {
    return Object.values(store.layouts).map((l) => l.name);
}

// The portable part of one panel instance.
function instanceData(source) {
    return {
        name: typeof source?.name === 'string' && source.name ? source.name : 'Panel',
        locked: source?.locked === true,
        ...pickDesign(source ?? {}),
    };
}

function sortedInstances(layout) {
    return Object.values(layout.panels)
        .filter((p) => p && typeof p.id === 'string')
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

// Adds a new layout built from portable instance data. Every instance
// gets a fresh ID. Does not change which layout is active.
function addLayout(name, { backgrounds = [], instances = [], nextPanelNumber = 1 } = {}) {
    const store = getStore();
    const layout = newLayoutRecord(uniqueName(name, layoutNames(store)));
    layout.backgrounds = Array.isArray(backgrounds) ? clone(backgrounds) : [];
    const now = Date.now();
    instances.forEach((source, i) => {
        const id = generateId('pp');
        layout.panels[id] = { id, createdAt: now + i, ...instanceData(source) };
    });
    layout.nextPanelNumber = Math.max(instances.length + 1, Number.isFinite(nextPanelNumber) ? nextPanelNumber : 1);
    store.layouts[layout.id] = layout;
    save();
    emitLibraryChange();
    return layout.id;
}

export function listLayouts() {
    return sortedLayouts().map((l) => ({
        id: l.id,
        name: l.name,
        panelCount: Object.keys(l.panels).length,
    }));
}

export function getLayout(id) {
    const layout = getStore().layouts[id];
    return layout ? { id: layout.id, name: layout.name, panelCount: Object.keys(layout.panels).length } : null;
}

export function getActiveLayoutId() {
    return getStore().activeLayoutId;
}

// Store-only; use panel-manager.js switchLayout() to also swap the
// on-screen panels.
export function setActiveLayoutId(id) {
    const store = getStore();
    if (!store.layouts[id]) return false;
    if (store.activeLayoutId === id) return true;
    store.activeLayoutId = id;
    save();
    emitLibraryChange();
    return true;
}

export function createLayout(name) {
    return addLayout(name || 'New Layout');
}

export function duplicateLayout(id) {
    const source = getStore().layouts[id];
    if (!source) return null;
    return addLayout(`${source.name} (copy)`, {
        backgrounds: source.backgrounds,
        instances: sortedInstances(source),
        nextPanelNumber: source.nextPanelNumber,
    });
}

export function renameLayout(id, name) {
    const store = getStore();
    const layout = store.layouts[id];
    if (!layout || !name || layout.name === name) return false;
    layout.name = uniqueName(name, layoutNames(store).filter((n) => n !== layout.name));
    save();
    emitLibraryChange();
    return true;
}

// Refuses to delete the last remaining layout. If the active layout is
// deleted, the oldest remaining one becomes active (store-only; see
// panel-manager.js removeLayout()).
export function deleteLayout(id) {
    const store = getStore();
    if (!store.layouts[id] || Object.keys(store.layouts).length <= 1) return false;
    delete store.layouts[id];
    if (store.activeLayoutId === id) store.activeLayoutId = sortedLayouts(store)[0].id;
    save();
    emitLibraryChange();
    return true;
}

export function exportLayout(id) {
    const layout = getStore().layouts[id];
    if (!layout) return null;
    return makePayload(KIND.LAYOUT, {
        name: layout.name,
        backgrounds: clone(layout.backgrounds),
        panels: sortedInstances(layout).map(instanceData),
    });
}

// `data` is the already-validated payload data (see format.js
// readPayload). Adds it to the library without activating it.
export function importLayout(data) {
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Layout';
    return addLayout(name, {
        backgrounds: data.backgrounds,
        instances: Array.isArray(data.panels) ? data.panels.filter((p) => p && typeof p === 'object') : [],
    });
}
