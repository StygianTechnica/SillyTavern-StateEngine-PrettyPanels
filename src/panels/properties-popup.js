// Properties popup for ONE panel. Each Panel owns its own instance
// (created on open, discarded on close), so several panels' popups can
// be open at once without sharing state. Three collapsible sections:
//   - Panel Properties: name, position and size (read-only), lock toggle,
//     delete, Layering (z-index), Panel Library (save/export template),
//     and the collapsible Panel Styling subsection
//   - Element Properties: the selected element's Role, Binding, X/Y,
//     Width/Height, Show Label, Label Override, Format, the collapsible
//     Element Styling subsection, a live Preview, and delete
//   - Variables: the variable picker (src/ui/variable-picker.js)
// Which sections are open lives on the Panel (panel.openSections), so it
// survives closing and reopening the popup. Every change is reported
// through `hooks`; nothing is written here.

import { VariablePicker } from '../ui/variable-picker.js';
import { loadCatalog, getCatalog, findVariable, onCatalogChange } from '../chat/variable-service.js';
import { ROLE_SUGGESTIONS, elementLabel, localName, clampElementGeometry } from '../elements/element-model.js';
import { formatsFor } from '../elements/formats.js';
import { buildElementContent, renderElementContent } from '../elements/element-view.js';
import { PANEL_STYLE_LIMITS, clampStyleNumber } from './panel-style.js';
import {
    FONT_SIZE_LIMITS, ICON_SIZE_LIMITS, FONT_WEIGHTS, FONT_FAMILIES, ALIGNMENTS, ICON_SUGGESTIONS,
} from '../elements/element-style.js';

const POPUP_GAP = 8;
const GEOMETRY_KEYS = ['x', 'y', 'width', 'height'];
// Shift+Arrow step when the grid size can't be read.
const FALLBACK_GRID_STEP = 8;

function sectionMarkup(key, title, actions, body, extraClass = '') {
    return `
        <section class="pp-section ${extraClass}" data-section="${key}">
            <div class="pp-section-header">
                <button type="button" class="pp-section-toggle" data-toggle="${key}" aria-expanded="true">
                    <i class="fa-solid fa-chevron-down pp-section-chevron"></i><span>${title}</span>
                </button>
                ${actions}
            </div>
            <div class="pp-section-body">${body}</div>
        </section>
    `;
}

// ---- Styling field markup. `scope` is 'panel' or 'element'; the input
// carries data-style="<scope>:<key>".

function colorRow(label, scope, key) {
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <input type="color" data-style="${scope}:${key}" />
                <span class="pp-style-state" data-style-state="${scope}:${key}">theme</span>
                <button type="button" class="pp-properties-close pp-style-reset" data-style-reset="${scope}:${key}" title="Back to the default">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
            </div>
        </div>`;
}

function numberRow(label, scope, key, [min, max], unit = 'px') {
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <input type="number" class="text_pole" data-style="${scope}:${key}" min="${min}" max="${max}" step="1" placeholder="auto" />
                <span class="pp-style-unit">${unit}</span>
            </div>
        </div>`;
}

function selectRow(label, scope, key, options) {
    const opts = options.map(([id, text]) => `<option value="${id}">${text}</option>`).join('');
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <select class="text_pole" data-style="${scope}:${key}">${opts}</select>
            </div>
        </div>`;
}

// Normalizes any CSS colour to #rrggbb for <input type="color">, via the
// canvas colour parser (handles rgb(), names, color-mix results).
let colorProbe = null;
function toHex(color) {
    try {
        colorProbe ??= document.createElement('canvas').getContext('2d');
        colorProbe.fillStyle = '#000000';
        colorProbe.fillStyle = color;
        const out = colorProbe.fillStyle;
        if (/^#[0-9a-f]{6}$/i.test(out)) return out;
        const m = out.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        if (m) return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
    } catch {
        // fall through
    }
    return '#000000';
}

export class PanelPropertiesPopup {
    // hooks: { onLockToggle(locked), onDelete(), onSaveTemplate(), onExportTemplate(),
    //          onZIndexChange(zIndex), onRestack(action), onPanelStyleChange(patch),
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
            this.stopCatalogWatch = onCatalogChange((catalog) => this.#applyCatalog(catalog));
            void loadCatalog();
        }
        this.refresh();
    }

    close() {
        if (!this.el.isConnected) return;
        document.removeEventListener('keydown', this.onKeyDown);
        this.stopCatalogWatch?.();
        this.el.remove();
        this.hooks.onClose();
    }

    #applyCatalog(catalog) {
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
        this.el.querySelector('.pp-properties-title').textContent = record.name;
        this.el.querySelector('[data-field="name"]').textContent = record.name;
        this.el.querySelector('[data-field="position"]').textContent = `${geometry.x}, ${geometry.y}`;
        this.el.querySelector('[data-field="size"]').textContent = `${geometry.width} × ${geometry.height}`;

        const lockButton = this.el.querySelector('[data-action="lock"]');
        lockButton.classList.toggle('pp-active', record.locked);
        lockButton.querySelector('i').className = `fa-solid ${record.locked ? 'fa-lock' : 'fa-lock-open'}`;
        lockButton.querySelector('span').textContent = record.locked ? 'Locked' : 'Unlocked';

        const zField = this.el.querySelector('[data-field="zIndex"]');
        if (zField !== document.activeElement) zField.value = String(record.zIndex);
        this.#fillPanelStyle();

        this.#applySections();
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

    // Live X/Y/Width/Height while an element is being dragged or resized.
    refreshElementGeometry(elementId, geometry) {
        if (!this.el.isConnected || elementId !== this.panel.selectedElementId) return;
        this.#fillGeometry(geometry);
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

    #applySections() {
        for (const section of this.el.querySelectorAll('.pp-section')) {
            const open = this.panel.openSections[section.dataset.section] !== false;
            section.classList.toggle('pp-collapsed', !open);
            section.querySelector('.pp-section-toggle').setAttribute('aria-expanded', String(open));
        }
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

    #fillGeometry(geometry) {
        for (const key of GEOMETRY_KEYS) {
            const field = this.el.querySelector(`[data-geo="${key}"]`);
            if (field !== document.activeElement) field.value = String(geometry[key]);
        }
    }

    // Fills the Element section from the selected element. A field that
    // has focus is left alone so typing is never overwritten.
    #refreshElement() {
        const section = this.el.querySelector('[data-section="element"]');
        const element = this.#selected();
        section.querySelector('.pp-element-fields').hidden = !element;
        section.querySelector('.pp-element-none').hidden = !!element;
        section.querySelector('[data-action="delete-element"]').hidden = !element;
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
        this.#fillGeometry(element);

        Object.assign(this.preview.style, { width: `${element.width}px`, height: `${element.height}px` });
        this.refreshElementPreview();
        // After the preview renders: unset colours show what's on screen.
        this.#fillElementStyle(element);
    }

    // ---- Styling ----------------------------------------------------------

    #styleField(scope, key) {
        return this.el.querySelector(`[data-style="${scope}:${key}"]`);
    }

    // Sets a colour picker from a stored colour, or - when unset - from the
    // colour actually on screen, marked "theme"/"default".
    #fillColor(scope, key, stored, fallback) {
        const input = this.#styleField(scope, key);
        const state = this.el.querySelector(`[data-style-state="${scope}:${key}"]`);
        const reset = this.el.querySelector(`[data-style-reset="${scope}:${key}"]`);
        const has = typeof stored === 'string' && stored !== '';
        if (input !== document.activeElement) input.value = toHex(has ? stored : fallback);
        state.hidden = has;
        state.textContent = scope === 'panel' ? 'theme' : 'default';
        reset.hidden = !has;
    }

    #fillValue(scope, key, value) {
        const input = this.#styleField(scope, key);
        if (input === document.activeElement) return;
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value ?? '';
    }

    #fillPanelStyle() {
        const style = this.panel.record.style ?? {};
        const box = this.panel.el.querySelector('.pp-panel-box');
        const computed = getComputedStyle(box);
        this.#fillColor('panel', 'backgroundColor', style.backgroundColor, getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintColor') || computed.backgroundColor);
        this.#fillColor('panel', 'borderColor', style.borderColor, computed.borderTopColor);
        for (const key of Object.keys(PANEL_STYLE_LIMITS)) this.#fillValue('panel', key, style[key]);
        this.#fillValue('panel', 'shadow', style.shadow !== false);
    }

    #fillElementStyle(element) {
        const style = element.style ?? {};
        // The element's inherited colour, not the value's rendered one - that
        // may be showing the conditional colour.
        const inherited = getComputedStyle(this.preview).color;
        const icon = this.preview.querySelector('.pp-element-icon');
        this.#fillValue('element', 'fontSize', style.fontSize);
        this.#fillValue('element', 'fontWeight', style.fontWeight ?? '');
        this.#fillValue('element', 'fontFamily', style.fontFamily ?? 'inherit');
        this.#fillValue('element', 'align', style.align ?? '');
        this.#fillColor('element', 'textColor', style.textColor, inherited);
        this.#fillColor('element', 'labelColor', style.labelColor, inherited);
        this.#fillValue('element', 'icon', style.icon ?? '');
        this.#fillColor('element', 'iconColor', style.iconColor, getComputedStyle(icon).color);
        this.#fillValue('element', 'iconSize', style.iconSize);
        this.#fillValue('element', 'conditionThreshold', style.condition?.threshold);
        const conditionColor = this.#styleField('element', 'conditionColor');
        if (conditionColor !== document.activeElement) conditionColor.value = toHex(style.condition?.color ?? '#e0605a');
    }

    // Commits one styling value. null/'' removes it (back to the default).
    #commitStyle(scope, key, value) {
        if (scope === 'panel') {
            this.hooks.onPanelStyleChange({ [key]: value === '' ? null : value });
            return;
        }
        const element = this.#selected();
        if (!element) return;
        const style = { ...element.style };
        if (key === 'conditionThreshold' || key === 'conditionColor') {
            const current = style.condition ?? {};
            const threshold = key === 'conditionThreshold' ? value : current.threshold ?? null;
            const color = key === 'conditionColor' ? value : current.color ?? this.#styleField('element', 'conditionColor').value;
            style.condition = { threshold: Number.isFinite(threshold) ? threshold : null, color };
        } else if (value === null || value === '' || value === undefined) {
            delete style[key];
        } else {
            style[key] = value;
        }
        this.hooks.onElementChange(element.id, { style });
    }

    #numberLimits(scope, key) {
        if (scope === 'panel') return PANEL_STYLE_LIMITS[key];
        if (key === 'fontSize') return FONT_SIZE_LIMITS;
        if (key === 'iconSize') return ICON_SIZE_LIMITS;
        return null; // conditionThreshold: any number
    }

    #bindStyleField(input) {
        const [scope, key] = input.dataset.style.split(':');
        if (input.type === 'color') {
            input.addEventListener('input', () => this.#commitStyle(scope, key, input.value));
        } else if (input.type === 'checkbox') {
            input.addEventListener('change', () => this.#commitStyle(scope, key, input.checked));
        } else if (input.type === 'number') {
            const read = () => {
                if (input.value.trim() === '') return null;
                if (!Number.isFinite(input.valueAsNumber)) return undefined;
                const limits = this.#numberLimits(scope, key);
                if (!limits) return input.valueAsNumber;
                return scope === 'panel' ? clampStyleNumber(key, input.valueAsNumber)
                    : Math.min(limits[1], Math.max(limits[0], Math.round(input.valueAsNumber)));
            };
            input.addEventListener('input', () => {
                const value = read();
                if (value !== undefined) this.#commitStyle(scope, key, value);
            });
            // On Enter/blur show the value actually stored (clamped).
            input.addEventListener('change', () => {
                const value = read();
                input.value = value === null || value === undefined ? '' : String(value);
            });
        } else {
            // select, text (icon)
            input.addEventListener(input.tagName === 'SELECT' ? 'change' : 'input', () => {
                this.#commitStyle(scope, key, input.value.trim());
            });
        }
    }

    #change(patch) {
        const element = this.#selected();
        if (element) this.hooks.onElementChange(element.id, patch);
    }

    // Applies a new value for one geometry field, clamped to the panel
    // body (and, with `snap`, hard-snapped to the grid - far edge for
    // width/height, like dragging). Returns the value actually stored.
    #commitGeometry(key, value, snap) {
        const element = this.#selected();
        if (!element || !Number.isFinite(value)) return null;
        const grid = this.panel.gridSize();
        let v = Math.round(value);
        if (snap && grid > 1) {
            if (key === 'width') v = Math.round((element.x + v) / grid) * grid - element.x;
            else if (key === 'height') v = Math.round((element.y + v) / grid) * grid - element.y;
            else v = Math.round(v / grid) * grid;
        }
        const current = { x: element.x, y: element.y, width: element.width, height: element.height };
        const next = clampElementGeometry({ ...current, [key]: v }, this.panel.body.clientWidth, this.panel.body.clientHeight, key);
        if (GEOMETRY_KEYS.some((k) => next[k] !== current[k])) this.hooks.onElementChange(element.id, next);
        return next[key];
    }

    // X/Y/Width/Height: typing updates live (unsnapped), Enter/blur snaps
    // to the grid, Up/Down step 1px and Shift+Up/Down one grid step.
    #bindGeometryField(input) {
        const key = input.dataset.geo;
        let typed = false;
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            e.preventDefault();
            const step = e.shiftKey ? (this.panel.hooks.getGrid?.().size || FALLBACK_GRID_STEP) : 1;
            const base = Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : this.#selected()?.[key];
            const stored = this.#commitGeometry(key, base + (e.key === 'ArrowUp' ? step : -step), false);
            if (stored !== null) input.value = String(stored);
        });
        input.addEventListener('input', () => {
            typed = true;
            if (Number.isFinite(input.valueAsNumber)) this.#commitGeometry(key, input.valueAsNumber, false);
        });
        input.addEventListener('change', () => {
            const element = this.#selected();
            if (!element) return;
            const stored = typed && Number.isFinite(input.valueAsNumber)
                ? this.#commitGeometry(key, input.valueAsNumber, true)
                : element[key];
            typed = false;
            input.value = String(stored ?? element[key]);
        });
    }

    #build() {
        const el = document.createElement('div');
        el.className = 'pp-properties';
        el.dataset.panelId = this.panel.id;

        const panelSection = sectionMarkup('panel', 'Panel Properties', '', `
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
            <div class="pp-properties-section-label">Layering</div>
            <div class="pp-layering">
                <label class="pp-layering-z"><span>Z-Index</span>
                    <input type="number" class="text_pole" data-field="zIndex" min="0" max="99" step="1" />
                </label>
                <div class="pp-layering-buttons">
                    <button type="button" class="menu_button" data-restack="back" title="Send to Back (0)"><i class="fa-solid fa-angles-down"></i></button>
                    <button type="button" class="menu_button" data-restack="backward" title="Send Backward (-1)"><i class="fa-solid fa-angle-down"></i></button>
                    <button type="button" class="menu_button" data-restack="forward" title="Bring Forward (+1)"><i class="fa-solid fa-angle-up"></i></button>
                    <button type="button" class="menu_button" data-restack="front" title="Bring to Front"><i class="fa-solid fa-angles-up"></i></button>
                </div>
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
            ${sectionMarkup('panelStyle', 'Panel Styling', '', `
                ${colorRow('Background', 'panel', 'backgroundColor')}
                ${numberRow('Opacity', 'panel', 'backgroundOpacity', PANEL_STYLE_LIMITS.backgroundOpacity, '%')}
                ${colorRow('Border', 'panel', 'borderColor')}
                ${numberRow('Thickness', 'panel', 'borderWidth', PANEL_STYLE_LIMITS.borderWidth)}
                ${numberRow('Radius', 'panel', 'borderRadius', PANEL_STYLE_LIMITS.borderRadius)}
                <label class="checkbox_label pp-field-check">
                    <input type="checkbox" data-style="panel:shadow" /><span>Drop shadow</span>
                </label>
                ${numberRow('Padding', 'panel', 'padding', PANEL_STYLE_LIMITS.padding)}
                ${numberRow('Margin', 'panel', 'margin', PANEL_STYLE_LIMITS.margin)}
            `, 'pp-subsection')}
        `);

        const elementSection = sectionMarkup('element', 'Element Properties', `
            <button type="button" class="pp-properties-close pp-danger" data-action="delete-element" title="Delete this element">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `, `
            <div class="pp-element-none">Click an element on the panel to edit it.</div>
            <div class="pp-element-fields">
                <label class="pp-field"><span>Role</span>
                    <input type="text" class="text_pole" data-el="role" placeholder="optional, e.g. health" />
                </label>
                <label class="pp-field"><span>Binding</span>
                    <input type="text" class="text_pole" data-el="binding" placeholder="search or type, e.g. se__hp" autocomplete="off" />
                </label>
                <small class="pp-field-info" data-el="binding-info"></small>
                <div class="pp-geometry">
                    <span class="pp-geometry-caption">Position</span>
                    <label><span>X</span><input type="number" class="text_pole" data-geo="x" min="0" step="1" /></label>
                    <label><span>Y</span><input type="number" class="text_pole" data-geo="y" min="0" step="1" /></label>
                    <span class="pp-geometry-caption">Size</span>
                    <label><span>W</span><input type="number" class="text_pole" data-geo="width" min="1" step="1" /></label>
                    <label><span>H</span><input type="number" class="text_pole" data-geo="height" min="1" step="1" /></label>
                </div>
                <label class="checkbox_label pp-field-check">
                    <input type="checkbox" data-el="showLabel" /><span>Show label</span>
                </label>
                <label class="pp-field"><span>Label</span>
                    <input type="text" class="text_pole" data-el="labelOverride" />
                </label>
                <label class="pp-field"><span>Format</span>
                    <select class="text_pole" data-el="format"></select>
                </label>
                ${sectionMarkup('elementStyle', 'Element Styling', '', `
                    ${numberRow('Font size', 'element', 'fontSize', FONT_SIZE_LIMITS)}
                    ${selectRow('Weight', 'element', 'fontWeight', [['', 'Default'], ...FONT_WEIGHTS])}
                    ${selectRow('Font', 'element', 'fontFamily', FONT_FAMILIES)}
                    ${selectRow('Align', 'element', 'align', [['', 'Default'], ...ALIGNMENTS])}
                    ${colorRow('Text', 'element', 'textColor')}
                    ${colorRow('Label', 'element', 'labelColor')}
                    <div class="pp-style-row"><span>Icon</span>
                        <div class="pp-style-controls">
                            <input type="text" class="text_pole" data-style="element:icon" placeholder="e.g. heart" autocomplete="off" />
                        </div>
                    </div>
                    ${colorRow('Icon color', 'element', 'iconColor')}
                    ${numberRow('Icon size', 'element', 'iconSize', ICON_SIZE_LIMITS)}
                    <div class="pp-style-row"><span>If value &lt;</span>
                        <div class="pp-style-controls">
                            <input type="number" class="text_pole" data-style="element:conditionThreshold" step="any" placeholder="off" title="When the value is a number below this, its text takes the colour on the right" />
                            <input type="color" data-style="element:conditionColor" title="Colour when the value is below the threshold" />
                        </div>
                    </div>
                `, 'pp-subsection')}
                <div class="pp-field-caption">Preview</div>
                <div class="pp-element-preview-frame"></div>
            </div>
        `);

        const variablesSection = sectionMarkup('variables', 'Variables', `
            <button type="button" class="pp-properties-close" data-action="reload-variables" title="Reload the variable list">
                <i class="fa-solid fa-rotate"></i>
            </button>
        `, '<div class="pp-properties-picker"></div>');

        el.innerHTML = `
            <div class="pp-properties-header">
                <span class="pp-properties-title"></span>
                <button type="button" class="pp-properties-close" data-action="close" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            ${panelSection}
            ${elementSection}
            ${variablesSection}
            <datalist class="pp-binding-options"></datalist>
            <datalist class="pp-role-options"></datalist>
            <datalist class="pp-icon-options"></datalist>
        `;

        // datalist ids must be unique per page - one pair per popup.
        const bindingList = el.querySelector('.pp-binding-options');
        const roleList = el.querySelector('.pp-role-options');
        bindingList.id = `pp-binding-options-${this.panel.id}`;
        roleList.id = `pp-role-options-${this.panel.id}`;
        roleList.replaceChildren(...ROLE_SUGGESTIONS.map((role) => new Option(role, role)));
        el.querySelector('[data-el="binding"]').setAttribute('list', bindingList.id);
        el.querySelector('[data-el="role"]').setAttribute('list', roleList.id);
        const iconList = el.querySelector('.pp-icon-options');
        iconList.id = `pp-icon-options-${this.panel.id}`;
        iconList.replaceChildren(...ICON_SUGGESTIONS.map((name) => new Option(name, name)));
        el.querySelector('[data-style="element:icon"]').setAttribute('list', iconList.id);

        el.querySelector('.pp-properties-picker').appendChild(this.picker.el);
        this.preview = buildElementContent();
        this.preview.classList.add('pp-element-preview');
        el.querySelector('.pp-element-preview-frame').appendChild(this.preview);

        // Keep clicks inside the popup from reaching SillyTavern's own
        // outside-click handlers (which would close open drawers/menus).
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
        for (const toggle of el.querySelectorAll('[data-toggle]')) {
            toggle.addEventListener('click', () => {
                const key = toggle.dataset.toggle;
                this.panel.openSections[key] = this.panel.openSections[key] === false;
                this.#applySections();
            });
        }
        el.querySelector('[data-action="lock"]').addEventListener('click', () => {
            this.hooks.onLockToggle(!this.panel.record.locked);
        });
        el.querySelector('[data-action="delete"]').addEventListener('click', () => this.hooks.onDelete());
        el.querySelector('[data-action="save-template"]').addEventListener('click', () => this.hooks.onSaveTemplate());
        el.querySelector('[data-action="export-template"]').addEventListener('click', () => this.hooks.onExportTemplate());
        el.querySelector('[data-action="reload-variables"]').addEventListener('click', () => void loadCatalog());
        el.querySelector('[data-action="delete-element"]').addEventListener('click', () => {
            const element = this.#selected();
            if (element) this.hooks.onElementDelete(element.id);
        });

        const zField = el.querySelector('[data-field="zIndex"]');
        zField.addEventListener('input', () => {
            if (Number.isFinite(zField.valueAsNumber)) this.hooks.onZIndexChange(zField.valueAsNumber);
        });
        zField.addEventListener('change', () => { zField.value = String(this.panel.record.zIndex); });
        for (const button of el.querySelectorAll('[data-restack]')) {
            button.addEventListener('click', () => this.hooks.onRestack(button.dataset.restack));
        }

        const field = (key) => el.querySelector(`[data-el="${key}"]`);
        field('role').addEventListener('change', (e) => this.#change({ role: e.target.value.trim() }));
        field('binding').addEventListener('change', (e) => {
            const name = e.target.value.trim();
            this.#change({ binding: name ? { name } : null });
        });
        field('showLabel').addEventListener('change', (e) => this.#change({ showLabel: e.target.checked }));
        field('labelOverride').addEventListener('change', (e) => this.#change({ labelOverride: e.target.value.trim() }));
        field('format').addEventListener('change', (e) => this.#change({ format: e.target.value }));
        for (const input of el.querySelectorAll('[data-geo]')) this.#bindGeometryField(input);
        for (const input of el.querySelectorAll('[data-style]')) this.#bindStyleField(input);
        for (const button of el.querySelectorAll('[data-style-reset]')) {
            const [scope, key] = button.dataset.styleReset.split(':');
            button.addEventListener('click', () => this.#commitStyle(scope, key, null));
        }
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
