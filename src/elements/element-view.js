// One VariableElement on screen, inside its panel's body. Owns its own
// drag and resize (Editing Mode, unlocked panel only), with soft snap to
// the panel grid. A press that doesn't move is a CLICK - it selects the
// element and opens its properties; a drag never does. While one element
// is dragged, every OTHER element in the panel shows a faint outline, and
// the live geometry is reported so the properties fields follow along.
//
// Like Panel, it reports committed changes through its panel's hooks
// rather than writing anything itself.

import {
    MIN_ELEMENT_WIDTH, MIN_ELEMENT_HEIGHT, ELEMENT_TYPE_TEXT, ELEMENT_TYPE_SHAPE, ELEMENT_TYPE_FREE_TEXT, elementLabel,
} from './element-model.js';
import { renderWidget } from './widgets.js';
import { renderShape } from './shapes.js';
import { formatValue } from './formats.js';
import { applyElementStyle } from './element-style.js';
import { softSnap } from '../panels/snap.js';

// Pointer travel (px) before a press becomes a drag instead of a click.
const DRAG_THRESHOLD = 3;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

// Fills `container` (built by buildElementContent()) with an element: a
// text element's label, icon and formatted value (styled by Element
// Styling), free text (the element's own `content`, same styling), a
// bar/gauge widget (src/elements/widgets.js), or a shape
// (src/elements/shapes.js). `entry` is
// the variable service's { value, def } or undefined. Shared by the
// on-panel view and the properties-pane preview.
export function renderElementContent(container, element, entry) {
    const labelEl = container.querySelector('.pp-element-label');
    const valueEl = container.querySelector('.pp-element-value');
    const def = entry?.def ?? null;

    container.classList.remove('pp-kind-image');
    container.classList.toggle('pp-kind-shape', element.type === ELEMENT_TYPE_SHAPE);
    if (element.type === ELEMENT_TYPE_SHAPE) {
        container.classList.remove('pp-kind-widget', 'pp-element-unbound', 'pp-element-missing');
        applyElementStyle(container, {});
        container.title = 'Shape';
        renderShape(container, element);
        return;
    }
    container.classList.toggle('pp-kind-free-text', element.type === ELEMENT_TYPE_FREE_TEXT);
    if (element.type === ELEMENT_TYPE_FREE_TEXT) {
        container.classList.remove('pp-kind-widget', 'pp-element-unbound', 'pp-element-missing');
        labelEl.hidden = true;
        applyElementStyle(container, element.style);
        valueEl.textContent = element.content || '';
        container.classList.toggle('pp-element-empty', !element.content);
        container.title = 'Free text';
        return;
    }
    if (element.type !== ELEMENT_TYPE_TEXT) {
        container.classList.add('pp-kind-widget');
        applyElementStyle(container, {}); // text styling never applies to widgets
        container.classList.toggle('pp-element-unbound', !element.binding);
        container.classList.toggle('pp-element-missing', !!element.binding && entry === undefined);
        container.title = !element.binding
            ? 'Unbound - drag a variable onto this element to bind it'
            : `${element.binding.name}${entry === undefined ? ': no value in this chat (is its preset active?)' : ''}`;
        renderWidget(container, element, entry);
        return;
    }
    container.classList.remove('pp-kind-widget');

    labelEl.textContent = elementLabel(element, def);
    labelEl.hidden = !element.showLabel;
    applyElementStyle(container, element.style, entry?.value);

    valueEl.replaceChildren();
    container.classList.remove('pp-element-missing', 'pp-element-unbound');
    if (!element.binding) {
        container.classList.add('pp-element-unbound');
        valueEl.textContent = '—';
        container.title = 'Unbound - drag a variable onto this element to bind it';
        return;
    }
    if (entry === undefined) {
        container.classList.add('pp-element-missing');
        valueEl.textContent = '—';
        container.title = `${element.binding.name}: no value in this chat (is its preset active?)`;
        return;
    }
    container.title = element.role ? `${element.binding.name} (${element.role})` : element.binding.name;
    const shown = formatValue(entry.value, def, element.format, element.formatPattern);
    if (shown.image) {
        const img = document.createElement('img');
        img.src = shown.image;
        img.alt = elementLabel(element, def);
        img.draggable = false;
        valueEl.appendChild(img);
        applyImageStyle(container, element);
    } else {
        valueEl.textContent = shown.text;
    }
}

// Image variable elements: opacity, fit and clipping of the <img>, as CSS
// variables/classes on the element (style.css "Image variable elements").
// A rectangle or ellipse clip always covers the element; no clip uses the
// element's fit - or, for elements saved before fit existed, the image's
// natural size scaled down to fit (the original look).
function applyImageStyle(container, element) {
    const clip = element.clipShape ?? 'none';
    const fit = clip === 'none' ? element.fit : 'cover';
    container.classList.add('pp-kind-image');
    container.classList.toggle('pp-image-fill', !!fit);
    const set = (prop, v) => (v === null ? container.style.removeProperty(prop) : container.style.setProperty(prop, v));
    set('--pp-img-opacity', Number.isFinite(element.opacity) ? String(element.opacity) : null);
    set('--pp-img-fit', fit ?? null);
    set('--pp-img-radius', clip === 'rectangle' ? `${element.borderRadius ?? 0}px` : null);
    set('--pp-img-clip', clip === 'ellipse' ? 'ellipse(50% 50% at 50% 50%)' : null);
}

export function buildElementContent() {
    const el = document.createElement('div');
    el.className = 'pp-element';
    el.innerHTML = '<div class="pp-shape"></div><span class="pp-element-label"></span><i class="pp-element-icon" hidden></i><span class="pp-element-value"></span><div class="pp-widget"></div>';
    return el;
}

export class ElementView {
    // panel: the owning Panel (canEdit(), gridSize(), elementViews,
    // hooks.getValue, hooks.onElementCommit, hooks.onElementDragging,
    // hooks.onElementClick).
    constructor(panel, element) {
        this.panel = panel;
        this.element = element;
        this.el = buildElementContent();
        this.el.dataset.elementId = element.id;
        this.el.insertAdjacentHTML('beforeend', '<div class="pp-element-resize" title="Drag to resize"></div>');
        this.#bindMove();
        this.#bindResize();
        this.update(element);
    }

    get id() {
        return this.element.id;
    }

    update(element) {
        this.element = element;
        Object.assign(this.el.style, {
            left: `${element.x}px`,
            top: `${element.y}px`,
            width: `${element.width}px`,
            height: `${element.height}px`,
        });
        this.el.dataset.role = element.role;
        this.render();
    }

    render() {
        const entry = this.element.binding ? this.panel.hooks.getValue(this.element.binding.name) : undefined;
        renderElementContent(this.el, this.element, entry);
    }

    setSelected(selected) {
        this.el.classList.toggle('pp-element-selected', selected);
    }

    destroy() {
        this.el.remove();
    }

    // Outlines the panel's other elements for the duration of a drag.
    #outlineOthers(on) {
        for (const view of this.panel.elementViews.values()) {
            if (view !== this) view.el.classList.toggle('pp-element-outline', on);
        }
    }

    #geometry() {
        return {
            x: Math.round(parseFloat(this.el.style.left) || 0),
            y: Math.round(parseFloat(this.el.style.top) || 0),
            width: Math.round(parseFloat(this.el.style.width) || this.element.width),
            height: Math.round(parseFloat(this.el.style.height) || this.element.height),
        };
    }

    // Press/drag plumbing shared by move and resize. onDrag(dx, dy) runs
    // once the pointer has travelled DRAG_THRESHOLD; a release before that
    // is a click (only for the move handle - `onClick`).
    #track(handle, onDrag, onClick) {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !document.body.classList.contains('pp-editing')) return;
            e.preventDefault();
            e.stopPropagation();
            const editable = this.panel.canEdit();
            const startX = e.clientX;
            const startY = e.clientY;
            const origin = this.#geometry();
            let dragging = false;
            handle.setPointerCapture(e.pointerId);

            const move = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;
                if (!dragging) {
                    if (!editable || Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                    dragging = true;
                    this.el.classList.add('pp-element-dragging');
                    this.#outlineOthers(true);
                }
                onDrag(origin, dx, dy);
                this.panel.hooks.onElementDragging(this.panel, this.id, this.#geometry());
            };
            const end = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', end);
                handle.removeEventListener('pointercancel', end);
                this.el.classList.remove('pp-element-dragging');
                if (dragging) {
                    this.#outlineOthers(false);
                    const geometry = this.#geometry();
                    const { x, y, width, height } = this.element;
                    if (geometry.x !== x || geometry.y !== y || geometry.width !== width || geometry.height !== height) {
                        this.panel.hooks.onElementCommit(this.panel, this.id, geometry);
                    }
                } else if (onClick) {
                    onClick();
                }
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', end);
            handle.addEventListener('pointercancel', end);
        });
    }

    #bindMove() {
        this.#track(this.el, (origin, dx, dy) => {
            const body = this.panel.body;
            const grid = this.panel.gridSize();
            const maxX = body.clientWidth - origin.width;
            const maxY = body.clientHeight - origin.height;
            const x = clamp(softSnap(origin.x + dx, grid), 0, maxX);
            const y = clamp(softSnap(origin.y + dy, grid), 0, maxY);
            this.el.style.left = `${Math.round(x)}px`;
            this.el.style.top = `${Math.round(y)}px`;
        }, () => this.panel.hooks.onElementClick(this.panel, this.id));
    }

    #bindResize() {
        const handle = this.el.querySelector('.pp-element-resize');
        this.#track(handle, (origin, dx, dy) => {
            const body = this.panel.body;
            const grid = this.panel.gridSize();
            // Snap the far edges, not the size, so edges line up on the grid.
            const right = softSnap(origin.x + origin.width + dx, grid);
            const bottom = softSnap(origin.y + origin.height + dy, grid);
            const width = clamp(right - origin.x, MIN_ELEMENT_WIDTH, body.clientWidth - origin.x);
            const height = clamp(bottom - origin.y, MIN_ELEMENT_HEIGHT, body.clientHeight - origin.y);
            this.el.style.width = `${Math.round(width)}px`;
            this.el.style.height = `${Math.round(height)}px`;
        }, null);
    }
}
