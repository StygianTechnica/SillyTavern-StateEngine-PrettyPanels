// Owns the live collection of Panel instances and keeps it in lockstep
// with the registry: every create/move/resize/lock/delete goes through
// here, writes the registry (which persists), then updates the DOM.
// Designed for any number of panels - nothing here assumes there is
// only one.
//
// Also owns the two global switches: Enabled (panels exist on screen at
// all) and Editing Mode (editing chrome visible). Disabling only tears
// down the DOM - saved records are untouched, and re-enabling rebuilds
// every panel from the registry.
//
// Only the active layout's panels are ever mounted. Switching or
// deleting the active layout goes through switchLayout()/removeLayout()
// here so the screen follows the Layout Library (which layout a chat
// shows is decided in src/chat/chat-session.js).
//
// Elements (VariableElements inside panels) are edited here too: add,
// rebind, move/resize, change properties, delete - each a whole-widgets
// update of the owning panel record. Any change to what variables the
// layout shows is announced through onBindingsChange() so the chat
// session can activate presets and re-watch values.
//
// Stacking: each panel's stored zIndex (layout data) is the only thing
// that decides which panel is on top - clicking or dragging a panel never
// changes it; only the Layering controls do (setPanelZIndex/restackPanel).

import { Panel } from './panel.js';
import {
    listPanels,
    createPanelRecord,
    updatePanelRecord,
    deletePanelRecord,
    isEnabled,
    setEnabledFlag,
    isEditingMode,
    setEditingModeFlag,
    getGridSettings,
    setGridSettings,
    clampZIndex,
    maxZIndex,
} from './panel-registry.js';
import { DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_HEIGHT, pickDesign } from '../storage/design.js';
import { isVariableElement, DEFAULT_ELEMENT_WIDTH, DEFAULT_ELEMENT_HEIGHT, createVariableElement } from '../elements/element-model.js';
import { getValue, onValuesChange } from '../chat/variable-service.js';
import { softSnap } from './snap.js';
import { getActiveLayoutId, setActiveLayoutId, deleteLayout } from '../library/layout-library.js';
import { getTemplate } from '../library/panel-library.js';
import { confirmYesNo, notify } from '../ui/dialogs.js';
import { saveInstanceToLibrary, exportInstanceTemplate } from '../ui/template-actions.js';

// Panels sit above the chat but below SillyTavern's own popups/drawers:
// CSS z-index = BASE_Z_INDEX + the panel's stored zIndex (0..99).
export const BASE_Z_INDEX = 2900;
const CASCADE_STEP = 24;
const CASCADE_SLOTS = 8;

const panels = new Map();
const stateListeners = new Set();
const bindingListeners = new Set();
let initialized = false;

const hooks = {
    onGeometryCommit(panel, geometry) {
        const { x, y, width, height } = panel.record;
        if (geometry.x === x && geometry.y === y && geometry.width === width && geometry.height === height) {
            return;
        }
        const updated = updatePanelRecord(panel.id, geometry);
        if (updated) panel.update(updated);
    },
    onLockChange(panel, locked) {
        const updated = updatePanelRecord(panel.id, { locked });
        if (updated) panel.update(updated);
    },
    onDeleteRequest(panel) {
        void confirmAndDelete(panel.id);
    },
    onSaveTemplateRequest(panel) {
        void saveInstanceToLibrary(panel.record);
    },
    onExportTemplateRequest(panel) {
        exportInstanceTemplate(panel.record);
    },
    getGrid() {
        return getGridSettings();
    },
    getValue(name) {
        return getValue(name);
    },
    onElementCommit(panel, elementId, patch) {
        updateElement(panel, elementId, patch);
    },
    onElementDragging(panel, elementId, geometry) {
        panel.popup?.refreshElementGeometry(elementId, geometry);
    },
    onElementClick(panel, elementId) {
        panel.selectElement(elementId);
        panel.openProperties('element');
    },
    onZIndexChange(panel, zIndex) {
        setPanelZIndex(panel, zIndex);
    },
    onRestack(panel, action) {
        restackPanel(panel, action);
    },
    onStyleChange(panel, patch) {
        updatePanelStyle(panel, patch);
    },
    onElementDelete(panel, elementId) {
        deleteElement(panel, elementId);
    },
    onAddVariable(panel, name) {
        addVariableElement(panel, name);
    },
    onDropVariable(name, clientX, clientY) {
        return dropVariableAt(name, clientX, clientY);
    },
    dropTargetAt(clientX, clientY) {
        return dropTargetAt(clientX, clientY);
    },
};

// Tells the chat session the set of shown variables changed. `added` are
// names newly shown, whose presets may need activating.
function emitBindingsChange(added = []) {
    for (const listener of bindingListeners) listener(added);
}

export function onBindingsChange(listener) {
    bindingListeners.add(listener);
    return () => bindingListeners.delete(listener);
}

// Every variable name bound by an element in the active layout (from the
// registry, so it's right even while panels are unmounted).
export function getBoundVariableNames() {
    const names = new Set();
    for (const record of listPanels()) {
        for (const widget of record.widgets) {
            if (isVariableElement(widget) && widget.binding) names.add(widget.binding.name);
        }
    }
    return [...names];
}

function mountPanel(record) {
    const panel = new Panel(record, hooks);
    panels.set(record.id, panel);
    panel.mount();
    return panel;
}

// Sets a panel's stored stacking order (clamped to 0..99).
export function setPanelZIndex(panel, zIndex) {
    const next = clampZIndex(zIndex);
    if (next === panel.record.zIndex) return;
    const updated = updatePanelRecord(panel.id, { zIndex: next });
    if (updated) panel.update(updated);
}

// Merges `patch` into a panel's Panel Styling; a null/undefined value
// removes that property (back to the theme default).
export function updatePanelStyle(panel, patch) {
    const style = { ...panel.record.style };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete style[key];
        else style[key] = value;
    }
    const updated = updatePanelRecord(panel.id, { style });
    if (updated) panel.update(updated);
}

// Layering buttons: 'forward' (+1), 'backward' (-1), 'front' (one above
// every other panel), 'back' (0).
export function restackPanel(panel, action) {
    const z = panel.record.zIndex;
    if (action === 'forward') setPanelZIndex(panel, z + 1);
    else if (action === 'backward') setPanelZIndex(panel, z - 1);
    else if (action === 'front') setPanelZIndex(panel, maxZIndex(panel.id) + 1);
    else if (action === 'back') setPanelZIndex(panel, 0);
}

// Default spot for a new panel: horizontally centred, near the top,
// cascading so consecutive panels don't stack exactly on top of each other.
function defaultPlacement() {
    const slot = panels.size % CASCADE_SLOTS;
    const width = Math.min(DEFAULT_PANEL_WIDTH, window.innerWidth - 16);
    const height = Math.min(DEFAULT_PANEL_HEIGHT, window.innerHeight - 16);
    return {
        x: Math.max(0, Math.round((window.innerWidth - width) / 2) + slot * CASCADE_STEP),
        y: Math.max(0, 96 + slot * CASCADE_STEP),
        width,
        height,
    };
}

// True if a mounted panel already sits (almost) exactly at x, y.
function isOccupied(x, y) {
    for (const panel of panels.values()) {
        if (Math.abs(panel.record.x - x) < 4 && Math.abs(panel.record.y - y) < 4) return true;
    }
    return false;
}

async function confirmAndDelete(id) {
    const panel = panels.get(id);
    if (!panel) return;
    const ok = await confirmYesNo(`Delete "${panel.record.name}"? This cannot be undone.`);
    if (ok) deletePanel(id);
}

function mountAllPanels() {
    for (const record of listPanels()) {
        if (!panels.has(record.id)) mountPanel(record);
    }
}

// Removes every panel from the DOM without touching the registry.
function unmountAllPanels() {
    for (const panel of panels.values()) panel.destroy();
    panels.clear();
}

// Grid size as a CSS variable (the editing-mode grid overlay), and a
// body class while snapping is on.
function applyGrid() {
    const { snap, size } = getGridSettings();
    document.body.style.setProperty('--pp-grid', `${size}px`);
    document.body.classList.toggle('pp-snap', snap);
}

export function setGrid(settings) {
    const result = setGridSettings(settings);
    applyGrid();
    return result;
}

export function getGrid() {
    return getGridSettings();
}

// Rebuilds the screen from the (possibly newly) active layout.
function reloadPanels() {
    unmountAllPanels();
    if (isEnabled()) mountAllPanels();
}

// Restores every panel stored in the registry (if enabled). Idempotent.
export function initPanels() {
    if (initialized) return;
    initialized = true;

    // Editing Mode can never be on while the extension is disabled, even
    // if a stale saved setting says otherwise.
    if (!isEnabled() && isEditingMode()) setEditingModeFlag(false);
    if (isEnabled()) mountAllPanels();
    applyGrid();
    applyState();

    onValuesChange(() => {
        for (const panel of panels.values()) panel.renderValues();
    });

    // Re-clamp on-screen positions when the window changes size; stored
    // geometry is untouched (see Panel.applyRecord()).
    window.addEventListener('resize', () => {
        for (const panel of panels.values()) panel.applyRecord();
    });
}

// Creates a new panel at the default placement and persists it. Only
// possible while enabled and in Editing Mode (the only state in which
// the wand entry is shown).
export function createPanel() {
    if (!isEnabled() || !isEditingMode()) return null;
    const record = createPanelRecord(defaultPlacement());
    return mountPanel(record);
}

// Inserts a new instance of a Panel Library template into the active
// layout. The instance is independent: the template is only read.
export function insertTemplate(templateId) {
    if (!isEnabled() || !isEditingMode()) return null;
    const template = getTemplate(templateId);
    if (!template) return null;
    const design = pickDesign(template);
    // Don't land exactly on top of an instance already at the template's
    // saved spot, or the insert looks like it did nothing.
    for (let i = 0; i < CASCADE_SLOTS && isOccupied(design.x, design.y); i++) {
        design.x += CASCADE_STEP;
        design.y += CASCADE_STEP;
    }
    const record = createPanelRecord({ ...design, name: template.name });
    return mountPanel(record);
}

// Makes `id` the active layout and swaps the on-screen panels to it.
export function switchLayout(id) {
    if (id === getActiveLayoutId()) return true;
    if (!setActiveLayoutId(id)) return false;
    reloadPanels();
    return true;
}

// Deletes a layout from the Layout Library; if it was the active one,
// the screen switches to whichever layout became active instead.
export function removeLayout(id) {
    const wasActive = id === getActiveLayoutId();
    if (!deleteLayout(id)) return false;
    if (wasActive) {
        reloadPanels();
        emitBindingsChange(getBoundVariableNames());
    }
    return true;
}

export function deletePanel(id) {
    const panel = panels.get(id);
    if (!panel) return false;
    const hadBindings = panel.record.widgets.some((w) => w.binding);
    panel.destroy();
    panels.delete(id);
    deletePanelRecord(id);
    if (hadBindings) emitBindingsChange();
    return true;
}

// ---------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------

function saveWidgets(panel, widgets) {
    const updated = updatePanelRecord(panel.id, { widgets });
    if (updated) panel.update(updated);
    return updated;
}

// Shallow-merges `patch` into one element. A binding change is announced.
export function updateElement(panel, elementId, patch) {
    const current = panel.getElement(elementId);
    if (!current) return false;
    // id is fixed; a new type is validated by the model (unknown -> 'text').
    const next = { ...current, ...patch, id: current.id };
    const widgets = panel.record.widgets.map((w) => (w.id === elementId ? next : w));
    if (!saveWidgets(panel, widgets)) return false;
    const before = current.binding?.name ?? null;
    const after = panel.getElement(elementId)?.binding?.name ?? null;
    if (before !== after) emitBindingsChange(after ? [after] : []);
    return true;
}

export function rebindElement(panel, elementId, name) {
    return updateElement(panel, elementId, { binding: name ? { name } : null });
}

export function deleteElement(panel, elementId) {
    const current = panel.getElement(elementId);
    if (!current) return false;
    if (panel.selectedElementId === elementId) panel.selectElement(null);
    saveWidgets(panel, panel.record.widgets.filter((w) => w.id !== elementId));
    if (current.binding) emitBindingsChange();
    return true;
}

// Adds a VariableElement bound to `name`. `at` ({ x, y } in body
// coordinates) defaults to the first free row below existing elements.
// The new element is selected.
export function addVariableElement(panel, name, at = null) {
    if (!panel.canEdit()) {
        notify('warning', 'Unlock this panel (and turn on Editing Mode) to add elements to it.');
        return null;
    }
    const grid = panel.gridSize() || 1;
    const bodyWidth = panel.body.clientWidth || panel.record.width;
    const width = Math.max(24, Math.min(DEFAULT_ELEMENT_WIDTH, bodyWidth));
    let x;
    let y;
    if (at) {
        x = softSnap(at.x, grid);
        y = softSnap(at.y, grid);
    } else {
        const bottom = panel.record.widgets.reduce((max, w) => Math.max(max, (w.y ?? 0) + (w.height ?? 0)), 0);
        x = 0;
        y = Math.ceil(bottom / grid) * grid;
    }
    x = Math.max(0, Math.min(Math.round(x), bodyWidth - width));
    y = Math.max(0, Math.round(y));
    const element = createVariableElement({ x, y, width, height: DEFAULT_ELEMENT_HEIGHT, binding: name ? { name } : null });
    saveWidgets(panel, [...panel.record.widgets, element]);
    panel.selectElement(element.id);
    if (name) emitBindingsChange([name]);
    return element;
}

// What a variable dragged to (clientX, clientY) would land on:
// { panel, elementId } (rebind) or { panel } (new element), or null.
export function dropTargetAt(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const panelEl = hit?.closest?.('.pp-panel');
    const panel = panelEl ? panels.get(panelEl.dataset.panelId) : null;
    if (!panel) return null;
    const elementEl = hit.closest('.pp-element');
    return elementEl && panel.el.contains(elementEl) ? { panel, elementId: elementEl.dataset.elementId } : { panel };
}

// Drops a variable from the picker: onto an element it replaces that
// element's binding; onto a panel it adds a new element at the pointer.
export function dropVariableAt(name, clientX, clientY) {
    const target = dropTargetAt(clientX, clientY);
    if (!target) return false;
    const { panel, elementId } = target;
    if (!panel.canEdit()) {
        notify('warning', 'Unlock this panel to change its elements.');
        return false;
    }
    if (elementId) {
        rebindElement(panel, elementId, name);
        panel.selectElement(elementId);
    } else {
        const rect = panel.body.getBoundingClientRect();
        addVariableElement(panel, name, {
            x: clientX - rect.left + panel.body.scrollLeft - 12,
            y: clientY - rect.top + panel.body.scrollTop - DEFAULT_ELEMENT_HEIGHT / 2,
        });
    }
    panel.openProperties('element');
    return true;
}

export function getPanels() {
    return [...panels.values()];
}

// Pushes the current Enabled/Editing Mode state to the page and to
// every listener (wand menu, settings drawer).
function applyState() {
    const enabled = isEnabled();
    const editing = enabled && isEditingMode();
    document.body.classList.toggle('pp-editing', editing);
    if (!editing) {
        for (const panel of panels.values()) panel.closeProperties();
    }
    const state = { enabled, editingMode: editing };
    for (const listener of stateListeners) listener(state);
}

export function setEnabled(enabled) {
    enabled = enabled === true;
    setEnabledFlag(enabled);
    if (enabled) {
        mountAllPanels();
    } else {
        if (isEditingMode()) setEditingModeFlag(false);
        unmountAllPanels();
    }
    applyState();
}

// Ignored while the extension is disabled.
export function setEditingMode(enabled) {
    setEditingModeFlag(enabled === true && isEnabled());
    applyState();
}

export function getState() {
    const enabled = isEnabled();
    return { enabled, editingMode: enabled && isEditingMode() };
}

// Lets UI (wand menu, settings drawer) follow Enabled/Editing Mode.
// The listener is called with { enabled, editingMode } on every change.
export function onStateChange(listener) {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
}
