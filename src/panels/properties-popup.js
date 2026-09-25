// Properties popup for ONE panel. Each Panel owns its own instance
// (created on open, discarded on close), so several panels' popups can
// be open at once without sharing state. Three collapsible sections:
//   - Panel Properties: name, position and size (read-only), lock toggle,
//     delete, Layering (z-index), Layout Anchor (Free/Anchored and the
//     anchor target), Theme (theme + variant, src/themes/), Panel Library
//     (save/export template),
//     and the collapsible Panel Styling subsection
//   - Element Properties: the selected element's Type, Role, Binding, X/Y,
//     Width/Height, Z Index, then per type: Show Label, Label Override,
//     Format (+ Custom pattern) and Element Styling (text), Text + Preset
//     and Element Styling (free text), Widget Properties (bars/gauges),
//     Clock Properties (analog clocks: theme, face, images, geometry, hands,
//     opacity) or Shape Properties (shapes); Image (opacity, fit, clipping) for a text
//     element showing an image variable; fonts are chosen in the Font Picker
//     (src/ui/font-picker.js); a live
//     Preview, and delete. Rows carry data-for-types / data-widget-field
//     and are hidden when they don't apply to the element's type.
//   - Add & Variables: the palette (free text, shapes) and the variable picker
//     (src/ui/variable-picker.js)
// Which sections are open lives on the Panel (panel.openSections), so it
// survives closing and reopening the popup. Every change is reported
// through `hooks`; nothing is written here.

import { VariablePicker, ElementPalette } from '../ui/variable-picker.js';
import { openFontPicker, closeFontPicker } from '../ui/font-picker.js';
import { fontRegistry } from '../fonts/font-registry.js';
import { ANCHOR_MODES, ANCHORS, anchorLabel } from './anchors.js';
import { loadCatalog, getCatalog, findVariable, onCatalogChange } from '../chat/variable-service.js';
import {
    ROLE_SUGGESTIONS, ELEMENT_TYPES, DEFAULT_TYPE_SIZES, MAX_FREE_TEXT_LENGTH, elementLabel, localName, clampElementGeometry,
    isUnboundType, isImageDefinition, IMAGE_FITS, IMAGE_CLIP_SHAPES, IMAGE_RADIUS_LIMITS, IMAGE_BORDER_WIDTH_LIMITS, IMAGE_DEFAULTS,
} from '../elements/element-model.js';
import { WIDGET_FIELDS, WIDGET_LIMITS, WIDGET_DEFAULTS, effectiveMax } from '../elements/widgets.js';
import { formatsFor, DATETIME_PATTERN_HINT } from '../elements/formats.js';
import { SHAPE_KINDS, SHAPE_LIMITS, SHAPE_DEFAULTS } from '../elements/shapes.js';
import {
    ELEMENT_TYPE_ANALOG_CLOCK, CLOCK_HANDS, CLOCK_IMAGE_KEYS, CLOCK_LIMITS, CLOCK_STYLES, CLOCK_NUMERALS, CLOCK_TICKS,
    clockImageSource, clockGeometry, effectiveClock,
} from '../elements/clock.js';
import { listThemes, onThemesChange } from '../themes/theme-store.js';
import { resolvePanelTheme, clockDefaultsFor, themeVars, applyVars } from '../themes/theme-apply.js';
import { buildElementContent, renderElementContent } from '../elements/element-view.js';
import { PANEL_STYLE_LIMITS, IMAGE_MODES, clampStyleNumber } from './panel-style.js';
import {
    FONT_SIZE_LIMITS, ICON_SIZE_LIMITS, ALIGNMENTS, ICON_SUGGESTIONS, BACKGROUND_OPACITY_LIMITS, BACKGROUND_RADIUS_LIMITS,
    LETTER_SPACING_LIMITS, LINE_HEIGHT_LIMITS, TEXT_TRANSFORMS, TEXT_DECORATIONS, TEXT_SHADOWS, TEXT_PRESETS, numericWeight,
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

function textRow(label, scope, key, placeholder) {
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <input type="text" class="text_pole" data-style="${scope}:${key}" placeholder="${placeholder}" autocomplete="off" />
            </div>
        </div>`;
}

function checkRow(label, scope, key) {
    return `
        <label class="checkbox_label pp-field-check">
            <input type="checkbox" data-style="${scope}:${key}" /><span>${label}</span>
        </label>`;
}

const WIDGET_TYPES = ELEMENT_TYPES.map(([id]) => id).filter((id) => id !== 'text' && id !== ELEMENT_TYPE_ANALOG_CLOCK && !isUnboundType(id)).join(' ');
// A clock image selector's "Image URL" choice (the URL field shows), and
// the prefix of its theme-asset choices.
const CLOCK_URL_CHOICE = '__url';
const CLOCK_ASSET_CHOICE = 'asset:';
// Every type that shows a variable (all but shapes and free text).
const BOUND_TYPES = ELEMENT_TYPES.map(([id]) => id).filter((id) => !isUnboundType(id)).join(' ');
// Element Styling keys holding fractional numbers (not rounded).
const FLOAT_STYLE_KEYS = new Set(['letterSpacing', 'lineHeight']);

function floatRow(label, scope, key, [min, max], step, unit) {
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <input type="number" class="text_pole" data-style="${scope}:${key}" min="${min}" max="${max}" step="${step}" placeholder="auto" />
                <span class="pp-style-unit">${unit}</span>
            </div>
        </div>`;
}

// A Font row: a button showing the current font (in that font) that
// opens the Font Picker.
function fontRow(label, key, title) {
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <button type="button" class="menu_button pp-font-button" data-font-field="${key}" title="${title}">
                    <i class="fa-solid fa-font"></i><span class="pp-font-button-name">Default</span>
                </button>
                <button type="button" class="pp-properties-close pp-style-reset" data-font-reset="${key}" title="Back to the default font"><i class="fa-solid fa-rotate-left"></i></button>
            </div>
        </div>`;
}
// Types with a Format field.
const FORMAT_TYPES = ['text', 'gauge-circle', 'gauge-semicircle'];

function widgetField(key, markup) {
    return `<div data-widget-field="${key}">${markup}</div>`;
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

// One clock image selector: a dropdown (theme default / URL / an image
// variable) and, for URL, the URL field.
function clockImageRow(label, key) {
    return `
        <div class="pp-style-row"><span>${label}</span>
            <div class="pp-style-controls">
                <select class="text_pole" data-clock-image="${key}" title="The theme's image, an image URL, or a State Engine image variable (the image it is showing)"></select>
            </div>
        </div>
        <div class="pp-style-row" data-clock-url-row="${key}"><span></span>
            <div class="pp-style-controls">
                <input type="text" class="text_pole" data-clock-url="${key}" placeholder="image URL" autocomplete="off" />
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
    //          onZIndexChange(zIndex), onRestack(action), onAnchorChange(patch), onPanelStyleChange(patch),
    //          onThemeChange({ themeId?, themeVariant? }),
    //          onElementChange(elementId, patch), onElementDelete(elementId),
    //          onAddVariable(name), onDropVariable(name, x, y), dropTargetAt(x, y),
    //          onAddPaletteItem(kind), onDropPaletteItem(kind, x, y), onArrangeElement(elementId, action),
    //          getValue(name), onClose() }
    constructor(panel, hooks) {
        this.panel = panel;
        this.hooks = hooks;
        this.picker = new VariablePicker({
            onPick: (name) => hooks.onAddVariable(name),
            onDrop: (name, x, y) => hooks.onDropVariable(name, x, y),
            dropTargetAt: (x, y) => hooks.dropTargetAt(x, y),
        });
        this.shapes = new ElementPalette({
            onPick: (kind) => hooks.onAddPaletteItem(kind),
            onDrop: (kind, x, y) => hooks.onDropPaletteItem(kind, x, y),
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
            this.stopFontWatch = fontRegistry.onChange(() => this.#refreshElement());
            this.stopThemeWatch = onThemesChange(() => this.refresh());
            void fontRegistry.load().then(() => this.#refreshElement());
            void loadCatalog();
        }
        this.refresh();
    }

    close() {
        if (!this.el.isConnected) return;
        document.removeEventListener('keydown', this.onKeyDown);
        this.stopCatalogWatch?.();
        this.stopFontWatch?.();
        this.stopThemeWatch?.();
        closeFontPicker();
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
        this.#fillPanelStyle();
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
        const anchored = record.anchorMode === 'anchored';
        this.el.querySelector('[data-field="anchorMode"]').value = anchored ? 'anchored' : 'free';
        const targetSelect = this.el.querySelector('[data-field="anchorTarget"]');
        targetSelect.value = record.anchorTarget ?? '';
        targetSelect.closest('.pp-anchor-target').hidden = !anchored;
        this.el.querySelector('[data-field="anchorStatus"]').textContent = !anchored
            ? 'Floating. Drag it onto a highlighted SillyTavern area to anchor it there.'
            : !record.anchorTarget ? 'Choose where to anchor it.'
                : this.panel.docked ? `Part of SillyTavern's layout: ${anchorLabel(record.anchorTarget)}. Drag it away to float it again.`
                    : `${anchorLabel(record.anchorTarget)} isn't on screen right now (e.g. the sidebar is closed) - shown floating until it is.`;
        this.#fillTheme();
        this.#fillPanelStyle();

        this.#applySections();
        this.#refreshElement();
        this.#applyLock(record.locked);
        this.#position(geometry);
    }

    // A locked panel can't be edited: every control except Unlock, Close,
    // the section toggles and the Variables list is disabled.
    #applyLock(locked) {
        this.el.classList.toggle('pp-properties-locked', locked);
        for (const control of this.el.querySelectorAll('input, select, button')) {
            if (control.closest('[data-section="variables"]')) continue;
            if (control.matches('[data-action="lock"], [data-action="close"], [data-toggle]')) continue;
            control.disabled = locked || control.dataset.overridden === '1';
        }
    }

    // The Theme and Variant dropdowns: every theme, and the chosen theme's
    // variants (the panel's own choice, or what it falls back to).
    #fillTheme() {
        const { theme, variantName } = resolvePanelTheme(this.panel.record);
        const themeSelect = this.el.querySelector('[data-field="themeId"]');
        const variantSelect = this.el.querySelector('[data-field="themeVariant"]');
        if (themeSelect !== document.activeElement) {
            themeSelect.replaceChildren(...listThemes().map((t) => new Option(t.name, t.id)));
            themeSelect.value = theme.id;
        }
        if (variantSelect !== document.activeElement) {
            variantSelect.replaceChildren(...Object.keys(theme.variants).map((name) => new Option(name, name)));
            variantSelect.value = variantName;
        }
        const missing = this.panel.record.themeId && this.panel.record.themeId !== theme.id;
        this.el.querySelector('[data-field="themeStatus"]').textContent = missing
            ? 'This panel\'s theme no longer exists - showing the first theme until you choose one.'
            : 'Unset Panel Styling below comes from the theme and variant. Edit themes in the Theme Editor (Extensions drawer).';
    }

    refreshElementPreview() {
        if (!this.el.isConnected) return;
        const element = this.#selected();
        if (!element) return;
        // The preview isn't inside the panel, so it gets the theme's colours
        // and fonts itself.
        const { theme, variant } = resolvePanelTheme(this.panel.record);
        applyVars(this.el.querySelector('.pp-element-preview-frame'), themeVars(theme, variant));
        renderElementContent(this.preview, element, this.#entry(element), theme);
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
        set('type', (f) => { f.value = element.type; });
        this.#applyTypeVisibility(element.type);
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
        const format = section.querySelector('[data-el="format"]').value;
        section.querySelector('[data-el="pattern-row"]').hidden = !(FORMAT_TYPES.includes(element.type) && format === 'custom');
        set('formatPattern', (f) => { f.value = element.formatPattern ?? ''; });
        set('content', (f) => { f.value = element.content ?? ''; });
        set('zIndex', (f) => { f.value = String(element.zIndex ?? 0); });
        this.#fillImage(element, def, format);
        this.#fillGeometry(element);

        Object.assign(this.preview.style, { width: `${element.width}px`, height: `${element.height}px` });
        this.refreshElementPreview();
        // After the preview renders: unset colours show what's on screen.
        this.#fillElementStyle(element);
        this.#fillWidget(element);
        this.#fillShape(element);
        this.#fillClock(element);
    }

    // The Image rows: only for a text element whose value is drawn as an
    // image (an image or image list variable, not formatted as text).
    #fillImage(element, def, format) {
        const row = this.el.querySelector('[data-el="image-row"]');
        const noImageFormat = { image: 'text', imageList: 'count' }[def?.type];
        row.hidden = !(element.type === 'text' && isImageDefinition(def) && def.type !== 'imageMap' && format !== noImageFormat);
        if (row.hidden) return;
        const set = (key, apply) => {
            const field = row.querySelector(`[data-el="${key}"]`);
            if (field !== document.activeElement) apply(field);
        };
        const opacity = Number.isFinite(element.opacity) ? element.opacity : IMAGE_DEFAULTS.opacity;
        set('imageOpacity', (f) => { f.value = String(opacity); });
        row.querySelector('[data-el="imageOpacityValue"]').textContent = `${Math.round(opacity * 100)}%`;
        set('imageFit', (f) => { f.value = element.fit ?? 'contain'; });
        const clip = element.clipShape ?? 'none';
        set('imageClip', (f) => { f.value = clip; });
        set('imageRadius', (f) => { f.value = String(element.borderRadius ?? 0); });
        row.querySelector('[data-el="imageRadiusRow"]').hidden = clip !== 'rectangle';
        // The border follows the clip, so it needs one.
        row.querySelector('[data-el="imageBorderRows"]').hidden = clip === 'none';
        set('imageBorderWidth', (f) => { f.value = String(element.borderWidth ?? 0); });
        set('imageBorderColor', (f) => {
            const theme = getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyColor').trim() || '#ffffff';
            f.value = toHex(typeof element.borderColor === 'string' && element.borderColor ? element.borderColor : theme);
        });
        // A clip always covers the element, so Fit only matters without one.
        row.querySelector('[data-el="imageFitRow"]').hidden = clip !== 'none';
    }

    #fillShape(element) {
        const shape = element.shape ?? {};
        const kind = shape.kind ?? SHAPE_DEFAULTS.kind;
        const body = this.preview.querySelector('.pp-shape');
        this.#fillValue('shape', 'kind', kind);
        this.#fillColor('shape', 'fillColor', shape.fillColor, body ? getComputedStyle(body).backgroundColor : '#000000');
        this.#fillColor('shape', 'borderColor', shape.borderColor, body ? getComputedStyle(body).borderTopColor : '#888888');
        for (const key of Object.keys(SHAPE_LIMITS)) this.#fillValue('shape', key, shape[key]);
        this.#styleField('shape', 'cornerRadius').closest('.pp-style-row').hidden = kind === 'ellipse';
    }

    #fillClock(element) {
        if (element.type !== ELEMENT_TYPE_ANALOG_CLOCK) return;
        const clock = element.clock ?? {};
        const theme = this.#styleField('clock', 'themeStyle');
        if (theme !== document.activeElement) {
            const themes = listThemes();
            theme.replaceChildren(new Option('The panel\'s theme', ''), ...themes.map((t) => new Option(t.name, t.id)));
            if (clock.themeStyle && !themes.some((t) => t.id === clock.themeStyle)) theme.appendChild(new Option(`${clock.themeStyle} (not found)`, clock.themeStyle));
        }
        this.#fillValue('clock', 'themeStyle', clock.themeStyle ?? '');
        // The "Theme" choices name what the theme gives.
        const themeClock = clockDefaultsFor(element, this.panel.theme);
        const themed = effectiveClock({}, themeClock);
        for (const [key, options] of [['style', CLOCK_STYLES], ['numerals', CLOCK_NUMERALS], ['tickMarks', CLOCK_TICKS]]) {
            const select = this.#styleField('clock', key);
            select.options[0].textContent = `Theme (${options.find(([id]) => id === themed[key])?.[1] ?? themed[key]})`;
            this.#fillValue('clock', key, clock[key] ?? '');
        }
        for (const key of CLOCK_IMAGE_KEYS) this.#fillClockImage(key, clock[key], clockImageSource(themeClock[key]));
        for (const key of Object.keys(CLOCK_LIMITS)) this.#fillValue('clock', key, clock[key]);
        // Blank geometry and hands: show what is in use.
        const geo = clockGeometry({}, Math.max(1, element.width - 2), Math.max(1, element.height - 2));
        this.#styleField('clock', 'radius').placeholder = `auto (${Math.round(geo.r)})`;
        this.#styleField('clock', 'centerX').placeholder = `auto (${Math.round(geo.cx)})`;
        this.#styleField('clock', 'centerY').placeholder = `auto (${Math.round(geo.cy)})`;
        for (const hand of CLOCK_HANDS) {
            this.#styleField('clock', `${hand}HandLength`).placeholder = String(themed[`${hand}HandLength`]);
            this.#styleField('clock', `${hand}HandOffset`).placeholder = String(themed[`${hand}HandOffset`]);
        }
        const opacity = Number.isFinite(element.opacity) ? element.opacity : 1;
        const slider = this.el.querySelector('[data-el="clockOpacity"]');
        if (slider !== document.activeElement) slider.value = String(opacity);
        this.el.querySelector('[data-el="clockOpacityValue"]').textContent = `${Math.round(opacity * 100)}%`;
    }

    // A clock image selector: theme default, a URL, or an image variable
    // (grouped by preset; a stored name missing from the catalog is kept).
    #fillClockImage(key, stored, themeSource) {
        const select = this.el.querySelector(`[data-clock-image="${key}"]`);
        const url = this.el.querySelector(`[data-clock-url="${key}"]`);
        // The panel theme's assets (Theme Editor uploads) are offered too; a
        // chosen one is stored as its variable name, like a URL.
        const assets = Object.entries(resolvePanelTheme(this.panel.record).theme.assets ?? {});
        const isAsset = typeof stored === 'string' && assets.some(([, ref]) => ref === stored);
        const variable = typeof stored === 'string' ? null : clockImageSource(stored)?.variable ?? null;
        const current = isAsset ? `${CLOCK_ASSET_CHOICE}${stored}` : typeof stored === 'string' ? CLOCK_URL_CHOICE : (variable ?? '');
        if (select !== document.activeElement) {
            const none = themeSource ? 'Theme image' : (key === 'backdropImage' ? 'None (drawn face)' : 'None (drawn hand)');
            const options = [new Option(none, ''), new Option('Image URL…', CLOCK_URL_CHOICE)];
            if (assets.length) {
                const group = document.createElement('optgroup');
                group.label = 'Theme assets';
                for (const [assetName, ref] of assets) group.appendChild(new Option(assetName, `${CLOCK_ASSET_CHOICE}${ref}`));
                options.push(group);
            }
            const groups = getCatalog()
                .map((preset) => ({ preset, vars: preset.variables.filter((v) => ['image', 'imageList', 'imageMap'].includes(v.type)) }))
                .filter((g) => g.vars.length > 0);
            for (const { preset, vars } of groups) {
                const group = document.createElement('optgroup');
                group.label = `${preset.name} (${preset.namespace})`;
                for (const v of vars) group.appendChild(new Option(`${v.label || localName(v.name)} · ${v.type}`, v.name));
                options.push(group);
            }
            if (variable && !groups.some((g) => g.vars.some((v) => v.name === variable))) {
                options.push(new Option(`${variable} (not found)`, variable));
            }
            select.replaceChildren(...options);
            select.value = current;
        }
        this.el.querySelector(`[data-clock-url-row="${key}"]`).hidden = current !== CLOCK_URL_CHOICE;
        if (url !== document.activeElement) url.value = typeof stored === 'string' && !isAsset ? stored : '';
    }

    // Stores one clock image: a URL string ('' while one is being typed),
    // { variable }, or null (back to the theme's).
    #commitClockImage(key, value) {
        const element = this.#selected();
        if (!element) return;
        const clock = { ...element.clock };
        if (value === null) delete clock[key];
        else clock[key] = value;
        this.hooks.onElementChange(element.id, { clock });
    }

    // Shows only the rows that apply to the element's type.
    #applyTypeVisibility(type) {
        for (const node of this.el.querySelectorAll('[data-for-types]')) {
            node.hidden = !node.dataset.forTypes.split(' ').includes(type);
        }
        const fields = WIDGET_FIELDS[type] ?? [];
        for (const node of this.el.querySelectorAll('[data-widget-field]')) {
            node.hidden = !fields.includes(node.dataset.widgetField);
        }
    }

    #fillWidget(element) {
        const widget = element.widget ?? {};
        const find = (selector, prop) => {
            const node = this.preview.querySelector(selector);
            return node ? getComputedStyle(node)[prop] : '#888888';
        };
        const bar = this.preview.querySelector('.pp-bar');
        this.#fillColor('widget', 'trackColor', widget.trackColor, bar ? getComputedStyle(bar).backgroundColor : find('.pp-gauge-track', 'stroke'));
        this.#fillColor('widget', 'fillColor', widget.fillColor, bar ? find('.pp-bar-fill', 'backgroundColor') : find('.pp-gauge-fill', 'stroke'));
        this.#fillColor('widget', 'labelColor', widget.labelColor, find('.pp-widget-label', 'color'));
        this.#fillColor('widget', 'iconColor', widget.iconColor, find('.pp-widget-icon', 'color'));
        for (const key of Object.keys(WIDGET_LIMITS)) this.#fillValue('widget', key, widget[key]);
        this.#fillValue('widget', 'maxValue', widget.maxValue);
        // Blank Max Value: show the max actually in use.
        this.#styleField('widget', 'maxValue').placeholder = String(effectiveMax({}, this.#def(element)));
        this.#fillValue('widget', 'labelText', widget.labelText ?? '');
        this.#fillValue('widget', 'icon', widget.icon ?? '');
        this.#fillValue('widget', 'animate', widget.animate ?? WIDGET_DEFAULTS.animate);
        this.#fillValue('widget', 'showValue', widget.showValue ?? WIDGET_DEFAULTS.showValue);
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
        this.#fillColor('panel', 'backgroundColor', style.backgroundColor, computed.getPropertyValue('--ppt-background').trim() || computed.backgroundColor);
        this.#fillColor('panel', 'borderColor', style.borderColor, computed.borderTopColor);
        for (const key of Object.keys(PANEL_STYLE_LIMITS)) this.#fillValue('panel', key, style[key]);
        this.#fillValue('panel', 'shadow', style.shadow !== false);
        this.#fillValue('panel', 'backgroundImage', style.backgroundImage ?? '');
        this.#fillImageVariable(style.backgroundImageVariable ?? '');
        // A chosen image variable overrides the URL: greyed out, value kept.
        const url = this.#styleField('panel', 'backgroundImage');
        url.dataset.overridden = style.backgroundImageVariable ? '1' : '';
        url.title = style.backgroundImageVariable ? 'Overridden by the image variable below' : '';
        this.#fillValue('panel', 'backgroundImageMode', style.backgroundImageMode ?? 'cover');
    }

    // The Image variable dropdown: "none", then every image / image list /
    // image map variable, grouped by preset. A stored name missing from the
    // catalog is kept as its own option.
    #fillImageVariable(current) {
        const select = this.#styleField('panel', 'backgroundImageVariable');
        const groups = getCatalog()
            .map((preset) => ({ preset, vars: preset.variables.filter((v) => ['image', 'imageList', 'imageMap'].includes(v.type)) }))
            .filter((g) => g.vars.length > 0);
        const options = [new Option('None - use the Image URL', '')];
        for (const { preset, vars } of groups) {
            const group = document.createElement('optgroup');
            group.label = `${preset.name} (${preset.namespace})`;
            for (const v of vars) group.appendChild(new Option(`${v.label || localName(v.name)} · ${v.type}`, v.name));
            options.push(group);
        }
        if (current && !groups.some((g) => g.vars.some((v) => v.name === current))) {
            options.push(new Option(`${current} (not found)`, current));
        }
        select.replaceChildren(...options);
        select.value = current;
    }

    #fillElementStyle(element) {
        const style = element.style ?? {};
        // The element's inherited colour, not the value's rendered one - that
        // may be showing the conditional colour.
        const inherited = getComputedStyle(this.preview).color;
        const icon = this.preview.querySelector('.pp-element-icon');
        this.#fillValue('element', 'fontSize', style.fontSize);
        this.#fillFontButton('fontFamily', style, true);
        this.#fillFontButton('labelFontFamily', style, false);
        this.#fillValue('element', 'letterSpacing', style.letterSpacing);
        this.#fillValue('element', 'lineHeight', style.lineHeight);
        this.#fillValue('element', 'textTransform', style.textTransform ?? '');
        this.#fillValue('element', 'textDecoration', style.textDecoration ?? '');
        this.#fillValue('element', 'textShadow', style.textShadow ?? '');
        this.#fillColor('element', 'shadowColor', style.shadowColor, 'rgba(0, 0, 0, 0.85)');
        this.#fillValue('element', 'align', style.align ?? '');
        this.#fillColor('element', 'textColor', style.textColor, inherited);
        this.#fillColor('element', 'labelColor', style.labelColor, inherited);
        this.#fillValue('element', 'icon', style.icon ?? '');
        this.#fillColor('element', 'iconColor', style.iconColor, getComputedStyle(icon).color);
        this.#fillValue('element', 'iconSize', style.iconSize);
        this.#fillColor('element', 'backgroundColor', style.backgroundColor, getComputedStyle(document.body).getPropertyValue('--SmartThemeBlurTintColor') || '#000000');
        this.#fillValue('element', 'backgroundOpacity', style.backgroundOpacity);
        this.#fillValue('element', 'backgroundRadius', style.backgroundRadius);
        this.#fillValue('element', 'conditionThreshold', style.condition?.threshold);
        const conditionColor = this.#styleField('element', 'conditionColor');
        if (conditionColor !== document.activeElement) conditionColor.value = toHex(style.condition?.color ?? '#e0605a');
    }

    // The Font button: the font's name drawn in that font, plus weight,
    // italic and axes for the main font.
    #fillFontButton(key, style, withVariation) {
        const button = this.el.querySelector(`[data-font-field="${key}"]`);
        const id = style[key];
        const font = id ? fontRegistry.list().find((f) => f.font_id === id) : null;
        const parts = [font?.display_name ?? (id ? `${id} (missing)` : (key === 'labelFontFamily' ? 'Same as text' : 'Default'))];
        if (withVariation) {
            const weight = numericWeight(style.fontWeight);
            if (weight) parts.push(String(weight));
            if (style.fontStyle === 'italic') parts.push('italic');
            for (const [tag, v] of Object.entries(style.fontAxes ?? {})) parts.push(`${tag} ${v}`);
        }
        const name = button.querySelector('.pp-font-button-name');
        name.textContent = parts.join(' · ');
        name.style.fontFamily = id ? fontRegistry.cssFamily(id) : '';
        this.el.querySelector(`[data-font-reset="${key}"]`).hidden = !id && !(withVariation && (style.fontWeight || style.fontStyle || style.fontAxes));
    }

    // Opens the Font Picker for the selected element's `key` font.
    #openFontPicker(key, anchor) {
        const element = this.#selected();
        if (!element) return;
        const style = element.style ?? {};
        const main = key === 'fontFamily';
        openFontPicker({
            anchor,
            title: main ? 'Font' : 'Label font',
            value: main
                ? { fontFamily: style.fontFamily, fontWeight: numericWeight(style.fontWeight), fontStyle: style.fontStyle, fontAxes: style.fontAxes }
                : { fontFamily: style.labelFontFamily },
            previewText: element.type === 'free-text' ? element.content : elementLabel(element, this.#def(element)),
            getLayoutText: () => [...document.querySelectorAll('.pp-panel')].map((p) => p.textContent).join(''),
            onChange: (value) => {
                if (main) this.#commitStyles(value);
                else this.#commitStyles({ labelFontFamily: value.fontFamily });
            },
        });
    }

    // Commits several Element Styling values at once (null removes one).
    #commitStyles(patch) {
        const element = this.#selected();
        if (!element) return;
        const style = { ...element.style };
        for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === '' || value === undefined) delete style[key];
            else style[key] = value;
        }
        this.hooks.onElementChange(element.id, { style });
    }

    // Commits one styling value. null/'' removes it (back to the default).
    #commitStyle(scope, key, value) {
        if (scope === 'panel') {
            this.hooks.onPanelStyleChange({ [key]: value === '' ? null : value });
            return;
        }
        const element = this.#selected();
        if (!element) return;
        if (scope === 'widget' || scope === 'shape' || scope === 'clock') {
            const settings = { ...element[scope] };
            if (value === null || value === '' || value === undefined) delete settings[key];
            else settings[key] = value;
            this.hooks.onElementChange(element.id, { [scope]: settings });
            return;
        }
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
        if (scope === 'widget') return WIDGET_LIMITS[key] ?? null;
        if (scope === 'shape') return SHAPE_LIMITS[key] ?? null;
        if (scope === 'clock') return CLOCK_LIMITS[key] ?? null;
        if (key === 'fontSize') return FONT_SIZE_LIMITS;
        if (key === 'iconSize') return ICON_SIZE_LIMITS;
        if (key === 'backgroundOpacity') return BACKGROUND_OPACITY_LIMITS;
        if (key === 'backgroundRadius') return BACKGROUND_RADIUS_LIMITS;
        if (key === 'letterSpacing') return LETTER_SPACING_LIMITS;
        if (key === 'lineHeight') return LINE_HEIGHT_LIMITS;
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
                if (!limits) return key === 'maxValue' && input.valueAsNumber <= 0 ? undefined : input.valueAsNumber;
                if (scope === 'panel') return clampStyleNumber(key, input.valueAsNumber);
                const n = FLOAT_STYLE_KEYS.has(key) ? Math.round(input.valueAsNumber * 100) / 100 : Math.round(input.valueAsNumber);
                return Math.min(limits[1], Math.max(limits[0], n));
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
            <div class="pp-locked-note"><i class="fa-solid fa-lock"></i> Locked - unlock to move, resize or edit.</div>
            <div class="pp-properties-actions">
                <button type="button" class="menu_button pp-properties-button" data-action="lock" title="Lock Panel: no moving, resizing or editing">
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
            <div class="pp-properties-section-label">Layout Anchor</div>
            <div class="pp-anchor-row">
                <label class="pp-layering-z"><span>Anchor mode</span>
                    <select class="text_pole" data-field="anchorMode" title="Free: floats over SillyTavern. Anchored: becomes part of SillyTavern's layout at the chosen place, which moves out of its way.">
                        ${ANCHOR_MODES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
                    </select>
                </label>
                <label class="pp-layering-z pp-anchor-target"><span>At</span>
                    <select class="text_pole" data-field="anchorTarget">
                        <option value="">Choose…</option>
                        ${ANCHORS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
                    </select>
                </label>
            </div>
            <small class="pp-field-info" data-field="anchorStatus"></small>
            <div class="pp-properties-section-label">Theme</div>
            <div class="pp-anchor-row">
                <label class="pp-layering-z"><span>Theme</span>
                    <select class="text_pole" data-field="themeId" title="The theme this panel is drawn with"></select>
                </label>
                <label class="pp-layering-z"><span>Variant</span>
                    <select class="text_pole" data-field="themeVariant" title="Which of the theme's panel looks to use"></select>
                </label>
            </div>
            <small class="pp-field-info" data-field="themeStatus"></small>
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
                ${numberRow('Panel opacity', 'panel', 'panelOpacity', PANEL_STYLE_LIMITS.panelOpacity, '%')}
                ${colorRow('Border', 'panel', 'borderColor')}
                ${numberRow('Thickness', 'panel', 'borderWidth', PANEL_STYLE_LIMITS.borderWidth)}
                ${numberRow('Radius', 'panel', 'borderRadius', PANEL_STYLE_LIMITS.borderRadius)}
                <label class="checkbox_label pp-field-check">
                    <input type="checkbox" data-style="panel:shadow" /><span>Drop shadow</span>
                </label>
                ${numberRow('Padding', 'panel', 'padding', PANEL_STYLE_LIMITS.padding)}
                ${numberRow('Margin', 'panel', 'margin', PANEL_STYLE_LIMITS.margin)}
                ${textRow('Image URL', 'panel', 'backgroundImage', 'image URL')}
                <div class="pp-style-row"><span>Image variable</span>
                    <div class="pp-style-controls">
                        <select class="text_pole" data-style="panel:backgroundImageVariable" title="A State Engine image variable. When set, the image it is showing replaces the Image URL."></select>
                    </div>
                </div>
                ${selectRow('Image mode', 'panel', 'backgroundImageMode', IMAGE_MODES)}
                ${numberRow('Image opacity', 'panel', 'backgroundImageOpacity', PANEL_STYLE_LIMITS.backgroundImageOpacity, '%')}
            `, 'pp-subsection')}
        `);

        const elementSection = sectionMarkup('element', 'Element Properties', `
            <button type="button" class="pp-properties-close pp-danger" data-action="delete-element" title="Delete this element">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        `, `
            <div class="pp-element-none">Click an element on the panel to edit it.</div>
            <div class="pp-element-fields">
                <label class="pp-field"><span>Type</span>
                    <select class="text_pole" data-el="type">
                        ${ELEMENT_TYPES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
                    </select>
                </label>
                <label class="pp-field"><span>Role</span>
                    <input type="text" class="text_pole" data-el="role" placeholder="optional, e.g. health" />
                </label>
                <label class="pp-field" data-for-types="${BOUND_TYPES}"><span>Binding</span>
                    <input type="text" class="text_pole" data-el="binding" placeholder="search or type, e.g. se__hp" autocomplete="off" />
                </label>
                <small class="pp-field-info" data-el="binding-info" data-for-types="${BOUND_TYPES}"></small>
                <div class="pp-geometry">
                    <span class="pp-geometry-caption">Position</span>
                    <label><span>X</span><input type="number" class="text_pole" data-geo="x" min="0" step="1" /></label>
                    <label><span>Y</span><input type="number" class="text_pole" data-geo="y" min="0" step="1" /></label>
                    <span class="pp-geometry-caption">Size</span>
                    <label><span>W</span><input type="number" class="text_pole" data-geo="width" min="1" step="1" /></label>
                    <label><span>H</span><input type="number" class="text_pole" data-geo="height" min="1" step="1" /></label>
                </div>
                <div class="pp-field pp-element-order"><span>Z Index</span>
                    <div class="pp-element-z">
                        <input type="number" class="text_pole" data-el="zIndex" step="1" title="Stacking order inside the panel: higher draws on top. Equal values keep their order." />
                        <div class="pp-layering-buttons">
                            <button type="button" class="menu_button" data-arrange="back" title="Send to Back (below every other element)"><i class="fa-solid fa-angles-down"></i></button>
                            <button type="button" class="menu_button" data-arrange="backward" title="Send Backward (-1)"><i class="fa-solid fa-angle-down"></i></button>
                            <button type="button" class="menu_button" data-arrange="forward" title="Bring Forward (+1)"><i class="fa-solid fa-angle-up"></i></button>
                            <button type="button" class="menu_button" data-arrange="front" title="Bring to Front (above every other element)"><i class="fa-solid fa-angles-up"></i></button>
                        </div>
                    </div>
                </div>
                <label class="checkbox_label pp-field-check" data-for-types="text">
                    <input type="checkbox" data-el="showLabel" /><span>Show label</span>
                </label>
                <label class="pp-field" data-for-types="text"><span>Label</span>
                    <input type="text" class="text_pole" data-el="labelOverride" />
                </label>
                <label class="pp-field" data-for-types="${FORMAT_TYPES.join(' ')}"><span>Format</span>
                    <select class="text_pole" data-el="format"></select>
                </label>
                <div data-el="image-row" hidden>
                    <div class="pp-field-caption">Image</div>
                    <div class="pp-field"><span>Opacity</span>
                        <div class="pp-image-opacity">
                            <input type="range" data-el="imageOpacity" min="0" max="1" step="0.05" />
                            <span data-el="imageOpacityValue"></span>
                        </div>
                    </div>
                    <label class="pp-field"><span>Clip shape</span>
                        <select class="text_pole" data-el="imageClip">
                            ${IMAGE_CLIP_SHAPES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
                        </select>
                    </label>
                    <label class="pp-field" data-el="imageRadiusRow"><span>Radius</span>
                        <input type="number" class="text_pole" data-el="imageRadius" min="${IMAGE_RADIUS_LIMITS[0]}" max="${IMAGE_RADIUS_LIMITS[1]}" step="1" title="Corner rounding of the rectangle clip, px" />
                    </label>
                    <div data-el="imageBorderRows">
                        <label class="pp-field"><span>Border</span>
                            <input type="number" class="text_pole" data-el="imageBorderWidth" min="${IMAGE_BORDER_WIDTH_LIMITS[0]}" max="${IMAGE_BORDER_WIDTH_LIMITS[1]}" step="1" title="Width of the border along the clip shape's edge, px (0 = none)" />
                        </label>
                        <label class="pp-field"><span>Border color</span>
                            <input type="color" data-el="imageBorderColor" title="Colour of the border along the clip shape's edge" />
                        </label>
                    </div>
                    <label class="pp-field" data-el="imageFitRow"><span>Fit</span>
                        <select class="text_pole" data-el="imageFit" title="Without a clip shape: fill the element (cropping) or show the whole image">
                            ${IMAGE_FITS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
                        </select>
                    </label>
                </div>
                <div data-el="pattern-row" hidden>
                    <label class="pp-field"><span>Pattern</span>
                        <input type="text" class="text_pole" data-el="formatPattern" placeholder="{monthName} {day}, {year}" autocomplete="off" />
                    </label>
                    <small class="pp-field-info">${DATETIME_PATTERN_HINT}</small>
                </div>
                <div data-for-types="shape">
                ${sectionMarkup('shape', 'Shape Properties', '', `
                    ${selectRow('Shape', 'shape', 'kind', SHAPE_KINDS)}
                    ${colorRow('Fill', 'shape', 'fillColor')}
                    ${numberRow('Fill opacity', 'shape', 'fillOpacity', SHAPE_LIMITS.fillOpacity, '%')}
                    ${colorRow('Border', 'shape', 'borderColor')}
                    ${numberRow('Thickness', 'shape', 'borderWidth', SHAPE_LIMITS.borderWidth)}
                    ${numberRow('Corners', 'shape', 'cornerRadius', SHAPE_LIMITS.cornerRadius)}
                `, 'pp-subsection')}
                </div>
                <div data-for-types="${WIDGET_TYPES}">
                ${sectionMarkup('widget', 'Widget Properties', '', `
                    ${widgetField('labelText', textRow('Label text', 'widget', 'labelText', 'variable label'))}
                    ${widgetField('labelColor', colorRow('Label color', 'widget', 'labelColor'))}
                    ${widgetField('icon', textRow('Icon', 'widget', 'icon', 'e.g. heart'))}
                    ${widgetField('iconColor', colorRow('Icon color', 'widget', 'iconColor'))}
                    ${widgetField('iconSize', numberRow('Icon size', 'widget', 'iconSize', WIDGET_LIMITS.iconSize))}
                    ${widgetField('maxValue', `
                        <div class="pp-style-row"><span>Max value</span>
                            <div class="pp-style-controls">
                                <input type="number" class="text_pole" data-style="widget:maxValue" min="0" step="any" title="The value that fills the widget. Blank: the variable's own max, or 100." />
                            </div>
                        </div>`)}
                    ${widgetField('gaugeRadius', numberRow('Radius', 'widget', 'gaugeRadius', WIDGET_LIMITS.gaugeRadius))}
                    ${widgetField('strokeWidth', numberRow('Stroke', 'widget', 'strokeWidth', WIDGET_LIMITS.strokeWidth))}
                    ${widgetField('trackColor', colorRow('Track', 'widget', 'trackColor'))}
                    ${widgetField('fillColor', colorRow('Fill', 'widget', 'fillColor'))}
                    ${widgetField('cornerRadius', numberRow('Corners', 'widget', 'cornerRadius', WIDGET_LIMITS.cornerRadius))}
                    ${widgetField('barHeight', numberRow('Bar height', 'widget', 'barHeight', WIDGET_LIMITS.barHeight))}
                    ${widgetField('barWidth', numberRow('Bar width', 'widget', 'barWidth', WIDGET_LIMITS.barWidth))}
                    ${widgetField('showValue', checkRow('Show value', 'widget', 'showValue'))}
                    ${widgetField('animate', checkRow('Animate changes', 'widget', 'animate'))}
                `, 'pp-subsection')}
                </div>
                <div data-for-types="${ELEMENT_TYPE_ANALOG_CLOCK}">
                ${sectionMarkup('clock', 'Clock Properties', '', `
                    <small class="pp-field-info">Shows the time of the bound datetime variable, in its own calendar. Anything left blank comes from the theme.</small>
                    ${selectRow('Theme', 'clock', 'themeStyle', [])}
                    ${selectRow('Face', 'clock', 'style', [['', 'Theme'], ...CLOCK_STYLES])}
                    ${selectRow('Numerals', 'clock', 'numerals', [['', 'Theme'], ...CLOCK_NUMERALS])}
                    ${selectRow('Tick marks', 'clock', 'tickMarks', [['', 'Theme'], ...CLOCK_TICKS])}
                    ${clockImageRow('Backdrop', 'backdropImage')}
                    ${clockImageRow('Hour hand', 'hourHandImage')}
                    ${clockImageRow('Minute hand', 'minuteHandImage')}
                    ${clockImageRow('Second hand', 'secondHandImage')}
                    ${numberRow('Radius', 'clock', 'radius', CLOCK_LIMITS.radius)}
                    ${numberRow('Center X', 'clock', 'centerX', CLOCK_LIMITS.centerX)}
                    ${numberRow('Center Y', 'clock', 'centerY', CLOCK_LIMITS.centerY)}
                    <small class="pp-field-info">Hand length runs from the centre to the tip; offset is how far the hand reaches back past the centre (for an image, where its pivot sits). Both are % of the radius; a length of 0 hides the hand.</small>
                    ${numberRow('Hour length', 'clock', 'hourHandLength', CLOCK_LIMITS.hourHandLength, '%')}
                    ${numberRow('Hour offset', 'clock', 'hourHandOffset', CLOCK_LIMITS.hourHandOffset, '%')}
                    ${numberRow('Minute length', 'clock', 'minuteHandLength', CLOCK_LIMITS.minuteHandLength, '%')}
                    ${numberRow('Minute offset', 'clock', 'minuteHandOffset', CLOCK_LIMITS.minuteHandOffset, '%')}
                    ${numberRow('Second length', 'clock', 'secondHandLength', CLOCK_LIMITS.secondHandLength, '%')}
                    ${numberRow('Second offset', 'clock', 'secondHandOffset', CLOCK_LIMITS.secondHandOffset, '%')}
                    <div class="pp-style-row"><span>Opacity</span>
                        <div class="pp-style-controls pp-image-opacity">
                            <input type="range" data-el="clockOpacity" min="0" max="1" step="0.05" />
                            <span data-el="clockOpacityValue"></span>
                        </div>
                    </div>
                `, 'pp-subsection')}
                </div>
                <div data-for-types="free-text">
                    <label class="pp-field pp-field-top"><span>Text</span>
                        <textarea class="text_pole" data-el="content" rows="3" maxlength="${MAX_FREE_TEXT_LENGTH}" placeholder="Type the text to show"></textarea>
                    </label>
                    <div class="pp-field"><span>Preset</span>
                        <select class="text_pole" data-el="preset" title="Apply ready-made formatting (size, weight, spacing, case). You can adjust everything afterwards.">
                            <option value="">Apply formatting…</option>
                            ${TEXT_PRESETS.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div data-for-types="text free-text">
                ${sectionMarkup('elementStyle', 'Element Styling', '', `
                    ${fontRow('Font', 'fontFamily', 'Choose the font, weight, italic and variable-font settings')}
                    <div data-for-types="text">${fontRow('Label font', 'labelFontFamily', 'A different font for the label only')}</div>
                    ${numberRow('Font size', 'element', 'fontSize', FONT_SIZE_LIMITS)}
                    ${floatRow('Spacing', 'element', 'letterSpacing', LETTER_SPACING_LIMITS, 0.01, 'em')}
                    ${floatRow('Line height', 'element', 'lineHeight', LINE_HEIGHT_LIMITS, 0.05, '×')}
                    ${selectRow('Case', 'element', 'textTransform', TEXT_TRANSFORMS)}
                    ${selectRow('Decoration', 'element', 'textDecoration', TEXT_DECORATIONS)}
                    ${selectRow('Shadow', 'element', 'textShadow', TEXT_SHADOWS)}
                    ${colorRow('Shadow color', 'element', 'shadowColor')}
                    ${selectRow('Align', 'element', 'align', [['', 'Default'], ...ALIGNMENTS])}
                    ${colorRow('Text', 'element', 'textColor')}
                    <div data-for-types="text">${colorRow('Label', 'element', 'labelColor')}</div>
                    ${colorRow('Background', 'element', 'backgroundColor')}
                    ${numberRow('Bg opacity', 'element', 'backgroundOpacity', BACKGROUND_OPACITY_LIMITS, '%')}
                    ${numberRow('Bg corners', 'element', 'backgroundRadius', BACKGROUND_RADIUS_LIMITS)}
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
                </div>
                <div class="pp-field-caption">Preview</div>
                <div class="pp-element-preview-frame"></div>
            </div>
        `);

        const variablesSection = sectionMarkup('variables', 'Add & Variables', `
            <button type="button" class="pp-properties-close" data-action="reload-variables" title="Reload the variable list">
                <i class="fa-solid fa-rotate"></i>
            </button>
        `, '<div class="pp-properties-shapes"></div><div class="pp-properties-picker"></div>');

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
        el.querySelector('[data-style="widget:icon"]').setAttribute('list', iconList.id);

        el.querySelector('.pp-properties-shapes').appendChild(this.shapes.el);
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
        el.querySelector('[data-field="anchorMode"]').addEventListener('change', (e) => {
            this.hooks.onAnchorChange(e.target.value === 'free' ? { anchorMode: 'free', anchorTarget: null } : { anchorMode: 'anchored' });
        });
        el.querySelector('[data-field="themeId"]').addEventListener('change', (e) => this.hooks.onThemeChange({ themeId: e.target.value }));
        el.querySelector('[data-field="themeVariant"]').addEventListener('change', (e) => this.hooks.onThemeChange({ themeVariant: e.target.value }));
        el.querySelector('[data-field="anchorTarget"]').addEventListener('change', (e) => {
            this.hooks.onAnchorChange({ anchorMode: 'anchored', anchorTarget: e.target.value || null });
        });

        const field = (key) => el.querySelector(`[data-el="${key}"]`);
        // Switching type: an element still at the old type's default size
        // takes the new type's default size (a gauge in a 136x32 text box
        // would be tiny); a hand-sized element keeps its size.
        field('type').addEventListener('change', (e) => {
            const element = this.#selected();
            if (!element) return;
            const type = e.target.value;
            const patch = { type };
            // Shapes and free text show no variable - drop the binding so
            // its preset isn't kept active for nothing.
            if (isUnboundType(type)) patch.binding = null;
            if (type === 'free-text' && !element.content) patch.content = elementLabel(element, this.#def(element));
            const [oldW, oldH] = DEFAULT_TYPE_SIZES[element.type] ?? [];
            const [newW, newH] = DEFAULT_TYPE_SIZES[type] ?? [];
            if (newW && element.width === oldW && element.height === oldH) {
                Object.assign(patch, clampElementGeometry(
                    { x: element.x, y: element.y, width: newW, height: newH },
                    this.panel.body.clientWidth, this.panel.body.clientHeight, 'width',
                ));
            }
            this.hooks.onElementChange(element.id, patch);
        });
        field('role').addEventListener('change', (e) => this.#change({ role: e.target.value.trim() }));
        field('binding').addEventListener('change', (e) => {
            const name = e.target.value.trim();
            this.#change({ binding: name ? { name } : null });
        });
        field('showLabel').addEventListener('change', (e) => this.#change({ showLabel: e.target.checked }));
        field('labelOverride').addEventListener('change', (e) => this.#change({ labelOverride: e.target.value.trim() }));
        field('format').addEventListener('change', (e) => this.#change({ format: e.target.value }));
        field('formatPattern').addEventListener('input', (e) => this.#change({ formatPattern: e.target.value }));
        field('content').addEventListener('input', (e) => this.#change({ content: e.target.value.slice(0, MAX_FREE_TEXT_LENGTH) }));
        field('preset').addEventListener('change', (e) => {
            const preset = TEXT_PRESETS.find(([id]) => id === e.target.value);
            e.target.value = '';
            if (preset) this.#commitStyles(preset[2]);
        });
        for (const button of el.querySelectorAll('[data-font-field]')) {
            button.addEventListener('click', () => this.#openFontPicker(button.dataset.fontField, button));
        }
        for (const button of el.querySelectorAll('[data-font-reset]')) {
            button.addEventListener('click', () => {
                closeFontPicker();
                this.#commitStyles(button.dataset.fontReset === 'fontFamily'
                    ? { fontFamily: null, fontWeight: null, fontStyle: null, fontAxes: null }
                    : { labelFontFamily: null });
            });
        }
        const elementZ = field('zIndex');
        elementZ.addEventListener('input', () => {
            if (Number.isFinite(elementZ.valueAsNumber)) this.#change({ zIndex: Math.round(elementZ.valueAsNumber) });
        });
        elementZ.addEventListener('change', () => { elementZ.value = String(this.#selected()?.zIndex ?? 0); });
        field('imageOpacity').addEventListener('input', (e) => this.#change({ opacity: Math.round(Number(e.target.value) * 100) / 100 }));
        field('imageFit').addEventListener('change', (e) => this.#change({ fit: e.target.value }));
        field('imageClip').addEventListener('change', (e) => this.#change({ clipShape: e.target.value }));
        field('imageRadius').addEventListener('input', (e) => {
            if (Number.isFinite(e.target.valueAsNumber)) this.#change({ borderRadius: Math.round(e.target.valueAsNumber) });
        });
        field('imageBorderWidth').addEventListener('input', (e) => {
            if (!Number.isFinite(e.target.valueAsNumber)) return;
            const [min, max] = IMAGE_BORDER_WIDTH_LIMITS;
            this.#change({ borderWidth: Math.min(max, Math.max(min, Math.round(e.target.valueAsNumber))) });
        });
        field('imageBorderColor').addEventListener('input', (e) => this.#change({ borderColor: e.target.value }));
        field('clockOpacity').addEventListener('input', (e) => this.#change({ opacity: Math.round(Number(e.target.value) * 100) / 100 }));
        for (const select of el.querySelectorAll('[data-clock-image]')) {
            const key = select.dataset.clockImage;
            select.addEventListener('focus', () => void loadCatalog());
            select.addEventListener('change', () => {
                if (select.value === '') this.#commitClockImage(key, null);
                else if (select.value === CLOCK_URL_CHOICE) this.#commitClockImage(key, el.querySelector(`[data-clock-url="${key}"]`).value.trim());
                else if (select.value.startsWith(CLOCK_ASSET_CHOICE)) this.#commitClockImage(key, select.value.slice(CLOCK_ASSET_CHOICE.length));
                else this.#commitClockImage(key, { variable: select.value });
            });
        }
        for (const input of el.querySelectorAll('[data-clock-url]')) {
            input.addEventListener('input', () => this.#commitClockImage(input.dataset.clockUrl, input.value.trim()));
        }
        for (const button of el.querySelectorAll('[data-arrange]')) {
            button.addEventListener('click', () => {
                const element = this.#selected();
                if (element) this.hooks.onArrangeElement(element.id, button.dataset.arrange);
            });
        }
        for (const input of el.querySelectorAll('[data-geo]')) this.#bindGeometryField(input);
        for (const input of el.querySelectorAll('[data-style]')) this.#bindStyleField(input);
        // State Engine doesn't announce new variable definitions, so the lists
        // that offer variables re-read them when you go to use them.
        for (const field of [el.querySelector('[data-style="panel:backgroundImageVariable"]'), el.querySelector('[data-el="binding"]')]) {
            field.addEventListener('focus', () => void loadCatalog());
        }
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
