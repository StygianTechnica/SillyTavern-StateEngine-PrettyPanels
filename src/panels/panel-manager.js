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
    DEFAULT_PANEL_WIDTH,
    DEFAULT_PANEL_HEIGHT,
} from './panel-registry.js';

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
