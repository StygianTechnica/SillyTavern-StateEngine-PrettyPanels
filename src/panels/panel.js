// One Pretty Panel = one independent DOM element appended directly to
// <body>, with its OWN drag logic, resize logic, edit affordance and
// properties popup. Panels never share a container and never know about
// each other - panel-manager.js owns the collection and the registry.
//
// A Panel holds a working copy of its record for rendering; it reports
// committed geometry changes back through `hooks` rather than writing
// to the registry itself, so persistence stays in one place.

import { MIN_PANEL_WIDTH, MIN_PANEL_HEIGHT } from '../storage/design.js';
import { PanelPropertiesPopup } from './properties-popup.js';

// Keep at least this much of a panel on-screen so it can always be
// grabbed again after a window resize.
const VISIBLE_MARGIN = 40;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

export class Panel {
    // hooks: {
    //   onGeometryCommit(panel, { x, y, width, height }),
    //   onLockChange(panel, locked),
    //   onDeleteRequest(panel),
    //   onFocus(panel),
    //   onSaveTemplateRequest(panel),
    //   onExportTemplateRequest(panel),
    // }
    constructor(record, hooks) {
        this.record = { ...record };
        this.hooks = hooks;
        this.popup = null;
        this.el = this.#build();
        this.#bindDrag();
        this.#bindResize();
        this.#bindEditAffordance();
        this.applyRecord();
    }

    get id() {
        return this.record.id;
    }

    mount() {
        document.body.appendChild(this.el);
    }

    destroy() {
        this.closeProperties();
        this.el.remove();
    }

    // Re-renders geometry and lock state from this.record. Geometry is
    // clamped to the viewport for DISPLAY only - the stored record is
    // left alone, so a panel placed on a large monitor returns to its
    // real spot when the window grows again.
    applyRecord() {
        const { x, y, width, height, locked } = this.record;
        const pos = this.#clampPosition(x, y, width);
        Object.assign(this.el.style, {
            left: `${pos.x}px`,
            top: `${pos.y}px`,
            width: `${width}px`,
            height: `${height}px`,
        });
        this.el.classList.toggle('pp-locked', locked);
        this.el.querySelector('.pp-panel-edit').title = locked ? 'Panel properties (locked)' : 'Panel properties';
        this.popup?.refresh();
    }

    // Replaces the working copy after the registry accepted a change.
    update(record) {
        this.record = { ...record };
        this.applyRecord();
    }

    setZIndex(z) {
        this.el.style.zIndex = String(z);
    }

    openProperties() {
        if (!this.popup) {
            this.popup = new PanelPropertiesPopup(this, {
                onLockToggle: (locked) => this.hooks.onLockChange(this, locked),
                onDelete: () => this.hooks.onDeleteRequest(this),
                onSaveTemplate: () => this.hooks.onSaveTemplateRequest(this),
                onExportTemplate: () => this.hooks.onExportTemplateRequest(this),
                onClose: () => { this.popup = null; },
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
        return {
            x: Math.round(parseFloat(this.el.style.left) || 0),
            y: Math.round(parseFloat(this.el.style.top) || 0),
            width: Math.round(parseFloat(this.el.style.width) || this.record.width),
            height: Math.round(parseFloat(this.el.style.height) || this.record.height),
        };
    }

    #build() {
        const el = document.createElement('div');
        el.className = 'pp-panel';
        el.dataset.panelId = this.record.id;
        el.innerHTML = `
            <div class="pp-panel-drag-handle" title="Drag to move"></div>
            <div class="pp-panel-body"></div>
            <button type="button" class="pp-panel-edit" aria-label="Panel properties"></button>
            <div class="pp-panel-resize-handle" title="Drag to resize"></div>
        `;
        el.addEventListener('pointerdown', () => this.hooks.onFocus(this), true);
        return el;
    }

    #clampPosition(x, y, width) {
        const maxX = window.innerWidth - Math.min(width, VISIBLE_MARGIN);
        const maxY = window.innerHeight - VISIBLE_MARGIN;
        return { x: clamp(x, 0, maxX), y: clamp(y, 0, maxY) };
    }

    #canEdit() {
        return document.body.classList.contains('pp-editing') && !this.record.locked;
    }

    // Shared pointer-drag plumbing for move and resize: captures the
    // pointer on `handle`, calls onMove(dx, dy) as it moves, and commits
    // the rendered geometry once on release.
    #trackPointer(handle, onStart, onMove) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.#canEdit()) return;
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            onStart();
            handle.setPointerCapture(e.pointerId);
            this.el.classList.add('pp-interacting');

            const move = (ev) => {
                onMove(ev.clientX - startX, ev.clientY - startY);
                this.popup?.refresh(this.getRenderedGeometry());
            };
            const end = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                this.el.classList.remove('pp-interacting');
                this.hooks.onGeometryCommit(this, this.getRenderedGeometry());
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    #bindDrag() {
        const handle = this.el.querySelector('.pp-panel-drag-handle');
        let origin;
        this.#trackPointer(
            handle,
            () => { origin = this.getRenderedGeometry(); },
            (dx, dy) => {
                const pos = this.#clampPosition(origin.x + dx, origin.y + dy, origin.width);
                this.el.style.left = `${pos.x}px`;
                this.el.style.top = `${pos.y}px`;
            },
        );
    }

    #bindResize() {
        const handle = this.el.querySelector('.pp-panel-resize-handle');
        let origin;
        this.#trackPointer(
            handle,
            () => { origin = this.getRenderedGeometry(); },
            (dx, dy) => {
                const width = clamp(origin.width + dx, MIN_PANEL_WIDTH, window.innerWidth - origin.x);
                const height = clamp(origin.height + dy, MIN_PANEL_HEIGHT, window.innerHeight - origin.y);
                this.el.style.width = `${width}px`;
                this.el.style.height = `${height}px`;
            },
        );
    }

    #bindEditAffordance() {
        const button = this.el.querySelector('.pp-panel-edit');
        button.addEventListener('pointerdown', (e) => e.stopPropagation());
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!document.body.classList.contains('pp-editing')) return;
            if (this.popup) this.closeProperties();
            else this.openProperties();
        });
    }
}
