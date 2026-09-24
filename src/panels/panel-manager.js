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
//
// Layout Tools (src/ui/layout-toolbar.js) act on the panel SELECTION kept
// here: align, distribute, group/ungroup/select group, Show Grid. Grouped
// panels move together when one of them is dragged; alignment guides are
// drawn while dragging (src/ui/guides.js).

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
    listGroups,
    groupOfPanel,
    createGroupRecord,
    ungroupPanels,
    isShowGrid,
    setShowGridFlag,
} from './panel-registry.js';
import { showGuides, clearGuides } from '../ui/guides.js';
import { DEFAULT_PANEL_WIDTH, DEFAULT_PANEL_HEIGHT, pickDesign } from '../storage/design.js';
import {
    isVariableElement, isShapeElement, DEFAULT_ELEMENT_WIDTH, DEFAULT_ELEMENT_HEIGHT, DEFAULT_TYPE_SIZES, ELEMENT_TYPE_SHAPE,
    ELEMENT_TYPE_FREE_TEXT, createVariableElement,
} from '../elements/element-model.js';
import { getValue, getImage, onValuesChange } from '../chat/variable-service.js';
import { softSnap } from './snap.js';
import { getActiveLayoutId, setActiveLayoutId, deleteLayout } from '../library/layout-library.js';
import { getTemplate } from '../library/panel-library.js';
import { confirmYesNo, notify } from '../ui/dialogs.js';
import { saveInstanceToLibrary, exportInstanceTemplate } from '../ui/template-actions.js';
import { fontRegistry } from '../fonts/font-registry.js';

// Panels sit above the chat but below SillyTavern's own popups/drawers:
// CSS z-index = BASE_Z_INDEX + the panel's stored zIndex (0..99).
export const BASE_Z_INDEX = 2900;
const CASCADE_STEP = 24;
const CASCADE_SLOTS = 8;

const panels = new Map();
const stateListeners = new Set();
const bindingListeners = new Set();
const selectionListeners = new Set();
// Selected panel IDs, in the order they were picked - the first is the
// reference panel for alignment.
let selection = [];
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
        void exportInstanceTemplate(panel.record);
    },
    getGrid() {
        return getGridSettings();
    },
    getValue(name) {
        return getValue(name);
    },
    getImage(name) {
        return getImage(name);
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
    // Pressing a panel (its top strip or empty area): Ctrl/Shift/Cmd
    // toggles it in the selection; a plain press selects it (keeping a
    // multi-selection it's already part of, so a drag doesn't drop it).
    onPanelPress(panel, additive) {
        if (additive) togglePanelSelection(panel.id);
        else if (!selection.includes(panel.id)) setSelection([panel.id]);
    },
    // A plain click that didn't turn into a drag selects just that panel.
    onPanelClick(panel, additive) {
        if (!additive) setSelection([panel.id]);
    },
    // Other panels of this panel's group that move with it (unlocked only).
    getGroupPeers(panel) {
        const group = groupOfPanel(panel.id);
        if (!group) return [];
        return group.panelIds
            .filter((id) => id !== panel.id)
            .map((id) => panels.get(id))
            .filter((p) => p && !p.record.locked);
    },
    onPanelDragging(panel, geometry, movingIds) {
        showGuides(computeGuides(geometry, new Set(movingIds)));
    },
    onPanelDragEnd() {
        clearGuides();
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
    onAddPaletteItem(panel, kind) {
        addPaletteElement(panel, kind);
    },
    onDropPaletteItem(kind, clientX, clientY) {
        return dropPaletteElementAt(kind, clientX, clientY);
    },
    onArrangeElement(panel, elementId, action) {
        arrangeElement(panel, elementId, action);
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

// Every variable name the active layout uses - element bindings and panel
// background image variables (from the registry, so it's right even while
// panels are unmounted). Their presets get activated in the chat.
export function getBoundVariableNames() {
    const names = new Set(getBoundImageNames());
    for (const record of listPanels()) {
        for (const widget of record.widgets) {
            if (isVariableElement(widget) && widget.binding) names.add(widget.binding.name);
        }
    }
    return [...names];
}

// The image variables panels use as backgrounds.
export function getBoundImageNames() {
    const names = new Set();
    for (const record of listPanels()) {
        const name = record.style?.backgroundImageVariable;
        if (typeof name === 'string' && name) names.add(name);
    }
    return [...names];
}

function mountPanel(record) {
    const panel = new Panel(record, hooks);
    panels.set(record.id, panel);
    panel.mount();
    applyPanelMarkers();
    return panel;
}

// ---------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------

// Pushes selection and group membership to every panel, then listeners.
function applyPanelMarkers() {
    const grouped = new Set(listGroups().flatMap((g) => g.panelIds));
    for (const panel of panels.values()) {
        panel.setSelectionState(selection.indexOf(panel.id), grouped.has(panel.id));
    }
    const state = getSelectionState();
    for (const listener of selectionListeners) listener(state);
}

function setSelection(ids) {
    selection = ids.filter((id, i) => panels.has(id) && ids.indexOf(id) === i);
    applyPanelMarkers();
}

export function togglePanelSelection(id) {
    setSelection(selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id]);
}

export function clearSelection() {
    setSelection([]);
}

// { ids, count, grouped: any selected panel is in a group }
export function getSelectionState() {
    const grouped = new Set(listGroups().flatMap((g) => g.panelIds));
    return { ids: [...selection], count: selection.length, grouped: selection.some((id) => grouped.has(id)) };
}

export function onSelectionChange(listener) {
    selectionListeners.add(listener);
    return () => selectionListeners.delete(listener);
}

// ---------------------------------------------------------------------
// Layout tools: align, distribute, groups, guides, grid
// ---------------------------------------------------------------------

function moveRecord(panel, patch) {
    const updated = updatePanelRecord(panel.id, patch);
    if (updated) panel.update(updated);
}

// The screen area panels align to: the window minus SillyTavern's top
// bar, measured live (its height depends on theme and zoom). Anything
// that isn't there or isn't visible is ignored.
const TOP_BAR_SELECTORS = ['#top-settings-holder', '#top-bar'];
function screenBounds() {
    let top = 0;
    for (const selector of TOP_BAR_SELECTORS) {
        const el = document.querySelector(selector);
        if (!el || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
        const rect = el.getBoundingClientRect();
        // Only a bar actually along the top edge counts.
        if (rect.height > 0 && rect.top <= 1 && rect.bottom < window.innerHeight / 2) top = Math.max(top, Math.ceil(rect.bottom));
    }
    return { x: 0, y: top, width: window.innerWidth, height: window.innerHeight - top };
}

// Aligns the selected panels. With several selected, to the first one
// picked; with one, to the screen below SillyTavern's top bar
// (screenBounds). Locked panels never move. Edges:
// 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'.
export function alignSelection(edge) {
    const chosen = selection.map((id) => panels.get(id)).filter(Boolean);
    if (chosen.length === 0) return 0;
    const ref = chosen.length > 1 ? chosen[0].record : screenBounds();
    const targets = chosen.length > 1 ? chosen.slice(1) : chosen;
    let moved = 0;
    for (const panel of targets) {
        if (panel.record.locked) continue;
        const { width, height } = panel.record;
        const pos = {
            left: { x: ref.x },
            center: { x: Math.round(ref.x + ref.width / 2 - width / 2) },
            right: { x: ref.x + ref.width - width },
            top: { y: ref.y },
            middle: { y: Math.round(ref.y + ref.height / 2 - height / 2) },
            bottom: { y: ref.y + ref.height - height },
        }[edge];
        if (!pos) continue;
        moveRecord(panel, pos);
        moved++;
    }
    return moved;
}

// Evenly spaces the selected panels (3+) between the outermost two,
// keeping sizes: equal gaps between neighbours along the axis. Locked
// panels keep their place.
export function distributeSelection(axis) {
    const chosen = selection.map((id) => panels.get(id)).filter(Boolean);
    if (chosen.length < 3) return 0;
    const pos = axis === 'horizontal' ? 'x' : 'y';
    const size = axis === 'horizontal' ? 'width' : 'height';
    const sorted = [...chosen].sort((a, b) => a.record[pos] - b.record[pos]);
    const first = sorted[0].record;
    const last = sorted[sorted.length - 1].record;
    const span = last[pos] + last[size] - first[pos];
    const total = sorted.reduce((sum, p) => sum + p.record[size], 0);
    const gap = (span - total) / (sorted.length - 1);
    let cursor = first[pos] + first[size] + gap;
    let moved = 0;
    for (const panel of sorted.slice(1, -1)) {
        if (!panel.record.locked) {
            moveRecord(panel, { [pos]: Math.round(cursor) });
            moved++;
        }
        cursor += panel.record[size] + gap;
    }
    return moved;
}

export function groupSelection() {
    const group = createGroupRecord(selection);
    applyPanelMarkers();
    return group;
}

export function ungroupSelection() {
    const removed = ungroupPanels(selection);
    applyPanelMarkers();
    return removed;
}

// Adds every panel in the selected panels' groups to the selection.
export function selectGroupOfSelection() {
    const ids = new Set(selection);
    for (const group of listGroups()) {
        if (group.panelIds.some((id) => ids.has(id))) group.panelIds.forEach((id) => ids.add(id));
    }
    setSelection([...selection, ...[...ids].filter((id) => !selection.includes(id))]);
}

// Alignment guides for a panel being dragged to `g`: every other panel
// (not moving with it) whose left/right edge or horizontal centre, or
// top/bottom edge or vertical centre, lines up within 1px.
const GUIDE_TOLERANCE = 1;
function computeGuides(g, movingIds) {
    const lines = [];
    const xs = [g.x, g.x + g.width, g.x + g.width / 2];
    const ys = [g.y, g.y + g.height, g.y + g.height / 2];
    for (const other of panels.values()) {
        if (movingIds.has(other.id)) continue;
        const o = other.getRenderedGeometry();
        const top = Math.min(g.y, o.y);
        const bottom = Math.max(g.y + g.height, o.y + o.height);
        const left = Math.min(g.x, o.x);
        const right = Math.max(g.x + g.width, o.x + o.width);
        for (const ox of [o.x, o.x + o.width, o.x + o.width / 2]) {
            if (xs.some((x) => Math.abs(x - ox) <= GUIDE_TOLERANCE)) lines.push({ axis: 'x', at: ox, from: top, to: bottom });
        }
        for (const oy of [o.y, o.y + o.height, o.y + o.height / 2]) {
            if (ys.some((y) => Math.abs(y - oy) <= GUIDE_TOLERANCE)) lines.push({ axis: 'y', at: oy, from: left, to: right });
        }
    }
    return lines;
}

export function setShowGrid(show) {
    setShowGridFlag(show);
    applyGrid();
}

export function getShowGrid() {
    return isShowGrid();
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
// Changing the background image variable is a binding change (its preset
// may need activating, and its image must be watched).
export function updatePanelStyle(panel, patch) {
    const before = panel.record.style?.backgroundImageVariable ?? null;
    const style = { ...panel.record.style };
    for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === undefined) delete style[key];
        else style[key] = value;
    }
    const updated = updatePanelRecord(panel.id, { style });
    if (updated) panel.update(updated);
    const after = style.backgroundImageVariable ?? null;
    if (before !== after) emitBindingsChange(after ? [after] : []);
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
    document.body.classList.toggle('pp-show-grid', isShowGrid());
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
    setSelection([]);
}

// Restores every panel stored in the registry (if enabled). Idempotent.
export function initPanels() {
    if (initialized) return;
    initialized = true;

    // Editing Mode can never be on while the extension is disabled, even
    // if a stale saved setting says otherwise.
    if (!isEnabled() && isEditingMode()) setEditingModeFlag(false);
    if (isEnabled()) mountAllPanels();
    if (!document.querySelector('.pp-grid-overlay')) {
        const overlay = document.createElement('div');
        overlay.className = 'pp-grid-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
    }
    applyGrid();
    applyState();

    onValuesChange(() => {
        for (const panel of panels.values()) panel.renderValues();
    });
    // Fonts arriving (the curated manifest, an upload, an import) change
    // what an element's font id resolves to.
    fontRegistry.onChange(() => {
        for (const panel of panels.values()) panel.renderValues();
    });
    void fontRegistry.load();

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
    setSelection(selection.filter((x) => x !== id));
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

// Adds an unbound element from the palette: free text ('free-text') or a
// shape ('rectangle' | 'ellipse'). `at` ({ x, y } in body coordinates,
// its top-left) defaults to the panel's top-left corner. The new element
// is selected.
export function addPaletteElement(panel, kind, at = null) {
    if (!panel.canEdit()) {
        notify('warning', 'Unlock this panel (and turn on Editing Mode) to add elements to it.');
        return null;
    }
    const grid = panel.gridSize() || 1;
    const bodyWidth = panel.body.clientWidth || panel.record.width;
    const bodyHeight = panel.body.clientHeight || panel.record.height;
    const type = kind === ELEMENT_TYPE_FREE_TEXT ? ELEMENT_TYPE_FREE_TEXT : ELEMENT_TYPE_SHAPE;
    const [defaultW, defaultH] = DEFAULT_TYPE_SIZES[type];
    const width = Math.max(24, Math.min(defaultW, bodyWidth));
    const height = Math.max(16, Math.min(defaultH, bodyHeight));
    const x = Math.max(0, Math.min(Math.round(at ? softSnap(at.x, grid) : 0), bodyWidth - width));
    const y = Math.max(0, Math.min(Math.round(at ? softSnap(at.y, grid) : 0), bodyHeight - height));
    const element = type === ELEMENT_TYPE_FREE_TEXT
        ? createVariableElement({ type, x, y, width, height, content: 'Text', showLabel: false })
        : createVariableElement({ type, x, y, width, height, shape: { kind } });
    saveWidgets(panel, [...panel.record.widgets, element]);
    panel.selectElement(element.id);
    return element;
}

// Drops a palette item onto a panel, centred on the pointer.
export function dropPaletteElementAt(kind, clientX, clientY) {
    const target = dropTargetAt(clientX, clientY);
    if (!target) return false;
    const { panel } = target;
    if (!panel.canEdit()) {
        notify('warning', 'Unlock this panel to change its elements.');
        return false;
    }
    const rect = panel.body.getBoundingClientRect();
    const [w, h] = DEFAULT_TYPE_SIZES[kind === ELEMENT_TYPE_FREE_TEXT ? ELEMENT_TYPE_FREE_TEXT : ELEMENT_TYPE_SHAPE];
    addPaletteElement(panel, kind, {
        x: clientX - rect.left + panel.body.scrollLeft - w / 2,
        y: clientY - rect.top + panel.body.scrollTop - h / 2,
    });
    panel.openProperties('element');
    return true;
}

// Moves an element within the panel's stacking order: 'back' | 'backward'
// | 'forward' | 'front'. Shapes always stay behind other elements
// (panel.js), so this orders shapes among shapes and the rest among the rest.
export function arrangeElement(panel, elementId, action) {
    const widgets = [...panel.record.widgets];
    const index = widgets.findIndex((w) => w.id === elementId);
    if (index < 0) return false;
    const [element] = widgets.splice(index, 1);
    const peers = widgets
        .map((w, i) => ({ w, i }))
        .filter(({ w }) => isVariableElement(w) && isShapeElement(w) === isShapeElement(element));
    const before = peers.filter(({ i }) => i < index);
    const after = peers.filter(({ i }) => i >= index);
    let at = index;
    if (action === 'back') at = before.length ? before[0].i : index;
    else if (action === 'backward') at = before.length ? before[before.length - 1].i : index;
    else if (action === 'forward') at = after.length ? after[0].i + 1 : index;
    else if (action === 'front') at = after.length ? after[after.length - 1].i + 1 : index;
    widgets.splice(at, 0, element);
    if (at === index) return false;
    saveWidgets(panel, widgets);
    return true;
}

// What a variable dragged to (clientX, clientY) would land on:
// { panel, elementId } (rebind) or { panel } (new element), or null.
// A shape is never a rebind target - dropping on one adds an element.
export function dropTargetAt(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY);
    const panelEl = hit?.closest?.('.pp-panel');
    const panel = panelEl ? panels.get(panelEl.dataset.panelId) : null;
    if (!panel) return null;
    const elementEl = hit.closest('.pp-element');
    if (!elementEl || !panel.el.contains(elementEl) || elementEl.classList.contains('pp-kind-shape')) return { panel };
    return { panel, elementId: elementEl.dataset.elementId };
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
        if (selection.length) setSelection([]);
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
