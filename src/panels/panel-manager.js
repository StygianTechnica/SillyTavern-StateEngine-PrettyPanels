// Owns the live collection of Panel instances and keeps it in lockstep
// with the registry: every create/move/resize/lock/delete goes through
// here, writes the registry (which persists), then updates the DOM.
// Designed for any number of panels - nothing here assumes there is
// only one.

import { Panel } from './panel.js';
import {
    listPanels,
    createPanelRecord,
    updatePanelRecord,
    deletePanelRecord,
    isEditingMode,
    setEditingModeFlag,
    DEFAULT_PANEL_WIDTH,
    DEFAULT_PANEL_HEIGHT,
} from './panel-registry.js';

// Panels sit above the chat but below SillyTavern's own popups/drawers.
const BASE_Z_INDEX = 2900;
const CASCADE_STEP = 24;
const CASCADE_SLOTS = 8;

const panels = new Map();
const editingModeListeners = new Set();
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

async function confirmYesNo(message) {
    try {
        const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
        if (typeof callGenericPopup === 'function' && POPUP_TYPE) {
            const result = await callGenericPopup(message, POPUP_TYPE.CONFIRM);
            return result === (POPUP_RESULT?.AFFIRMATIVE ?? 1);
        }
    } catch {
        // Fall through to the native dialog.
    }
    return window.confirm(message);
}

async function confirmAndDelete(id) {
    const panel = panels.get(id);
    if (!panel) return;
    const ok = await confirmYesNo(`Delete "${panel.record.name}"? This cannot be undone.`);
    if (ok) deletePanel(id);
}

// Restores every panel stored in the registry. Idempotent.
export function initPanels() {
    if (initialized) return;
    initialized = true;

    for (const record of listPanels()) mountPanel(record);
    applyEditingMode(isEditingMode());

    // Re-clamp on-screen positions when the window changes size; stored
    // geometry is untouched (see Panel.applyRecord()).
    window.addEventListener('resize', () => {
        for (const panel of panels.values()) panel.applyRecord();
    });
}

// Creates a new panel at the default placement, persists it, and turns
// Editing Mode on so the user can move/resize it straight away.
export function createPanel() {
    const record = createPanelRecord(defaultPlacement());
    const panel = mountPanel(record);
    if (!isEditingMode()) setEditingMode(true);
    return panel;
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

function applyEditingMode(enabled) {
    document.body.classList.toggle('pp-editing', enabled);
    if (!enabled) {
        for (const panel of panels.values()) panel.closeProperties();
    }
    for (const listener of editingModeListeners) listener(enabled);
}

export function setEditingMode(enabled) {
    setEditingModeFlag(enabled);
    applyEditingMode(isEditingMode());
}

export function toggleEditingMode() {
    setEditingMode(!isEditingMode());
}

export { isEditingMode };

// Lets UI (e.g. the wand menu) reflect the current Editing Mode state.
export function onEditingModeChange(listener) {
    editingModeListeners.add(listener);
    return () => editingModeListeners.delete(listener);
}
