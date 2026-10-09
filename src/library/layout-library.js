// Layout Library: global HUD layouts, each a named set of panel
// instances plus layout-level background layers. Exactly one layout is
// active (the one on screen and edited); which one is chosen per chat
// (src/chat/chat-session.js). There is no default layout - a chat that
// has not chosen one shows none. Switching or deleting the active layout
// must go through panel-manager.js (switchLayout/removeLayout) so the
// on-screen panels follow.
//
// Layouts carry their elements' variable bindings (a chat chooses a
// layout for what it displays); panel templates never do.

import { normalizeAtmosphere } from '../atmosphere/atmosphere-model.js';
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
import { exportLayoutRoles, importLayoutRoles, announceRolesChange, pruneUnusedRoles } from './role-library.js';
import { notify } from '../ui/dialogs.js';
import { KIND, makePayload } from './format.js';
import { exportCharacterTemplate, importCharacterTemplate } from './character-template-library.js';

// The character templates a layout's Character elements draw with.
function usedCharacterTemplateIds(panels) {
    const ids = new Set();
    for (const panel of panels) {
        for (const widget of Array.isArray(panel?.widgets) ? panel.widgets : []) {
            if (widget?.type === 'character' && typeof widget.character?.templateId === 'string') ids.add(widget.character.templateId);
        }
    }
    return [...ids];
}

function layoutNames(store) {
    return Object.values(store.layouts).map((l) => l.name);
}

// The portable part of one panel instance (design plus its place in the
// layout's stacking order).
function instanceData(source) {
    return {
        name: typeof source?.name === 'string' && source.name ? source.name : 'Panel',
        locked: source?.locked === true,
        ...(Number.isInteger(source?.zIndex) ? { zIndex: source.zIndex } : {}),
        ...pickDesign(source ?? {}),
    };
}

function sortedInstances(layout) {
    return Object.values(layout.panels)
        .filter((p) => p && typeof p.id === 'string')
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

// Groups in portable form: arrays of indices into the instance list.
function portableGroups(layout, instances) {
    const index = new Map(instances.map((p, i) => [p.id, i]));
    return Object.values(layout.groups ?? {})
        .map((g) => g.panelIds.map((id) => index.get(id)).filter((i) => i !== undefined))
        .filter((g) => g.length >= 2);
}

// Adds a new layout built from portable instance data. Every instance
// gets a fresh ID; `groups` (index arrays) are rebuilt onto those IDs.
// Does not change which layout is active.
function addLayout(name, { backgrounds = [], instances = [], groups = [], nextPanelNumber = 1, roles = [], atmosphere = [] } = {}) {
    const store = getStore();
    const layout = newLayoutRecord(uniqueName(name, layoutNames(store)));
    layout.backgrounds = Array.isArray(backgrounds) ? clone(backgrounds) : [];
    // Fresh layer ids: a copy or an import never shares them with its source.
    layout.atmosphere = normalizeAtmosphere((Array.isArray(atmosphere) ? clone(atmosphere) : []).map((layer) => (layer && typeof layer === 'object' ? { ...layer, id: undefined } : layer)));
    layout.roles = roles.filter((n) => store.roles[n]);
    const now = Date.now();
    const ids = instances.map((source, i) => {
        const id = generateId('pp');
        layout.panels[id] = { id, createdAt: now + i, ...instanceData(source) };
        return id;
    });
    layout.groups = {};
    for (const members of Array.isArray(groups) ? groups : []) {
        const panelIds = (Array.isArray(members) ? members : []).map((i) => ids[i]).filter(Boolean);
        if (panelIds.length >= 2) {
            const gid = generateId('ppg');
            layout.groups[gid] = { id: gid, panelIds };
        }
    }
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
    const instances = sortedInstances(source);
    return addLayout(`${source.name} (copy)`, {
        backgrounds: source.backgrounds,
        instances,
        groups: portableGroups(source, instances),
        nextPanelNumber: source.nextPanelNumber,
        roles: source.roles,
        atmosphere: source.atmosphere,
    });
}

// ---- atmosphere (src/atmosphere/) ---------------------------------------------

const atmosphereListeners = new Set();

// A layout's effect layers (atmosphere-model.js), as copies.
export function getLayoutAtmosphere(id) {
    return clone(normalizeAtmosphere(getStore().layouts[id]?.atmosphere));
}

export function setLayoutAtmosphere(id, layers) {
    const layout = getStore().layouts[id];
    if (!layout) return null;
    layout.atmosphere = normalizeAtmosphere(layers);
    save();
    for (const listener of [...atmosphereListeners]) listener(id);
    return clone(layout.atmosphere);
}

export function onAtmosphereChange(listener) {
    atmosphereListeners.add(listener);
    return () => atmosphereListeners.delete(listener);
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

// Refuses to delete the last remaining layout. Deleting the active
// layout makes the oldest remaining one active (store-only; see
// panel-manager.js removeLayout()). A chat that had chosen the deleted
// layout shows no layout the next time it loads, and asks for one. Roles
// no other layout carries are deleted with it.
export function deleteLayout(id) {
    const store = getStore();
    if (!store.layouts[id] || Object.keys(store.layouts).length <= 1) return false;
    delete store.layouts[id];
    if (store.activeLayoutId === id) store.activeLayoutId = sortedLayouts(store)[0].id;
    save();
    emitLibraryChange();
    // Roles only this layout carried leave the registry (and State Engine).
    pruneUnusedRoles();
    return true;
}

export function exportLayout(id) {
    const layout = getStore().layouts[id];
    if (!layout) return null;
    const instances = sortedInstances(layout);
    return makePayload(KIND.LAYOUT, {
        name: layout.name,
        backgrounds: clone(layout.backgrounds),
        panels: instances.map(instanceData),
        atmosphere: normalizeAtmosphere(layout.atmosphere),
        groups: portableGroups(layout, instances),
        // The layout's roles travel with it (an element bound to a role
        // needs its definition in the importing install).
        roles: exportLayoutRoles(layout),
        // So do the character templates its Character elements draw with
        // (each with its bindings and roles), keyed by their id here.
        characterTemplates: usedCharacterTemplateIds(instances)
            .map((templateId) => ({ templateId, payload: exportCharacterTemplate(templateId) }))
            .filter((t) => t.payload)
            .map(({ templateId, payload }) => ({ ...payload.data, templateId })),
    });
}

// `data` is the already-validated payload data (see format.js
// readPayload). Adds it to the library without activating it. Its roles
// join the role registry; a role name this install already has is shared
// (it keeps its own type - noted if the import's differed).
export function importLayout(data) {
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Layout';
    const { names, conflicts } = importLayoutRoles(data.roles);
    if (conflicts.length) notify('info', `Roles already defined here keep their own type: ${conflicts.join(', ')}.`);
    // Its character templates join Character Templates (new ids); its
    // Character elements follow them.
    const templateIds = new Map();
    for (const template of Array.isArray(data.characterTemplates) ? data.characterTemplates : []) {
        if (template && typeof template === 'object' && typeof template.templateId === 'string') {
            templateIds.set(template.templateId, importCharacterTemplate(template).summary.id);
        }
    }
    const instances = (Array.isArray(data.panels) ? data.panels.filter((p) => p && typeof p === 'object') : []).map((panel) => ({
        ...panel,
        widgets: Array.isArray(panel.widgets) ? panel.widgets.map((w) => (w?.type === 'character' && templateIds.has(w.character?.templateId)
            ? { ...w, character: { ...w.character, templateId: templateIds.get(w.character.templateId) } }
            : w)) : panel.widgets,
    }));
    const id = addLayout(name, {
        backgrounds: data.backgrounds,
        instances,
        groups: data.groups,
        roles: names,
        atmosphere: data.atmosphere,
    });
    if (names.length) announceRolesChange();
    return id;
}
