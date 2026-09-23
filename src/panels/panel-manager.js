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
// here so the screen follows the Layout Library.

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
} from './panel-registry.js';
import { DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_HEIGHT, pickDesign } from '../storage/design.js';
import { getActiveLayoutId, setActiveLayoutId, deleteLayout } from '../library/layout-library.js';
import { getTemplate } from '../library/panel-library.js';
import { confirmYesNo } from '../ui/dialogs.js';
import { saveInstanceToLibrary, exportInstanceTemplate } from '../ui/template-actions.js';

// Panels sit above the chat but below SillyTavern's own popups/drawers.
const BASE_Z_INDEX = 2900;
const CASCADE_STEP = 24;
const CASCADE_SLOTS = 8;

const panels = new Map();
const stateListeners = new Set();
let zCounter = BASE_Z_INDEX;
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
    onFocus(panel) {
        bringToFront(panel);
    },
    onSaveTemplateRequest(panel) {
        void saveInstanceToLibrary(panel.record);
    },
    onExportTemplateRequest(panel) {
        exportInstanceTemplate(panel.record);
    },
};

function bringToFront(panel) {
    panel.setZIndex(++zCounter);
}

function mountPanel(record) {
    const panel = new Panel(record, hooks);
    panels.set(record.id, panel);
    panel.mount();
    bringToFront(panel);
    return panel;
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
    applyState();

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
    if (wasActive) reloadPanels();
    return true;
}

export function deletePanel(id) {
    const panel = panels.get(id);
    if (!panel) return false;
    panel.destroy();
    panels.delete(id);
    deletePanelRecord(id);
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
