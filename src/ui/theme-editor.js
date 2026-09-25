// Theme Editor: a full-screen modal for the Theme Library
// (src/themes/theme-store.js), opened from the Pretty Panels drawer.
//
//   header   theme dropdown; New, Duplicate, Delete, Import, Export; close
//   left     sections: Theme Identity, Colors, Fonts, Formatting, Assets,
//            Variants, Element Defaults, Components
//   centre   a live preview - an example panel, scene card, variable block,
//            gauges, clock, text block and the component cards - drawn by
//            the real renderers (theme-apply.js, renderElementContent)
//   right    the selected section's fields
//
// Every field saves as it changes (like the rest of Pretty Panels) and the
// preview, and every panel on screen using the theme, update live.
//
// Assets: uploaded images, each stored as a Pretty Panels image variable
// pp_theme_<themeId>_<assetName> (theme-store.js setThemeAsset). Every
// image field - variant images, clock images, component icons - offers the
// theme's assets beside a URL.

import {
    listThemes, getTheme, firstTheme, onThemesChange, updateTheme, createTheme, duplicateTheme, deleteTheme,
    addVariant, renameVariant, deleteVariant, exportThemePayload, importThemeText, setThemeAsset, removeThemeAsset,
} from '../themes/theme-store.js';
import { getPPVariable, resolveImageRef } from '../storage/pp-variables.js';
import { pickImageFile, prepareImage } from './image-upload.js';
import {
    THEME_COLORS, THEME_FONTS, THEME_FORMATTING, NUMBER_FORMATS, VARIANT_FIELDS, ELEMENT_DEFAULT_FIELDS,
    ELEMENT_DEFAULT_GROUPS, COMPONENTS, COMPONENT_FIELDS, FALLBACK_VARIANT, ASSET_SUGGESTIONS, ASSET_NAME_PATTERN, variantNameFor,
} from '../themes/theme-schema.js';
import { themedPanelVars, themeVars, applyVars, applyDecorations } from '../themes/theme-apply.js';
import { buildElementContent, renderElementContent } from '../elements/element-view.js';
import { iconClass } from '../elements/element-style.js';
import { DATETIME_PATTERN_HINT } from '../elements/formats.js';
import { fontRegistry } from '../fonts/font-registry.js';
import { openFontPicker, closeFontPicker } from './font-picker.js';
import { confirmYesNo, promptText, notify } from './dialogs.js';
import { downloadJson, pickJsonFile, safeFilename } from './files.js';

// What a blank theme colour shows: SillyTavern's colour for that role.
const SILLYTAVERN_COLORS = {
    primary: 'var(--SmartThemeQuoteColor)',
    secondary: 'color-mix(in srgb, var(--SmartThemeBodyColor) 16%, transparent)',
    accent: 'var(--SmartThemeQuoteColor)',
    background: 'var(--SmartThemeBlurTintColor)',
    text: 'var(--SmartThemeBodyColor)',
    border: 'var(--SmartThemeBorderColor)',
    glow: 'var(--SmartThemeQuoteColor)',
};
// A blank variant colour shows the theme colour it falls back to.
const VARIANT_COLOR_FALLBACK = { background: 'background', borderColor: 'border', accent: 'accent' };

const SECTIONS = [
    ['identity', 'Theme Identity', 'fa-id-card'],
    ['colors', 'Colors', 'fa-palette'],
    ['fonts', 'Fonts', 'fa-font'],
    ['formatting', 'Formatting', 'fa-calendar-day'],
    ['assets', 'Assets', 'fa-images'],
    ['variants', 'Variants', 'fa-clone'],
    ['elementDefaults', 'Element Defaults', 'fa-sliders'],
    ['components', 'Components', 'fa-id-badge'],
];

let current = null;

export function openThemeEditor() {
    if (!current) current = new ThemeEditor();
    current.open();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text ?? '');
    return div.innerHTML;
}

function make(tag, className = '', html = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (html) el.innerHTML = html;
    return el;
}

class ThemeEditor {
    constructor() {
        this.themeId = firstTheme().id;
        this.section = 'identity';
        this.variant = null;
        this.el = this.#build();
        this.onKey = (e) => {
            if (e.key === 'Escape' && !document.querySelector('.pp-font-picker')) this.close();
        };
    }

    open() {
        if (!this.el.isConnected) {
            document.body.appendChild(this.el);
            document.addEventListener('keydown', this.onKey);
            this.stopWatch = onThemesChange(() => this.#onThemesChanged());
            this.stopFonts = fontRegistry.onChange(() => this.#renderPreview());
            void fontRegistry.load().then(() => this.#renderAll());
        }
        this.#renderAll();
    }

    close() {
        if (!this.el.isConnected) return;
        document.removeEventListener('keydown', this.onKey);
        this.stopWatch?.();
        this.stopFonts?.();
        closeFontPicker();
        this.el.remove();
    }

    get theme() {
        return getTheme(this.themeId) ?? firstTheme();
    }

    // The variant being edited / previewed (always one the theme has).
    get variantName() {
        return variantNameFor(this.theme, this.variant);
    }

    // A field edit already updated its own input; the rest follows.
    #onThemesChanged() {
        if (!getTheme(this.themeId)) {
            this.themeId = firstTheme().id;
            this.#renderAll();
            return;
        }
        this.#renderHeader();
        this.#renderPreview();
    }

    #renderAll() {
        this.#renderHeader();
        this.#renderSidebar();
        this.#renderProperties();
        this.#renderPreview();
    }

    // ---- Chrome ---------------------------------------------------------

    #build() {
        const el = make('div', 'pp-theme-editor-backdrop', `
            <div class="pp-theme-editor" role="dialog" aria-modal="true" aria-label="Theme Editor">
                <div class="pp-theme-editor-header">
                    <span class="pp-theme-editor-title"><i class="fa-solid fa-swatchbook"></i> Theme Editor</span>
                    <select class="text_pole pp-te-theme-select" title="Theme to edit"></select>
                    <div class="pp-te-actions">
                        <button type="button" class="menu_button" data-te="new" title="New theme"><i class="fa-solid fa-plus"></i></button>
                        <button type="button" class="menu_button" data-te="duplicate" title="Duplicate this theme"><i class="fa-solid fa-clone"></i></button>
                        <button type="button" class="menu_button" data-te="import" title="Import a theme (JSON)"><i class="fa-solid fa-file-import"></i></button>
                        <button type="button" class="menu_button" data-te="export" title="Export this theme (JSON)"><i class="fa-solid fa-file-export"></i></button>
                        <button type="button" class="menu_button pp-danger" data-te="delete" title="Delete this theme"><i class="fa-solid fa-trash-can"></i></button>
                    </div>
                    <button type="button" class="pp-properties-close" data-te="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="pp-theme-editor-body">
                    <nav class="pp-te-sidebar"></nav>
                    <div class="pp-te-preview-wrap">
                        <div class="pp-te-preview-bar">
                            <span>Preview</span>
                            <label>Variant <select class="text_pole pp-te-preview-variant"></select></label>
                        </div>
                        <div class="pp-te-preview"></div>
                    </div>
                    <div class="pp-te-props"></div>
                </div>
            </div>
        `);
        el.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (e.target === el) this.close();
        });
        el.querySelector('[data-te="close"]').addEventListener('click', () => this.close());
        el.querySelector('.pp-te-theme-select').addEventListener('change', (e) => {
            this.themeId = e.target.value;
            this.variant = null;
            this.#renderAll();
        });
        el.querySelector('.pp-te-preview-variant').addEventListener('change', (e) => {
            this.variant = e.target.value;
            if (this.section === 'variants') this.#renderProperties();
            this.#renderPreview();
        });
        el.querySelector('[data-te="new"]').addEventListener('click', () => {
            this.themeId = createTheme().id;
            this.variant = null;
            this.section = 'identity';
            this.#renderAll();
        });
        el.querySelector('[data-te="duplicate"]').addEventListener('click', () => {
            const copy = duplicateTheme(this.themeId);
            if (copy) {
                this.themeId = copy.id;
                this.#renderAll();
            }
        });
        el.querySelector('[data-te="delete"]').addEventListener('click', () => void this.#delete());
        el.querySelector('[data-te="import"]').addEventListener('click', () => void this.#import());
        el.querySelector('[data-te="export"]').addEventListener('click', () => void this.#export());
        return el;
    }

    async #delete() {
        const theme = this.theme;
        if (listThemes().length <= 1) {
            notify('warning', 'The last theme can\'t be deleted - create another one first.');
            return;
        }
        const ok = await confirmYesNo(`Delete the theme "${theme.name}"? Panels using it switch to the first theme in the list. This cannot be undone.`);
        if (!ok) return;
        deleteTheme(theme.id);
        this.themeId = firstTheme().id;
        this.variant = null;
        this.#renderAll();
    }

    async #import() {
        const text = await pickJsonFile();
        if (text === null) return;
        try {
            const theme = await importThemeText(text);
            this.themeId = theme.id;
            this.variant = null;
            this.#renderAll();
            notify('success', `Imported the theme "${theme.name}".`);
        } catch (err) {
            notify('error', err.message);
        }
    }

    async #export() {
        try {
            const payload = await exportThemePayload(this.themeId);
            if (payload) downloadJson(`${safeFilename(this.theme.name)}.pp-theme.json`, payload);
        } catch (err) {
            notify('error', err.message);
        }
    }

    #renderHeader() {
        const select = this.el.querySelector('.pp-te-theme-select');
        if (select !== document.activeElement) {
            select.replaceChildren(...listThemes().map((t) => new Option(t.name, t.id)));
            select.value = this.theme.id;
        }
        const variants = this.el.querySelector('.pp-te-preview-variant');
        variants.replaceChildren(...Object.keys(this.theme.variants).map((name) => new Option(name, name)));
        variants.value = this.variantName;
    }

    #renderSidebar() {
        const nav = this.el.querySelector('.pp-te-sidebar');
        nav.replaceChildren(...SECTIONS.map(([id, label, icon]) => {
            const button = make('button', `pp-te-nav${id === this.section ? ' pp-active' : ''}`, `<i class="fa-solid ${icon}"></i><span>${label}</span>`);
            button.type = 'button';
            button.addEventListener('click', () => {
                this.section = id;
                closeFontPicker();
                this.#renderSidebar();
                this.#renderProperties();
            });
            return button;
        }));
    }

    // ---- Properties -------------------------------------------------------

    // Stores one value at a dotted path inside the theme ('' / null
    // removes it where that means "unset").
    #set(path, value, { remove = false } = {}) {
        updateTheme(this.themeId, (draft) => {
            const keys = path.split('.');
            const last = keys.pop();
            let target = draft;
            for (const key of keys) {
                target[key] ??= {};
                target = target[key];
            }
            if (remove && (value === '' || value === null || value === undefined)) delete target[last];
            else target[last] = value;
        });
    }

    #get(path) {
        return path.split('.').reduce((obj, key) => obj?.[key], this.theme);
    }

    #renderProperties() {
        const props = this.el.querySelector('.pp-te-props');
        props.replaceChildren();
        const heading = SECTIONS.find(([id]) => id === this.section)?.[1] ?? '';
        props.appendChild(make('h3', 'pp-te-heading', escapeHtml(heading)));
        const add = (node) => props.appendChild(node);
        const theme = this.theme;

        if (this.section === 'identity') {
            add(this.#field({ label: 'Name', type: 'text', value: theme.name, onChange: (v) => this.#set('name', v.trim() || 'Theme') }));
            add(this.#field({ label: 'Description', type: 'textarea', value: theme.description, onChange: (v) => this.#set('description', v) }));
            add(this.#field({ label: 'Version', type: 'number', value: theme.version, limits: [1, 9999], onChange: (v) => this.#set('version', v ?? 1) }));
            add(this.#field({ label: 'Id', type: 'readonly', value: theme.id }));
            add(make('small', 'pp-field-info', 'The first theme in the list is the one new panels (and panels from before themes) use.'));
        } else if (this.section === 'colors') {
            add(make('small', 'pp-field-info', 'Any CSS colour. Blank uses SillyTavern\'s own colour for that role.'));
            for (const [key, label, hint] of THEME_COLORS) {
                add(this.#field({ label, hint, type: 'color', value: theme.colors[key], fallback: SILLYTAVERN_COLORS[key], placeholder: 'SillyTavern', onChange: (v) => this.#set(`colors.${key}`, v) }));
            }
        } else if (this.section === 'fonts') {
            for (const [key, label, hint] of THEME_FONTS) {
                add(this.#field({ label, hint, type: 'font', value: theme.fonts[key], onChange: (v) => this.#set(`fonts.${key}`, v) }));
            }
        } else if (this.section === 'formatting') {
            for (const [key, label, hint] of THEME_FORMATTING) {
                if (key === 'number') {
                    add(this.#field({ label, hint, type: 'select', options: NUMBER_FORMATS, value: theme.formatting.number, onChange: (v) => this.#set('formatting.number', v) }));
                } else {
                    add(this.#field({ label, hint, type: 'text', value: theme.formatting[key], placeholder: key === 'time' ? '{HH}:{mm}' : '{monthName} {day}, {year}', onChange: (v) => this.#set(`formatting.${key}`, v) }));
                }
            }
            add(make('small', 'pp-field-info', escapeHtml(DATETIME_PATTERN_HINT)));
        } else if (this.section === 'assets') {
            this.#renderAssets(add);
        } else if (this.section === 'variants') {
            this.#renderVariants(add);
        } else if (this.section === 'elementDefaults') {
            add(make('small', 'pp-field-info', 'Used by elements on this theme\'s panels wherever the element itself leaves a property unset.'));
            for (const [group, label] of ELEMENT_DEFAULT_GROUPS) {
                add(make('div', 'pp-te-group', escapeHtml(label)));
                for (const field of ELEMENT_DEFAULT_FIELDS[group]) add(this.#defaultField(`elementDefaults.${group}`, field));
            }
        } else if (this.section === 'components') {
            add(make('small', 'pp-field-info', 'Card looks for scene, quest, time and clock cards. Shown in the preview.'));
            for (const [key, label] of COMPONENTS) {
                add(make('div', 'pp-te-group', escapeHtml(label)));
                for (const field of COMPONENT_FIELDS) add(this.#defaultField(`components.${key}`, field));
            }
        }
    }

    // Uploads an image as asset `assetName` (new or replacing).
    async #upload(assetName) {
        const file = await pickImageFile();
        if (!file) return;
        try {
            setThemeAsset(this.themeId, assetName, await prepareImage(file));
            this.#renderProperties();
        } catch (err) {
            notify('error', err.message);
        }
    }

    #renderAssets(add) {
        const assets = Object.entries(this.theme.assets);
        add(make('small', 'pp-field-info', 'Images stored with this theme (in Pretty Panels\' settings, as variables named pp_theme_&lt;theme&gt;_&lt;asset&gt;). Pick them in any image field: variant images, clock images, component icons. Uploads are scaled to fit 1024px.'));

        const row = make('div', 'pp-te-asset-add');
        const nameInput = make('input', 'text_pole');
        nameInput.type = 'text';
        nameInput.placeholder = 'asset name, e.g. backdrop';
        const list = make('datalist');
        list.id = `pp-te-asset-names-${Math.random().toString(36).slice(2, 8)}`;
        list.replaceChildren(...ASSET_SUGGESTIONS.filter((n) => !this.theme.assets[n]).map((n) => new Option(n, n)));
        nameInput.setAttribute('list', list.id);
        const upload = make('button', 'menu_button', '<i class="fa-solid fa-upload"></i><span>Upload image…</span>');
        upload.type = 'button';
        upload.addEventListener('click', () => {
            const name = nameInput.value.trim();
            if (!ASSET_NAME_PATTERN.test(name)) {
                notify('warning', 'Give the asset a name first: letters, digits, "_" and "-", starting with a letter or digit.');
                nameInput.focus();
                return;
            }
            void this.#upload(name);
        });
        row.append(nameInput, list, upload);
        add(row);

        if (assets.length === 0) add(make('div', 'pp-te-empty', 'No assets yet.'));
        for (const [assetName, ref] of assets) {
            const record = getPPVariable(ref);
            const item = make('div', 'pp-te-asset');
            const thumb = make('div', 'pp-te-asset-thumb');
            const url = resolveImageRef(ref);
            if (url) thumb.style.backgroundImage = `url("${url}")`;
            const info = make('div', 'pp-te-asset-info', `
                <b>${escapeHtml(assetName)}</b>
                <code>${escapeHtml(ref)}</code>
                <small>${record ? `${record.width} × ${record.height} · ${Math.max(1, Math.round(record.bytes / 1024))} KB · ${escapeHtml(record.mime)}` : 'Missing image'}</small>`);
            const replace = make('button', 'menu_button', '<i class="fa-solid fa-arrow-up-from-bracket"></i>');
            replace.type = 'button';
            replace.title = 'Replace the image (everything using it updates)';
            replace.addEventListener('click', () => void this.#upload(assetName));
            const remove = make('button', 'menu_button pp-danger', '<i class="fa-solid fa-trash-can"></i>');
            remove.type = 'button';
            remove.title = 'Delete this asset';
            remove.addEventListener('click', async () => {
                if (!(await confirmYesNo(`Delete the asset "${assetName}"? Anything using it shows no image.`))) return;
                removeThemeAsset(this.themeId, assetName);
                this.#renderProperties();
            });
            item.append(thumb, info, replace, remove);
            add(item);
        }
    }

    #renderVariants(add) {
        const theme = this.theme;
        const name = this.variantName;
        const row = make('div', 'pp-te-variant-row');
        const select = make('select', 'text_pole');
        select.replaceChildren(...Object.keys(theme.variants).map((n) => new Option(n, n)));
        select.value = name;
        select.addEventListener('change', () => {
            this.variant = select.value;
            this.#renderHeader();
            this.#renderProperties();
            this.#renderPreview();
        });
        const button = (icon, title, onClick) => {
            const b = make('button', 'menu_button', `<i class="fa-solid ${icon}"></i>`);
            b.type = 'button';
            b.title = title;
            b.addEventListener('click', onClick);
            return b;
        };
        row.append(select,
            button('fa-plus', 'Add a variant (a copy of this one)', async () => {
                const added = addVariant(this.themeId, await promptText('Name for the new variant:', ''), name);
                if (added) this.variant = added;
                this.#renderAll();
            }),
            button('fa-pen', 'Rename this variant', async () => {
                const to = await promptText(`Rename the variant "${name}" to:`, name);
                if (to && renameVariant(this.themeId, name, to)) this.variant = to.trim();
                else if (to && to !== name) notify('warning', `A variant called "${to}" already exists.`);
                this.#renderAll();
            }),
            button('fa-trash-can', 'Delete this variant', async () => {
                if (Object.keys(theme.variants).length <= 1) {
                    notify('warning', 'A theme needs at least one variant.');
                    return;
                }
                if (!(await confirmYesNo(`Delete the variant "${name}"? Panels using it switch to this theme's default variant.`))) return;
                deleteVariant(this.themeId, name);
                this.variant = null;
                this.#renderAll();
            }));
        add(row);
        add(make('small', 'pp-field-info', 'A variant is one panel look. Panels choose theirs in Panel Properties; "default" is used when a panel hasn\'t chosen.'));
        for (const field of VARIANT_FIELDS) {
            const role = VARIANT_COLOR_FALLBACK[field.key];
            add(this.#field({
                ...field,
                ...(role ? { fallback: theme.colors[role] || SILLYTAVERN_COLORS[role], placeholder: 'theme colour' } : {}),
                value: theme.variants[name][field.key],
                onChange: (v) => this.#set(`variants.${name}.${field.key}`, v ?? FALLBACK_VARIANT[field.key]),
            }));
        }
    }

    // A field whose blank value means "unset" (element defaults, components).
    #defaultField(base, field) {
        const stored = this.#get(`${base}.${field.key}`);
        const value = field.boolean ? (stored === true ? 'true' : stored === false ? 'false' : '') : stored;
        return this.#field({
            ...field,
            value,
            onChange: (v) => this.#set(`${base}.${field.key}`, field.boolean ? (v === '' ? '' : v === 'true') : v, { remove: true }),
        });
    }

    // One labelled input. onChange receives the new value (numbers as
    // numbers, null when blank).
    #field({ label, hint, type, value, options = [], limits = [0, 100], step = 1, unit = '', placeholder = '', fallback = '', onChange }) {
        const row = make('div', `pp-te-field pp-te-field-${type}`);
        row.appendChild(make('span', 'pp-te-label', escapeHtml(label)));
        const controls = make('div', 'pp-te-controls');
        row.appendChild(controls);
        if (hint) row.title = hint;

        if (type === 'readonly') {
            controls.appendChild(make('code', 'pp-te-readonly', escapeHtml(value)));
        } else if (type === 'text' || type === 'textarea') {
            const input = make(type === 'textarea' ? 'textarea' : 'input', 'text_pole');
            if (type === 'text') input.type = 'text';
            else input.rows = 3;
            input.value = value ?? '';
            input.placeholder = placeholder;
            input.addEventListener('input', () => onChange(input.value));
            controls.appendChild(input);
        } else if (type === 'number') {
            const input = make('input', 'text_pole');
            input.type = 'number';
            [input.min, input.max] = limits.map(String);
            input.step = String(step);
            input.placeholder = 'default';
            input.value = Number.isFinite(value) ? String(value) : '';
            const read = () => {
                if (input.value.trim() === '') return null;
                if (!Number.isFinite(input.valueAsNumber)) return undefined;
                const n = step < 1 ? Math.round(input.valueAsNumber / step) * step : Math.round(input.valueAsNumber);
                return Math.min(limits[1], Math.max(limits[0], Math.round(n * 1000) / 1000));
            };
            input.addEventListener('input', () => {
                const v = read();
                if (v !== undefined) onChange(v);
            });
            input.addEventListener('change', () => {
                const v = read();
                input.value = v === null || v === undefined ? '' : String(v);
            });
            controls.appendChild(input);
            if (unit) controls.appendChild(make('span', 'pp-style-unit', escapeHtml(unit)));
        } else if (type === 'select' || type === 'variant') {
            const select = make('select', 'text_pole');
            const list = type === 'variant'
                ? [['', 'Default variant'], ...Object.keys(this.theme.variants).map((n) => [n, n])]
                : options;
            select.replaceChildren(...list.map(([id, text]) => new Option(text, id)));
            select.value = value ?? '';
            if (select.value !== (value ?? '') && value) select.appendChild(new Option(`${value} (missing)`, value));
            select.value = value ?? '';
            select.addEventListener('change', () => onChange(select.value));
            controls.appendChild(select);
        } else if (type === 'color') {
            const picker = make('input');
            picker.type = 'color';
            const textInput = make('input', 'text_pole pp-te-color-text');
            textInput.type = 'text';
            textInput.placeholder = placeholder || 'default';
            textInput.value = value ?? '';
            const reset = make('button', 'pp-properties-close', '<i class="fa-solid fa-rotate-left"></i>');
            reset.type = 'button';
            reset.title = 'Clear (back to the default)';
            const sync = () => {
                picker.value = this.#hex(textInput.value || fallback);
                reset.hidden = !textInput.value;
            };
            picker.addEventListener('input', () => {
                textInput.value = picker.value;
                reset.hidden = false;
                onChange(picker.value);
            });
            textInput.addEventListener('input', () => {
                sync();
                onChange(textInput.value.trim());
            });
            reset.addEventListener('click', () => {
                textInput.value = '';
                sync();
                onChange('');
            });
            sync();
            controls.append(picker, textInput, reset);
        } else if (type === 'font') {
            const button = make('button', 'menu_button pp-font-button', '<i class="fa-solid fa-font"></i><span class="pp-font-button-name"></span>');
            button.type = 'button';
            const name = button.querySelector('.pp-font-button-name');
            const reset = make('button', 'pp-properties-close', '<i class="fa-solid fa-rotate-left"></i>');
            reset.type = 'button';
            reset.title = 'Back to the default font';
            let currentId = value || '';
            const show = (id) => {
                currentId = id;
                const font = id ? fontRegistry.get(id) : null;
                name.textContent = font?.display_name ?? (id ? `${id} (missing)` : 'Default (inherit)');
                name.style.fontFamily = id ? fontRegistry.cssFamily(id) : '';
                reset.hidden = !id;
            };
            button.addEventListener('click', () => openFontPicker({
                anchor: button,
                title: label,
                value: { fontFamily: currentId || 'inherit' },
                previewText: this.theme.name,
                onChange: (v) => {
                    const id = v.fontFamily === 'inherit' ? '' : v.fontFamily;
                    show(id);
                    onChange(id);
                },
            }));
            reset.addEventListener('click', () => {
                closeFontPicker();
                show('');
                onChange('');
            });
            show(value);
            controls.append(button, reset);
        } else if (type === 'image' || type === 'icon') {
            // A dropdown - none, a URL (or, for icons, a Font Awesome icon
            // name), or one of the theme's assets - plus the text field for
            // the URL / icon name and a thumbnail.
            const TEXT = '__text';
            const assets = Object.entries(this.theme.assets);
            const refs = new Set(assets.map(([, ref]) => ref));
            const stored = typeof value === 'string' ? value : '';
            const select = make('select', 'text_pole');
            const options = [new Option(type === 'icon' ? 'Default icon' : 'None', ''), new Option(type === 'icon' ? 'Font Awesome icon…' : 'Image URL…', TEXT)];
            if (assets.length) {
                const group = document.createElement('optgroup');
                group.label = 'Theme assets';
                for (const [assetName, ref] of assets) group.appendChild(new Option(assetName, ref));
                options.push(group);
            }
            select.replaceChildren(...options);
            const input = make('input', 'text_pole');
            input.type = 'text';
            input.placeholder = type === 'icon' ? 'e.g. scroll' : 'image URL';
            input.value = stored && !refs.has(stored) ? stored : '';
            select.value = !stored ? '' : refs.has(stored) ? stored : TEXT;
            const thumb = make('div', 'pp-te-thumb');
            const show = () => {
                const ref = select.value === TEXT ? input.value.trim() : select.value;
                const icon = type === 'icon' && select.value === TEXT;
                const url = icon ? null : resolveImageRef(ref);
                thumb.style.backgroundImage = url ? `url("${url.replace(/["\\]/g, '')}")` : '';
                thumb.innerHTML = icon && iconClass(ref) ? `<i class="${escapeHtml(iconClass(ref))}"></i>` : '';
                thumb.hidden = !url && !thumb.innerHTML;
                input.hidden = select.value !== TEXT;
            };
            select.addEventListener('change', () => {
                show();
                onChange(select.value === TEXT ? input.value.trim() : select.value);
                if (select.value === TEXT) input.focus();
            });
            input.addEventListener('input', () => {
                show();
                onChange(input.value.trim());
            });
            show();
            const box = make('div', 'pp-te-image-field');
            box.append(select, input);
            controls.append(box, thumb);
        }
        return row;
    }

    // #rrggbb for any CSS colour (including var(...)), resolved in the
    // editor's own context; black when it can't be read.
    #hex(value) {
        const probe = this.el.querySelector('.pp-te-probe') ?? this.el.appendChild(make('span', 'pp-te-probe'));
        probe.style.color = '';
        probe.style.color = value || 'transparent';
        const m = getComputedStyle(probe).color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
        return m ? `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : '#000000';
    }

    // ---- Preview ----------------------------------------------------------

    // A preview panel: the real panel structure, styled by the theme and
    // `variantName`. Returns { panel, canvas }.
    #panel(width, height, variantName, extraVars = {}) {
        const theme = this.theme;
        const variant = theme.variants[variantNameFor(theme, variantName)];
        const panel = make('div', 'pp-panel pp-te-sample', `
            <div class="pp-panel-box">
                <div class="pp-panel-image" aria-hidden="true"></div>
                <div class="pp-panel-texture" aria-hidden="true"></div>
                <div class="pp-panel-accent" aria-hidden="true"></div>
                <div class="pp-panel-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
                <div class="pp-panel-body"><div class="pp-panel-canvas"></div></div>
            </div>`);
        Object.assign(panel.style, { width: `${width}px`, height: `${height}px` });
        applyVars(panel, { ...themedPanelVars(theme, variant, {}), ...extraVars });
        applyDecorations(panel, variant);
        return { panel, canvas: panel.querySelector('.pp-panel-canvas') };
    }

    // Renders one element into a preview canvas with the real renderer.
    #element(canvas, element, entry) {
        const el = buildElementContent();
        const full = { id: 'preview', role: '', showLabel: true, labelOverride: '', format: 'auto', formatPattern: '', zIndex: 2, style: {}, widget: {}, shape: {}, clock: {}, content: '', binding: { name: 'preview' }, ...element };
        Object.assign(el.style, { left: `${full.x}px`, top: `${full.y}px`, width: `${full.width}px`, height: `${full.height}px` });
        canvas.appendChild(el);
        renderElementContent(el, full, entry, this.theme);
        return el;
    }

    #card(title, body) {
        const wrap = make('figure', 'pp-te-card');
        wrap.appendChild(body);
        wrap.appendChild(make('figcaption', '', escapeHtml(title)));
        return wrap;
    }

    // A component card (scene, quest, time, clock).
    #componentCard(key, title, subtitle, fallbackIcon) {
        const settings = this.theme.components[key] ?? {};
        const extra = settings.accent ? { '--ppt-accent': settings.accent } : {};
        const { panel, canvas } = this.#panel(230, 84, settings.variant || this.variantName, extra);
        const size = Number.isFinite(settings.titleSize) ? settings.titleSize : 16;
        const asset = typeof settings.icon === 'string' && this.theme.assets && Object.values(this.theme.assets).includes(settings.icon)
            ? resolveImageRef(settings.icon) : null;
        const iconHtml = asset
            ? `<img class="pp-te-component-image" src="${escapeHtml(asset)}" alt="" />`
            : `<i class="${escapeHtml(iconClass(settings.icon) ?? `fa-solid fa-${fallbackIcon}`)} pp-te-component-icon"></i>`;
        canvas.appendChild(make('div', 'pp-te-component', `
            ${iconHtml}
            <div>
                <div class="pp-te-component-title" style="font-size:${size}px">${escapeHtml(title)}</div>
                <div class="pp-te-component-sub">${escapeHtml(subtitle)}</div>
            </div>`));
        return panel;
    }

    #renderPreview() {
        const root = this.el.querySelector('.pp-te-preview');
        if (!root) return;
        const theme = this.theme;
        const variant = this.variantName;
        root.replaceChildren();
        applyVars(root, themeVars(theme, theme.variants[variant]));
        const now = Math.floor(Date.now() / 1000);
        const number = (value, max = 100) => ({ value, def: { type: 'number', min: 0, max } });
        const datetime = { value: now, def: { type: 'datetime', calendar: 'gregorian' } };

        // Example panel
        {
            const { panel, canvas } = this.#panel(260, 150, variant);
            this.#element(canvas, { type: 'free-text', x: 8, y: 6, width: 240, height: 30, content: 'Adventurer', binding: null, style: { fontSize: 20 } });
            this.#element(canvas, { type: 'text', x: 8, y: 40, width: 150, height: 26, labelOverride: 'Health' }, number(72));
            this.#element(canvas, { type: 'bar-horizontal', x: 8, y: 70, width: 240, height: 14 }, number(72));
            this.#element(canvas, { type: 'text', x: 8, y: 92, width: 240, height: 24, labelOverride: 'Mood' }, { value: 'Determined', def: { type: 'string' } });
            this.#element(canvas, { type: 'composite-bar', x: 8, y: 118, width: 240, height: 22, widget: { icon: 'bolt', labelText: 'Stamina' } }, number(40));
            root.appendChild(this.#card('Example panel', panel));
        }
        // Scene card
        root.appendChild(this.#card('Scene card', this.#componentCard('sceneCard', 'The Rusty Anchor', 'Harbour district · evening, light rain', 'location-dot')));
        // Variable block
        {
            const { panel, canvas } = this.#panel(260, 120, variant);
            this.#element(canvas, { type: 'text', x: 8, y: 6, width: 240, height: 24, labelOverride: 'Gold' }, number(1250300.5, 10000000));
            this.#element(canvas, { type: 'text', x: 8, y: 32, width: 240, height: 24, labelOverride: 'Date', format: 'full' }, datetime);
            this.#element(canvas, { type: 'text', x: 8, y: 58, width: 240, height: 24, labelOverride: 'Day', format: 'date' }, datetime);
            this.#element(canvas, { type: 'text', x: 8, y: 84, width: 240, height: 24, labelOverride: 'Time', format: 'time' }, datetime);
            root.appendChild(this.#card('Variable block', panel));
        }
        // Gauges
        {
            const { panel, canvas } = this.#panel(200, 110, variant);
            this.#element(canvas, { type: 'gauge-circle', x: 6, y: 8, width: 90, height: 90 }, number(65));
            this.#element(canvas, { type: 'gauge-semicircle', x: 100, y: 30, width: 92, height: 56 }, number(40));
            root.appendChild(this.#card('Gauge', panel));
        }
        // Clock
        {
            const { panel, canvas } = this.#panel(140, 140, variant);
            this.#element(canvas, { type: 'analogClock', x: 4, y: 4, width: 128, height: 128, showLabel: false }, datetime);
            root.appendChild(this.#card('Clock', panel));
        }
        // Text block
        {
            const { panel, canvas } = this.#panel(260, 120, variant);
            this.#element(canvas, { type: 'free-text', x: 8, y: 6, width: 240, height: 28, content: 'Chapter One', binding: null, style: { fontSize: 18 } });
            this.#element(canvas, {
                type: 'free-text', x: 8, y: 36, width: 240, height: 76, binding: null,
                content: 'The road north was quiet. Too quiet, some would say - and they would be right.',
                style: { fontSize: 13, fontFamily: theme.fonts.valueFont || undefined },
            });
            root.appendChild(this.#card('Text block', panel));
        }
        // The other component cards
        root.appendChild(this.#card('Quest card', this.#componentCard('questCard', 'Find the lost lighthouse key', 'Main quest · 2 of 3 clues', 'scroll')));
        root.appendChild(this.#card('Time card', this.#componentCard('timeCard', 'Day 12 of Highsun', 'Three days until the festival', 'hourglass-half')));
        root.appendChild(this.#card('Clock card', this.#componentCard('clockCard', new Date().toTimeString().slice(0, 5), 'Local time', 'clock')));
    }
}
