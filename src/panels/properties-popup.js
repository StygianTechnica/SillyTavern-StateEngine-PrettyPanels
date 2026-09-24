// Properties popup for ONE panel. Each Panel owns its own instance
// (created on open, discarded on close), so several panels' popups can
// be open at once without sharing state. Sections:
//   - Panel: name, position and size (read-only), lock toggle, delete
//   - Panel Library: save this instance as a template, export it
//   - Variables: the variable picker (src/ui/variable-picker.js)
//   - Element: the selected element's Role, Binding, Show Label, Label
//     Override, Format, a live Preview, and delete
// Every change is reported through `hooks`; nothing is written here.

import { VariablePicker } from '../ui/variable-picker.js';
import { loadCatalog, getCatalog, findVariable } from '../chat/variable-service.js';
import { ROLE_SUGGESTIONS, elementLabel, localName } from '../elements/element-model.js';
import { formatsFor } from '../elements/formats.js';
import { buildElementContent, renderElementContent } from '../elements/element-view.js';

const POPUP_GAP = 8;

export class PanelPropertiesPopup {
    // hooks: { onLockToggle(locked), onDelete(), onSaveTemplate(), onExportTemplate(),
    //          onElementChange(elementId, patch), onElementDelete(elementId),
    //          onAddVariable(name), onDropVariable(name, x, y), dropTargetAt(x, y),
    //          getValue(name), onClose() }
    constructor(panel, hooks) {
        this.panel = panel;
        this.hooks = hooks;
        this.picker = new VariablePicker({
            onPick: (name) => hooks.onAddVariable(name),
            onDrop: (name, x, y) => hooks.onDropVariable(name, x, y),
            dropTargetAt: (x, y) => hooks.dropTargetAt(x, y),
        });
        this.el = this.#build();
        this.onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    open() {
        if (!this.el.isConnected) {
            document.body.appendChild(this.el);
            document.addEventListener('keydown', this.onKeyDown);
            void this.reloadCatalog();
        }
        this.refresh();
    }

    close() {
        if (!this.el.isConnected) return;
        document.removeEventListener('keydown', this.onKeyDown);
        this.el.remove();
        this.hooks.onClose();
    }

    async reloadCatalog() {
        const catalog = await loadCatalog();
        if (!this.el.isConnected) return;
        this.picker.setCatalog(catalog);
        const list = this.el.querySelector('.pp-binding-options');
        list.replaceChildren(...catalog.flatMap((preset) => preset.variables.map((def) => {
            const option = document.createElement('option');
            option.value = def.name;
            option.label = `${def.label || localName(def.name)} · ${preset.name}`;
            return option;
        })));
        this.#refreshElement();
    }

    // Re-reads the panel's state into the popup and re-anchors it.
    // `geometry` may be passed mid-drag, before anything is committed.
    refresh(geometry = this.panel.getRenderedGeometry()) {
        if (!this.el.isConnected) return;
        const { record } = this.panel;
        this.el.querySelector('[data-field="name"]').textContent = record.name;
        this.el.querySelector('[data-field="position"]').textContent = `${geometry.x}, ${geometry.y}`;
        this.el.querySelector('[data-field="size"]').textContent = `${geometry.width} × ${geometry.height}`;

        const lockButton = this.el.querySelector('[data-action="lock"]');
        lockButton.classList.toggle('pp-active', record.locked);
        lockButton.querySelector('i').className = `fa-solid ${record.locked ? 'fa-lock' : 'fa-lock-open'}`;
        lockButton.querySelector('span').textContent = record.locked ? 'Locked' : 'Unlocked';

        this.#refreshElement();
        this.#position(geometry);
    }

    refreshElementPreview() {
        if (!this.el.isConnected) return;
        const element = this.#selected();
        if (!element) return;
        renderElementContent(this.preview, element, this.#entry(element));
        this.#refreshBindingInfo(element);
    }

    #selected() {
        return this.panel.selectedElementId ? this.panel.getElement(this.panel.selectedElementId) : null;
    }

    #entry(element) {
        return element.binding ? this.hooks.getValue(element.binding.name) : undefined;
    }

    // The definition to label/format by: the live value's, else the catalog's.
    #def(element) {
        if (!element.binding) return null;
        return this.#entry(element)?.def ?? findVariable(element.binding.name)?.def ?? null;
    }

    #refreshBindingInfo(element) {
        const info = this.el.querySelector('[data-el="binding-info"]');
        if (!element.binding) {
            info.textContent = 'Not bound. Drag a variable here, or type or pick a name.';
            return;
        }
        const found = findVariable(element.binding.name);
        const entry = this.#entry(element);
        const parts = [];
        if (found) parts.push(`${found.def.type} · ${found.preset.name} (${found.preset.namespace})`);
        else if (getCatalog().length > 0) parts.push('Not defined by any preset');
        if (entry === undefined) parts.push('no value in this chat');
        info.textContent = parts.join(' · ');
    }

    // Fills the Element section from the selected element. A field that
    // has focus is left alone so typing is never overwritten.
    #refreshElement() {
        const section = this.el.querySelector('.pp-properties-element');
        const element = this.#selected();
        section.hidden = !element;
        if (!element) return;

        const set = (key, apply) => {
            const field = section.querySelector(`[data-el="${key}"]`);
            if (field !== document.activeElement) apply(field);
        };
        const def = this.#def(element);
        set('role', (f) => { f.value = element.role; });
        set('binding', (f) => { f.value = element.binding?.name ?? ''; });
        set('showLabel', (f) => { f.checked = element.showLabel; });
        set('labelOverride', (f) => {
            f.value = element.labelOverride;
            f.placeholder = elementLabel({ ...element, labelOverride: '' }, def);
            f.disabled = !element.showLabel;
        });
        set('format', (f) => {
            const formats = formatsFor(def, this.#entry(element)?.value);
            f.replaceChildren(...formats.map((fmt) => new Option(fmt.label, fmt.id)));
            f.value = formats.some((fmt) => fmt.id === element.format) ? element.format : 'auto';
        });

        Object.assign(this.preview.style, { width: `${element.width}px`, height: `${element.height}px` });
        this.refreshElementPreview();
    }

    #change(patch) {
        const element = this.#selected();
        if (element) this.hooks.onElementChange(element.id, patch);
    }

    #build() {
        const el = document.createElement('div');
        el.className = 'pp-properties';
        el.dataset.panelId = this.panel.id;
        el.innerHTML = `
            <div class="pp-properties-header">
                <span class="pp-properties-title">Panel Properties</span>
                <button type="button" class="pp-properties-close" data-action="close" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <dl class="pp-properties-fields">
                <dt>Name</dt><dd data-field="name"></dd>
                <dt>Position</dt><dd data-field="position"></dd>
                <dt>Size</dt><dd data-field="size"></dd>
            </dl>
            <div class="pp-properties-actions">
                <button type="button" class="menu_button pp-properties-button" data-action="lock">
                    <i class="fa-solid fa-lock-open"></i><span>Unlocked</span>
                </button>
                <button type="button" class="menu_button pp-properties-button pp-danger" data-action="delete">
                    <i class="fa-solid fa-trash-can"></i><span>Delete</span>
                </button>
            </div>
            <div class="pp-properties-section-label">Panel Library</div>
            <div class="pp-properties-actions">
                <button type="button" class="menu_button pp-properties-button" data-action="save-template" title="Save this panel to the Panel Library">
                    <i class="fa-solid fa-floppy-disk"></i><span>Save</span>
                </button>
                <button type="button" class="menu_button pp-properties-button" data-action="export-template" title="Export this panel as a template file">
                    <i class="fa-solid fa-file-export"></i><span>Export</span>
                </button>
            </div>

            <section class="pp-properties-element" hidden>
                <div class="pp-properties-section-label pp-properties-section-row">
                    <span>Element</span>
                    <button type="button" class="pp-properties-close pp-danger" data-action="delete-element" title="Delete this element">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
                <label class="pp-field"><span>Role</span>
                    <input type="text" class="text_pole" data-el="role" placeholder="optional, e.g. health" />
                </label>
                <label class="pp-field"><span>Binding</span>
                    <input type="text" class="text_pole" data-el="binding" placeholder="search or type, e.g. se__hp" autocomplete="off" />
                </label>
                <small class="pp-field-info" data-el="binding-info"></small>
                <label class="checkbox_label pp-field-check">
                    <input type="checkbox" data-el="showLabel" /><span>Show label</span>
                </label>
                <label class="pp-field"><span>Label</span>
                    <input type="text" class="text_pole" data-el="labelOverride" />
                </label>
                <label class="pp-field"><span>Format</span>
                    <select class="text_pole" data-el="format"></select>
                </label>
                <div class="pp-field-caption">Preview</div>
                <div class="pp-element-preview-frame"></div>
            </section>

            <div class="pp-properties-section-label pp-properties-section-row">
                <span>Variables</span>
                <button type="button" class="pp-properties-close" data-action="reload-variables" title="Reload the variable list">
                    <i class="fa-solid fa-rotate"></i>
                </button>
            </div>
            <div class="pp-properties-picker"></div>
            <datalist class="pp-binding-options"></datalist>
            <datalist class="pp-role-options"></datalist>
        `;

        // datalist ids must be unique per page - one pair per popup.
        const bindingList = el.querySelector('.pp-binding-options');
        const roleList = el.querySelector('.pp-role-options');
        bindingList.id = `pp-binding-options-${this.panel.id}`;
        roleList.id = `pp-role-options-${this.panel.id}`;
        roleList.replaceChildren(...ROLE_SUGGESTIONS.map((role) => new Option(role, role)));
        el.querySelector('[data-el="binding"]').setAttribute('list', bindingList.id);
        el.querySelector('[data-el="role"]').setAttribute('list', roleList.id);

        el.querySelector('.pp-properties-picker').appendChild(this.picker.el);
        this.preview = buildElementContent();
        this.preview.classList.add('pp-element-preview');
        el.querySelector('.pp-element-preview-frame').appendChild(this.preview);

        // Keep clicks inside the popup from reaching SillyTavern's own
        // outside-click handlers (which would close open drawers/menus).
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
        el.querySelector('[data-action="lock"]').addEventListener('click', () => {
            this.hooks.onLockToggle(!this.panel.record.locked);
        });
        el.querySelector('[data-action="delete"]').addEventListener('click', () => this.hooks.onDelete());
        el.querySelector('[data-action="save-template"]').addEventListener('click', () => this.hooks.onSaveTemplate());
        el.querySelector('[data-action="export-template"]').addEventListener('click', () => this.hooks.onExportTemplate());
        el.querySelector('[data-action="reload-variables"]').addEventListener('click', () => void this.reloadCatalog());
        el.querySelector('[data-action="delete-element"]').addEventListener('click', () => {
            const element = this.#selected();
            if (element) this.hooks.onElementDelete(element.id);
        });

        const field = (key) => el.querySelector(`[data-el="${key}"]`);
        field('role').addEventListener('change', (e) => this.#change({ role: e.target.value.trim() }));
        field('binding').addEventListener('change', (e) => {
            const name = e.target.value.trim();
            this.#change({ binding: name ? { name } : null });
        });
        field('showLabel').addEventListener('change', (e) => this.#change({ showLabel: e.target.checked }));
        field('labelOverride').addEventListener('change', (e) => this.#change({ labelOverride: e.target.value.trim() }));
        field('format').addEventListener('change', (e) => this.#change({ format: e.target.value }));
        return el;
    }

    // Anchors beside the panel: right side if it fits, else left, else
    // overlapping - always clamped inside the viewport.
    #position(geometry) {
        const w = this.el.offsetWidth;
        const h = this.el.offsetHeight;
        let x = geometry.x + geometry.width + POPUP_GAP;
        if (x + w > window.innerWidth) x = geometry.x - w - POPUP_GAP;
        if (x < 0) x = Math.max(0, window.innerWidth - w - POPUP_GAP);
        const y = Math.min(Math.max(0, geometry.y), Math.max(0, window.innerHeight - h - POPUP_GAP));
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
    }
}
