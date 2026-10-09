// One Pretty Panel = one independent DOM element appended directly to
// <body>, with its OWN drag logic, resize logic, edit affordance,
// elements and properties popup. Panels never share a container and
// never know about each other - panel-manager.js owns the collection and
// the registry.
//
// A Panel holds a working copy of its record for rendering; it reports
// committed changes back through `hooks` rather than writing to the
// registry itself, so persistence stays in one place.
//
// Moving and resizing soft-snap to the layout grid (src/panels/snap.js);
// the panel canvas is the grid its elements snap to. DOM:
//   .pp-panel (stored bounds) > .pp-panel-box (visible, Panel Styling)
//     > .pp-panel-body (padding) > .pp-panel-canvas (elements; `this.body`)

import { MIN_PANEL_WIDTH, MIN_PANEL_HEIGHT } from '../storage/design.js';
import { isVariableElement } from '../elements/element-model.js';
import { ElementView } from '../elements/element-view.js';
import { PanelPropertiesPopup } from './properties-popup.js';
import { softSnap, softSnapSpan } from './snap.js';
import { applyPanelTheme } from '../themes/theme-apply.js';
import { fitCompact, collapsedBox, openBox, drawerKey, isDrawerOpen, toggleDrawer } from './drawer.js';
import { currentChatId } from '../chat/variable-service.js';

// Must match panel-manager.js BASE_Z_INDEX (not imported: panel-manager
// imports this module).
const BASE_Z_INDEX = 100;

// Keep at least this much of a panel on-screen so it can always be
// grabbed again after a window resize.
const VISIBLE_MARGIN = 40;

// An open drawer is raised above the other panels by this much.
const DRAWER_RAISE = 500;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

export class Panel {
    // hooks: {
    //   onGeometryCommit(panel, { x, y, width, height }),
    //   onLockChange(panel, locked),
    //   onDeleteRequest(panel),
    //   onSaveTemplateRequest(panel),
    //   onExportTemplateRequest(panel),
    //   getGrid() -> { snap, size },
    //   getValue(variableName) -> { value, def } | undefined,
    //   getImage(variableName) -> display-safe image source | null,
    //   onElementCommit(panel, elementId, patch),
    //   onElementDragging(panel, elementId, { x, y, width, height }),
    //   onElementClick(panel, elementId),
    //   onZIndexChange(panel, zIndex),
    //   onRestack(panel, 'forward' | 'backward' | 'front' | 'back'),
    //   onStyleChange(panel, stylePatch),
    //   onThemeChange(panel, { themeId?, themeVariant? }),
    //   onPanelClockChange(panel, { showSecondsHand? }),
    //   onCompactChange(panel, { x, y, width, height, keepOnScreen } | null),
    //   onElementDelete(panel, elementId), onElementDuplicate(panel, elementId),
    //   onAddVariable(panel, variableName),
    //   onDropVariable(variableName, clientX, clientY),
    //   dropTargetAt(clientX, clientY) -> { panel, elementId? } | null,
    //   onPanelPress(panel, additive), onPanelClick(panel, additive),
    //   getGroupPeers(panel) -> Panel[],
    //   onPanelDragging(panel, geometry, movingIds, pointer), onPanelDragEnd(panel, moved),
    //   placePanel(panel) -> true when the panel is docked into SillyTavern's
    //     layout at its anchor (anchors.js); false = position it freely,
    //   onDragBegin(panel) - a drag really started (undocks a docked panel),
    //   onAnchorChange(panel, patch),
    // }
    constructor(record, hooks) {
        this.record = { ...record };
        this.hooks = hooks;
        this.popup = null;
        this.selectedElementId = null;
        this.elementViews = new Map();
        // Which properties sections are expanded - kept for as long as the
        // panel is on screen, so reopening its properties looks the same.
        // The styling subsections start collapsed to keep the pane short.
        this.openSections = { panel: true, panelStyle: false, element: true, elementStyle: false, widget: true, variables: true };
        this.el = this.#build();
        // Where elements live and what they're positioned/clamped against.
        this.body = this.el.querySelector('.pp-panel-canvas');
        // Pressing the panel's empty area selects it (elements stop their
        // own presses). Works for locked panels too - they can be aligned
        // against, just never moved.
        this.body.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !document.body.classList.contains('pp-editing') || e.target.closest('.pp-element')) return;
            const additive = e.ctrlKey || e.shiftKey || e.metaKey;
            this.hooks.onPanelPress(this, additive);
            this.hooks.onPanelClick(this, additive);
        });
        this.#bindDrag();
        this.#bindResize();
        this.#bindEditAffordance();
        this.applyRecord();
    }

    get id() {
        return this.record.id;
    }

    mount() {
        this.mounted = true;
        document.body.appendChild(this.el);
        this.applyPosition();
    }

    // Docked into SillyTavern's layout at an anchor (not floating).
    get docked() {
        return this.el.classList.contains('pp-docked');
    }

    destroy() {
        this.closeProperties();
        this.el.remove();
    }

    // Re-renders geometry, lock state and elements from this.record.
    // Geometry is clamped to the viewport for DISPLAY only - the stored
    // record is left alone, so a panel placed on a large monitor returns
    // to its real spot when the window grows again.
    applyRecord() {
        const { width, height, locked } = this.record;
        Object.assign(this.el.style, { width: `${width}px`, height: `${height}px` });
        this.applyPosition();
        this.el.classList.toggle('pp-locked', locked);
        this.el.style.zIndex = String(BASE_Z_INDEX + this.record.zIndex);
        this.#applyStyle();
        this.el.querySelector('.pp-panel-edit').title = locked ? 'Panel properties (locked)' : 'Panel properties';
        this.#renderElements();
        this.popup?.refresh();
    }

    // Places the panel: docked into SillyTavern's layout when it is
    // anchored and its anchor exists (the manager moves it there), else
    // floating at its stored x/y. Then its drawer, if it has one.
    applyPosition() {
        this.#clearDrawerOverlay();
        if (!(this.mounted && this.hooks.placePanel?.(this))) {
            const pos = this.#clampPosition(this.record.x, this.record.y, this.record.width);
            this.el.style.left = `${pos.x}px`;
            this.el.style.top = `${pos.y}px`;
        }
        this.#applyDrawer();
    }

    // ---- drawer (src/panels/drawer.js) --------------------------------------

    #drawerKey() {
        return drawerKey(currentChatId(), 'panel', this.record.id);
    }

    isDrawerOpen() {
        return !!this.record.compact && isDrawerOpen(this.#drawerKey());
    }

    // 'full' (no compact area, or Editing Mode: the whole design shows),
    // 'collapsed' or 'open'.
    drawerState() {
        if (!this.record.compact || document.body.classList.contains('pp-editing')) return 'full';
        return this.isDrawerOpen() ? 'open' : 'collapsed';
    }

    // A Drawer Toggle was clicked.
    toggleDrawer() {
        if (!this.record.compact) return;
        toggleDrawer(this.#drawerKey());
        this.applyPosition();
        for (const view of this.elementViews.values()) view.render();
    }

    // The box's insets around its canvas (margin, border, padding).
    #chrome() {
        const box = this.el.getBoundingClientRect();
        const canvas = this.body.getBoundingClientRect();
        return {
            left: Math.round(canvas.left - box.left),
            top: Math.round(canvas.top - box.top),
            right: Math.round(box.right - canvas.right),
            bottom: Math.round(box.bottom - canvas.bottom),
        };
    }

    // Sizes and places the panel for its drawer state. Collapsed: a box the
    // size of the compact area, at the area's place on screen, its elements
    // shifted so the area shows. Open: the whole design laid around that
    // place (kept on screen), raised; a docked panel leaves a placeholder
    // in SillyTavern's layout and floats over it. In Editing Mode the whole
    // design shows, with the compact area outlined.
    #applyDrawer() {
        const { compact, width, height } = this.record;
        const state = this.drawerState();
        this.el.classList.toggle('pp-drawer-collapsed', state === 'collapsed');
        this.el.classList.toggle('pp-drawer-open', state === 'open');
        this.el.style.zIndex = String(BASE_Z_INDEX + this.record.zIndex + (state === 'open' ? DRAWER_RAISE : 0));
        const row = this.el.classList.contains('pp-docked-row');
        if (!row) this.el.style.width = `${width}px`;
        this.el.style.height = `${height}px`;
        this.#renderCompactOutline(compact && state === 'full' && document.body.classList.contains('pp-editing') ? compact : null);
        if (state === 'full' || !this.el.isConnected) return;

        const chrome = this.#chrome();
        const fullWidth = row ? Math.round(this.el.getBoundingClientRect().width) : width;
        const area = fitCompact(compact, fullWidth - chrome.left - chrome.right, height - chrome.top - chrome.bottom);
        this.el.style.setProperty('--pp-compact-x', `${area.x}px`);
        this.el.style.setProperty('--pp-compact-y', `${area.y}px`);
        const small = collapsedBox({ x: 0, y: 0 }, chrome, area);

        if (this.docked) {
            // Collapsed in the layout. Open, it floats from <body> (inside
            // SillyTavern's layout a fixed box can be placed against the
            // wrong container) over a placeholder that keeps its place; the
            // next placement (the manager's placePanel) docks it again.
            if (!row) this.el.style.width = `${small.width}px`;
            this.el.style.height = `${small.height}px`;
            if (state === 'open') {
                const rect = this.el.getBoundingClientRect();
                const placeholder = document.createElement('div');
                placeholder.className = 'pp-drawer-placeholder';
                Object.assign(placeholder.style, { width: `${rect.width}px`, height: `${rect.height}px` });
                this.el.before(placeholder);
                this.drawerPlaceholder = placeholder;
                const box = openBox({ x: rect.left, y: rect.top }, area, fullWidth, height, window.innerWidth, window.innerHeight);
                this.el.classList.add('pp-drawer-floating');
                this.el.style.setProperty('--pp-float-x', `${box.x}px`);
                this.el.style.setProperty('--pp-float-y', `${box.y}px`);
                this.el.style.setProperty('--pp-float-w', `${fullWidth}px`);
                this.el.style.setProperty('--pp-float-z', String(BASE_Z_INDEX + this.record.zIndex + DRAWER_RAISE));
                this.el.style.height = `${height}px`;
                document.body.appendChild(this.el);
            }
            return;
        }
        const at = this.#clampPosition(this.record.x + area.x, this.record.y + area.y, small.width);
        if (state === 'collapsed') {
            Object.assign(this.el.style, { left: `${at.x}px`, top: `${at.y}px`, width: `${small.width}px`, height: `${small.height}px` });
        } else {
            const box = openBox(at, area, width, height, window.innerWidth, window.innerHeight);
            Object.assign(this.el.style, { left: `${box.x}px`, top: `${box.y}px` });
        }
    }

    #clearDrawerOverlay() {
        // Back where it was docked (keeping its order among the anchor's panels).
        if (this.drawerPlaceholder?.isConnected) this.drawerPlaceholder.replaceWith(this.el);
        this.drawerPlaceholder = null;
        if (this.el.classList.contains('pp-drawer-floating')) {
            this.el.classList.remove('pp-drawer-floating');
            for (const prop of ['--pp-float-x', '--pp-float-y', '--pp-float-w', '--pp-float-z']) this.el.style.removeProperty(prop);
        }
    }

    // The compact area's dashed outline on the canvas (Editing Mode).
    #renderCompactOutline(compact) {
        let outline = this.body.querySelector(':scope > .pp-compact-outline');
        if (!compact) {
            outline?.remove();
            return;
        }
        if (!outline) {
            outline = document.createElement('div');
            outline.className = 'pp-compact-outline';
            outline.innerHTML = '<span>Compact area</span>';
        }
        this.body.appendChild(outline);
        Object.assign(outline.style, { left: `${compact.x}px`, top: `${compact.y}px`, width: `${compact.width}px`, height: `${compact.height}px` });
    }

    // Replaces the working copy after the registry accepted a change.
    update(record) {
        this.record = { ...record };
        this.applyRecord();
    }

    // Theme + variant + Panel Styling, with the background image variable
    // (if any) resolved. Remembers the theme for the elements' rendering.
    #applyStyle() {
        const name = this.record.style?.backgroundImageVariable;
        const { theme, variantName, variant } = applyPanelTheme(this.el, this.record, name ? this.hooks.getImage(name) : undefined);
        this.theme = theme;
        this.themeVariant = variantName;
        this.variantDef = variant;
    }

    // What this panel's analog clocks inherit (their seconds hand): its
    // variant's default and its own override.
    clockContext() {
        return { variant: this.variantDef, panelClock: this.record.clock };
    }

    // Re-renders variable-driven content only (after the variable service
    // updated): element values and a variable background image.
    renderValues() {
        // The open / closed state is per chat: a chat switch may change it.
        const key = this.#drawerKey();
        if (this.record.compact && key !== this.lastDrawerKey) this.applyPosition();
        this.lastDrawerKey = key;
        this.#applyStyle();
        for (const view of this.elementViews.values()) view.render();
        this.popup?.refreshElementPreview();
    }

    getElement(elementId) {
        return this.record.widgets.find((w) => w.id === elementId) ?? null;
    }

    selectElement(elementId) {
        const next = elementId && this.getElement(elementId) ? elementId : null;
        const changed = next !== this.selectedElementId;
        this.selectedElementId = next;
        // Selecting an element brings its properties back into view.
        if (changed && next) this.openSections.element = true;
        for (const view of this.elementViews.values()) view.setSelected(view.id === next);
        if (changed) this.popup?.refresh();
    }

    // Selection/group markers from the manager: `index` is this panel's
    // place in the selection (-1 = not selected, 0 = the reference panel).
    setSelectionState(index, grouped) {
        this.el.classList.toggle('pp-selected', index >= 0);
        this.el.classList.toggle('pp-selected-first', index === 0);
        this.el.classList.toggle('pp-grouped', grouped);
    }

    // Editing Mode is on and this panel isn't locked.
    canEdit() {
        return document.body.classList.contains('pp-editing') && !this.record.locked;
    }

    // Grid size for snapping, or 0 when snapping is off.
    gridSize() {
        const { snap, size } = this.hooks.getGrid();
        return snap ? size : 0;
    }

    // `focus` ('panel' | 'element') expands that section if it was
    // collapsed - opening from the panel's dot, or clicking an element.
    openProperties(focus = null) {
        if (focus) this.openSections[focus] = true;
        if (!this.popup) {
            this.popup = new PanelPropertiesPopup(this, {
                onLockToggle: (locked) => this.hooks.onLockChange(this, locked),
                onDelete: () => this.hooks.onDeleteRequest(this),
                onSaveTemplate: () => this.hooks.onSaveTemplateRequest(this),
                onExportTemplate: () => this.hooks.onExportTemplateRequest(this),
                onElementChange: (elementId, patch) => this.hooks.onElementCommit(this, elementId, patch),
                onZIndexChange: (zIndex) => this.hooks.onZIndexChange(this, zIndex),
                onRestack: (action) => this.hooks.onRestack(this, action),
                onAnchorChange: (patch) => this.hooks.onAnchorChange(this, patch),
                onPanelStyleChange: (patch) => this.hooks.onStyleChange(this, patch),
                onThemeChange: (patch) => this.hooks.onThemeChange(this, patch),
                onPanelClockChange: (clock) => this.hooks.onPanelClockChange(this, clock),
                onCompactChange: (compact) => this.hooks.onCompactChange(this, compact),
                onElementDelete: (elementId) => this.hooks.onElementDelete(this, elementId),
                onElementDuplicate: (elementId) => this.hooks.onElementDuplicate(this, elementId),
                onAddVariable: (name) => this.hooks.onAddVariable(this, name),
                onDropVariable: (name, x, y) => this.hooks.onDropVariable(name, x, y),
                onAddPaletteItem: (kind) => this.hooks.onAddPaletteItem(this, kind),
                onDropPaletteItem: (kind, x, y) => this.hooks.onDropPaletteItem(kind, x, y),
                onArrangeElement: (elementId, action) => this.hooks.onArrangeElement(this, elementId, action),
                dropTargetAt: (x, y) => this.hooks.dropTargetAt(x, y),
                getValue: (name) => this.hooks.getValue(name),
                onClose: () => {
                    this.popup = null;
                    this.selectElement(null);
                },
            });
        }
        this.popup.open();
    }

    closeProperties() {
        this.popup?.close();
        this.popup = null;
    }

    // Current on-screen geometry (what the user actually sees).
    getRenderedGeometry() {
        if (this.docked) {
            const rect = this.el.getBoundingClientRect();
            return { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
        }
        return {
            x: Math.round(parseFloat(this.el.style.left) || 0),
            y: Math.round(parseFloat(this.el.style.top) || 0),
            width: Math.round(parseFloat(this.el.style.width) || this.record.width),
            height: Math.round(parseFloat(this.el.style.height) || this.record.height),
        };
    }

    // Keeps one ElementView per VariableElement, reusing existing views.
    // DOM order is the stacking order: ascending zIndex, ties in stored
    // order (Array.prototype.sort is stable).
    #renderElements() {
        const elements = this.record.widgets
            .filter(isVariableElement)
            .map((element, index) => ({ element, index }))
            .sort((a, b) => (a.element.zIndex ?? 0) - (b.element.zIndex ?? 0) || a.index - b.index)
            .map(({ element }) => element);
        const keep = new Set(elements.map((e) => e.id));
        for (const [id, view] of this.elementViews) {
            if (!keep.has(id)) {
                view.destroy();
                this.elementViews.delete(id);
            }
        }
        for (const element of elements) {
            let view = this.elementViews.get(element.id);
            if (view) {
                view.update(element);
            } else {
                view = new ElementView(this, element);
                this.elementViews.set(element.id, view);
            }
            this.body.appendChild(view.el); // keeps DOM order = stacking order
        }
        this.selectElement(this.selectedElementId);
    }

    #build() {
        const el = document.createElement('div');
        el.className = 'pp-panel';
        el.dataset.panelId = this.record.id;
        el.innerHTML = `
            <div class="pp-panel-box">
                <div class="pp-panel-image" aria-hidden="true"></div>
                <div class="pp-panel-texture" aria-hidden="true"></div>
                <div class="pp-panel-accent" aria-hidden="true"></div>
                <div class="pp-panel-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
                <i class="pp-panel-lock fa-solid fa-lock" title="Locked"></i>
                <i class="pp-panel-group fa-solid fa-link" title="In a group - moves with its group"></i>
                <div class="pp-panel-drag-handle" title="Drag to move"></div>
                <div class="pp-panel-body"><div class="pp-panel-canvas"></div></div>
                <button type="button" class="pp-panel-edit" aria-label="Panel properties"></button>
                <div class="pp-panel-resize-handle" title="Drag to resize"></div>
            </div>
        `;
        return el;
    }

    #clampPosition(x, y, width) {
        const maxX = window.innerWidth - Math.min(width, VISIBLE_MARGIN);
        const maxY = window.innerHeight - VISIBLE_MARGIN;
        return { x: clamp(x, 0, maxX), y: clamp(y, 0, maxY) };
    }

    // Shared pointer-drag plumbing for move and resize: captures the
    // pointer on `handle`, calls onMove(dx, dy) as it moves, and commits
    // the rendered geometry once on release (then onEnd). With `select`,
    // the press also selects the panel (Ctrl/Shift/Cmd toggles), and a
    // release without movement counts as a click.
    #trackPointer(handle, { onStart, onMove, onEnd = null, select = false }) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.canEdit()) return;
            e.preventDefault();
            e.stopPropagation();
            const additive = e.ctrlKey || e.shiftKey || e.metaKey;
            if (select) this.hooks.onPanelPress(this, additive);
            const startX = e.clientX;
            const startY = e.clientY;
            let moved = false;
            onStart();
            handle.setPointerCapture(e.pointerId);
            this.el.classList.add('pp-interacting');

            const move = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!moved && Math.hypot(dx, dy) < 2) return;
                moved = true;
                onMove(dx, dy, ev);
                this.popup?.refresh(this.getRenderedGeometry());
            };
            const end = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                this.el.classList.remove('pp-interacting');
                this.hooks.onGeometryCommit(this, this.getRenderedGeometry());
                onEnd?.(moved);
                if (select && !moved) this.hooks.onPanelClick(this, additive);
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    // Shows this panel at (x, y) - clamped to the viewport like any panel
    // - without committing; used for group members moving along.
    previewPosition(x, y) {
        const pos = this.#clampPosition(x, y, this.record.width);
        this.el.style.left = `${Math.round(pos.x)}px`;
        this.el.style.top = `${Math.round(pos.y)}px`;
    }

    // Moving drags the whole group (unlocked members) and reports the
    // position for alignment guides.
    #bindDrag() {
        const handle = this.el.querySelector('.pp-panel-drag-handle');
        let origin;
        let peers = [];
        this.#trackPointer(handle, {
            select: true,
            onStart: () => {
                origin = null;
            },
            onMove: (dx, dy, ev) => {
                // Set up on the first real movement, so a plain click never
                // undocks an anchored panel.
                if (!origin) {
                    this.hooks.onDragBegin?.(this);
                    // Undocking moves the element in the DOM, which drops
                    // its pointer capture - take it back so the drag goes on.
                    if (!handle.hasPointerCapture(ev.pointerId)) handle.setPointerCapture(ev.pointerId);
                    origin = this.getRenderedGeometry();
                    peers = this.hooks.getGroupPeers(this).map((panel) => ({ panel, origin: panel.getRenderedGeometry() }));
                }
                const grid = this.gridSize();
                const x = softSnapSpan(origin.x + dx, origin.width, grid);
                const y = softSnapSpan(origin.y + dy, origin.height, grid);
                const pos = this.#clampPosition(x, y, origin.width);
                this.el.style.left = `${Math.round(pos.x)}px`;
                this.el.style.top = `${Math.round(pos.y)}px`;
                const shiftX = Math.round(pos.x) - origin.x;
                const shiftY = Math.round(pos.y) - origin.y;
                for (const peer of peers) peer.panel.previewPosition(peer.origin.x + shiftX, peer.origin.y + shiftY);
                this.hooks.onPanelDragging(this, this.getRenderedGeometry(), [this.id, ...peers.map((p) => p.panel.id)], { x: ev.clientX, y: ev.clientY });
            },
            onEnd: (moved) => {
                for (const peer of peers) this.hooks.onGeometryCommit(peer.panel, peer.panel.getRenderedGeometry());
                peers = [];
                this.hooks.onPanelDragEnd(this, moved);
            },
        });
    }

    #bindResize() {
        const handle = this.el.querySelector('.pp-panel-resize-handle');
        let origin;
        this.#trackPointer(handle, {
            onStart: () => { origin = this.getRenderedGeometry(); },
            onMove: (dx, dy) => {
                // Snap the far edges to the layout grid, not the size.
                const grid = this.gridSize();
                const right = softSnap(origin.x + origin.width + dx, grid);
                const bottom = softSnap(origin.y + origin.height + dy, grid);
                const width = clamp(right - origin.x, MIN_PANEL_WIDTH, window.innerWidth - origin.x);
                const height = clamp(bottom - origin.y, MIN_PANEL_HEIGHT, window.innerHeight - origin.y);
                // A panel docked in the chat column spans its width: only
                // its height can change.
                if (!this.el.classList.contains('pp-docked-row')) this.el.style.width = `${Math.round(width)}px`;
                this.el.style.height = `${Math.round(height)}px`;
            },
        });
    }

    #bindEditAffordance() {
        const button = this.el.querySelector('.pp-panel-edit');
        button.addEventListener('pointerdown', (e) => e.stopPropagation());
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!document.body.classList.contains('pp-editing')) return;
            if (this.popup) this.closeProperties();
            else this.openProperties('panel');
        });
    }
}
