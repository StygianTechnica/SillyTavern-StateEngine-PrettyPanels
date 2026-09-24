// The "Variables" list in a panel's properties: every State Engine
// variable, grouped by preset, filterable by name/label and by preset.
// Drag an entry onto a panel to add a VariableElement there, or onto an
// existing element to replace its binding; click an entry to add it to
// this panel. Pointer-based drag (works with touch as well as a mouse).

import { localName } from '../elements/element-model.js';

const DRAG_THRESHOLD = 4;

export class VariablePicker {
    // hooks: { onPick(name), onDrop(name, clientX, clientY), dropTargetAt(clientX, clientY) }
    constructor(hooks) {
        this.hooks = hooks;
        this.catalog = [];
        this.el = this.#build();
        this.search = this.el.querySelector('.pp-picker-search');
        this.presetSelect = this.el.querySelector('.pp-picker-preset');
        this.list = this.el.querySelector('.pp-picker-list');
        this.search.addEventListener('input', () => this.render());
        this.presetSelect.addEventListener('change', () => this.render());
    }

    setCatalog(presets) {
        this.catalog = presets.filter((p) => p.variables.length > 0);
        const selected = this.presetSelect.value;
        this.presetSelect.replaceChildren(new Option('All presets', ''));
        for (const preset of this.catalog) {
            this.presetSelect.add(new Option(`${preset.name} (${preset.namespace})`, preset.id));
        }
        this.presetSelect.value = this.catalog.some((p) => p.id === selected) ? selected : '';
        this.render();
    }

    render() {
        const query = this.search.value.trim().toLowerCase();
        const presetId = this.presetSelect.value;
        const matches = (def) => !query
            || def.name.toLowerCase().includes(query)
            || (def.label ?? '').toLowerCase().includes(query);

        const groups = [];
        for (const preset of this.catalog) {
            if (presetId && preset.id !== presetId) continue;
            const vars = preset.variables.filter(matches);
            if (vars.length > 0) groups.push({ preset, vars });
        }

        this.list.replaceChildren();
        if (groups.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'pp-picker-empty';
            empty.textContent = this.catalog.length === 0 ? 'No State Engine variables found.' : 'No variables match.';
            this.list.appendChild(empty);
            return;
        }
        for (const { preset, vars } of groups) {
            const heading = document.createElement('div');
            heading.className = 'pp-picker-group';
            heading.textContent = `${preset.name} · ${preset.namespace}`;
            if (preset.active === false) {
                heading.title = 'Not active in this chat - it will be activated when you use one of its variables.';
                heading.classList.add('pp-picker-inactive');
            }
            this.list.appendChild(heading);
            for (const def of vars) this.list.appendChild(this.#item(def));
        }
    }

    #item(def) {
        const item = document.createElement('div');
        item.className = 'pp-picker-item';
        item.dataset.name = def.name;
        item.title = `${def.name}${def.description ? `\n${def.description}` : ''}\nDrag onto a panel or element, or click to add here.`;
        item.innerHTML = '<span class="pp-picker-label"></span><span class="pp-picker-type"></span>';
        item.querySelector('.pp-picker-label').textContent = def.label || localName(def.name);
        item.querySelector('.pp-picker-type').textContent = def.type ?? '';
        this.#bindDrag(item, def);
        return item;
    }

    #bindDrag(item, def) {
        item.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            const startX = e.clientX;
            const startY = e.clientY;
            let ghost = null;
            let highlighted = null;
            item.setPointerCapture(e.pointerId);

            const highlight = (target) => {
                const el = target ? (target.elementId ? target.panel.el.querySelector(`[data-element-id="${target.elementId}"]`) : target.panel.el) : null;
                if (el === highlighted) return;
                highlighted?.classList.remove('pp-drop-target');
                el?.classList.add('pp-drop-target');
                highlighted = el;
            };
            const move = (ev) => {
                if (!ghost) {
                    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
                    ghost = document.createElement('div');
                    ghost.className = 'pp-picker-ghost';
                    ghost.textContent = def.label || localName(def.name);
                    document.body.appendChild(ghost);
                }
                ghost.style.left = `${ev.clientX + 10}px`;
                ghost.style.top = `${ev.clientY + 10}px`;
                highlight(this.hooks.dropTargetAt(ev.clientX, ev.clientY));
            };
            const end = (ev) => {
                item.removeEventListener('pointermove', move);
                item.removeEventListener('pointerup', end);
                item.removeEventListener('pointercancel', end);
                highlight(null);
                if (ghost) {
                    ghost.remove();
                    if (ev.type === 'pointerup') this.hooks.onDrop(def.name, ev.clientX, ev.clientY);
                } else if (ev.type === 'pointerup') {
                    this.hooks.onPick(def.name);
                }
            };
            item.addEventListener('pointermove', move);
            item.addEventListener('pointerup', end);
            item.addEventListener('pointercancel', end);
        });
    }

    #build() {
        const el = document.createElement('div');
        el.className = 'pp-picker';
        el.innerHTML = `
            <div class="pp-picker-controls">
                <input type="search" class="text_pole pp-picker-search" placeholder="Search variables…" aria-label="Search variables" />
                <select class="text_pole pp-picker-preset" aria-label="Filter by preset"></select>
            </div>
            <div class="pp-picker-list"></div>
            <small class="pp-picker-hint">Drag onto a panel to add it, or onto an element to rebind it. Click to add it to this panel.</small>
        `;
        return el;
    }
}
