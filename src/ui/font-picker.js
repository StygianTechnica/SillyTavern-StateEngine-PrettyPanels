// Font Picker: a popover for choosing an element's font, opened from the
// Font buttons in Element Styling. One picker is open at a time.
//
//   - category filters (UI, Fantasy, Sci-Fi, Gothic, Handwritten, HUD,
//     System, My Fonts), search, and editable preview text
//   - every font listed in its own typeface
//   - for the chosen font: a large preview (FontPreviewRenderer), a weight
//     slider, italic, and a slider per variable axis (width, monospace,
//     casual, ...)
//   - "Add your own font": upload a .ttf/.otf/.woff/.woff2, choose the
//     character sets to keep; only the sanitized subset is stored
//     (src/fonts/font-ingest.js)
//
// Every change is reported at once through onChange({ fontFamily,
// fontWeight, fontStyle, fontAxes }), like every other properties field.

import { fontRegistry, FONT_CATEGORIES } from '../fonts/font-registry.js';
import { FontPreviewRenderer } from '../fonts/font-preview.js';
import { ingestFontFile, ACCEPT_ATTRIBUTE } from '../fonts/font-ingest.js';
import { CHARSETS, DEFAULT_CHARSETS } from '../fonts/charsets.js';
import { confirmYesNo, notify } from './dialogs.js';

const AXIS_LABELS = {
    wght: 'Weight', wdth: 'Width', slnt: 'Slant', ital: 'Italic', opsz: 'Optical size',
    MONO: 'Monospace', CASL: 'Casual', CRSV: 'Cursive', GRAD: 'Grade',
};
const DEFAULT_PREVIEW = 'The quick brown fox jumps over the lazy dog 0123456789';

export const SANITIZE_WARNING = 'Only a sanitized copy of your font is kept. It is checked in an isolated sandbox, stripped of hinting programs, metadata and every non-essential table, cut down to the characters you choose (plus those in this layout) and converted to WOFF2. The original file is never stored or exported. Fonts whose licence forbids embedding are refused - make sure you may share a font before exporting a layout that uses it.';

let current = null;

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatBytes(n) {
    return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function closeFontPicker() {
    current?.close();
}

// anchor: element to sit beside. value: { fontFamily, fontWeight,
// fontStyle, fontAxes }. getLayoutText(): characters shown in the layout.
export function openFontPicker(options) {
    closeFontPicker();
    current = new FontPicker(options);
    return current;
}

class FontPicker {
    constructor({ anchor, title = 'Font', value = {}, previewText = '', getLayoutText = () => '', onChange, onClose }) {
        this.value = {
            fontFamily: value.fontFamily || 'inherit',
            fontWeight: Number.isFinite(value.fontWeight) ? value.fontWeight : null,
            fontStyle: value.fontStyle === 'italic' ? 'italic' : null,
            fontAxes: value.fontAxes && typeof value.fontAxes === 'object' ? { ...value.fontAxes } : {},
        };
        this.category = '';
        this.previewText = previewText.trim() || DEFAULT_PREVIEW;
        this.getLayoutText = getLayoutText;
        this.onChange = onChange;
        this.onClose = onClose;
        this.el = this.#build(title);
        this.preview = new FontPreviewRenderer(this.el.querySelector('.pp-font-preview'));
        document.body.appendChild(this.el);
        this.#position(anchor);
        this.onKey = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.close();
            }
        };
        document.addEventListener('keydown', this.onKey, true);
        this.stopWatch = fontRegistry.onChange(() => this.#renderList());
        void fontRegistry.load().then(() => {
            this.#renderList();
            this.#renderDetails();
        });
        this.#renderList();
        this.#renderDetails();
    }

    close() {
        if (!this.el.isConnected) return;
        document.removeEventListener('keydown', this.onKey, true);
        this.stopWatch?.();
        this.el.remove();
        if (current === this) current = null;
        this.onClose?.();
    }

    #emit() {
        const axes = Object.fromEntries(Object.entries(this.value.fontAxes).filter(([, v]) => Number.isFinite(v)));
        this.onChange?.({
            fontFamily: this.value.fontFamily,
            fontWeight: this.value.fontWeight,
            fontStyle: this.value.fontStyle,
            fontAxes: Object.keys(axes).length ? axes : null,
        });
    }

    #select(id) {
        const font = fontRegistry.list().find((f) => f.font_id === id);
        if (!font) return;
        this.value.fontFamily = id;
        // Keep only the axes the new font has; keep the weight inside its range.
        const tags = new Set(font.variable_axes.map((a) => a.tag));
        for (const tag of Object.keys(this.value.fontAxes)) if (!tags.has(tag)) delete this.value.fontAxes[tag];
        const wght = font.variable_axes.find((a) => a.tag === 'wght');
        if (wght && Number.isFinite(this.value.fontWeight)) {
            this.value.fontWeight = Math.min(wght.max, Math.max(wght.min, this.value.fontWeight));
        }
        this.#emit();
        this.#renderList();
        this.#renderDetails();
    }

    #renderList() {
        const list = this.el.querySelector('.pp-font-list');
        const query = this.el.querySelector('.pp-font-search').value;
        const fonts = fontRegistry.list({ category: this.category, query });
        for (const chip of this.el.querySelectorAll('[data-category]')) {
            chip.classList.toggle('pp-active', chip.dataset.category === this.category);
        }
        list.replaceChildren();
        if (fonts.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'pp-picker-empty';
            empty.textContent = this.category === 'local' ? 'No fonts of your own yet - add one below.' : 'No fonts match.';
            list.appendChild(empty);
            return;
        }
        for (const font of fonts) {
            const row = document.createElement('div');
            row.className = 'pp-font-row';
            row.dataset.fontId = font.font_id;
            row.classList.toggle('pp-selected', font.font_id === this.value.fontFamily);
            row.innerHTML = `
                <span class="pp-font-row-name"></span>
                <span class="pp-font-row-meta"></span>
                ${font.source === 'local' ? '<button type="button" class="pp-properties-close pp-danger" data-delete title="Delete this uploaded font"><i class="fa-solid fa-trash-can"></i></button>' : ''}`;
            const name = row.querySelector('.pp-font-row-name');
            name.textContent = font.display_name;
            name.style.fontFamily = fontRegistry.cssFamily(font.font_id);
            const axes = font.variable_axes.map((a) => a.tag).join(' ');
            row.querySelector('.pp-font-row-meta').textContent = [
                FONT_CATEGORIES.find(([id]) => id === font.category)?.[1] ?? font.category,
                axes ? `variable: ${axes}` : '',
            ].filter(Boolean).join(' · ');
            row.addEventListener('click', (e) => {
                if (e.target.closest('[data-delete]')) return;
                this.#select(font.font_id);
            });
            row.querySelector('[data-delete]')?.addEventListener('click', () => void this.#delete(font));
            list.appendChild(row);
        }
    }

    async #delete(font) {
        const ok = await confirmYesNo(`Delete the uploaded font "${font.display_name}"? Elements using it fall back to the default font.`);
        if (!ok) return;
        fontRegistry.removeUserFont(font.font_id);
        if (this.value.fontFamily === font.font_id) this.#select('inherit');
        this.#renderDetails();
    }

    #renderDetails() {
        const font = fontRegistry.list().find((f) => f.font_id === this.value.fontFamily)
            ?? fontRegistry.list({ category: 'system' })[0];
        const details = this.el.querySelector('.pp-font-details');
        details.querySelector('.pp-font-details-name').textContent = font.display_name;
        void this.preview.render({ fontId: font.font_id, text: this.previewText, size: 22, ...this.value });

        const sliders = details.querySelector('.pp-font-axes');
        sliders.replaceChildren();
        const wght = font.variable_axes.find((a) => a.tag === 'wght');
        const weightRange = wght ?? { tag: 'wght', min: 100, max: 900, default: 400, step: 100 };
        sliders.appendChild(this.#slider('Weight', weightRange, this.value.fontWeight, (v) => {
            this.value.fontWeight = v;
        }, wght ? 1 : 100));
        for (const axis of font.variable_axes.filter((a) => a.tag !== 'wght')) {
            const step = axis.max - axis.min <= 2 ? 0.01 : 1;
            sliders.appendChild(this.#slider(AXIS_LABELS[axis.tag] ?? axis.tag, axis, this.value.fontAxes[axis.tag], (v) => {
                if (v === null) delete this.value.fontAxes[axis.tag];
                else this.value.fontAxes[axis.tag] = v;
            }, step));
        }

        const italic = details.querySelector('[data-italic]');
        italic.checked = this.value.fontStyle === 'italic';
        details.querySelector('.pp-font-italic-note').textContent = font.source === 'curated' && !font.hasItalic ? '(slanted by the browser)' : '';

        const info = details.querySelector('.pp-font-info');
        const lines = [];
        if (font.source === 'curated') lines.push(`Bundled with Pretty Panels · ${font.license ?? 'OFL-1.1'}`);
        if (font.source === 'system') lines.push('Uses fonts installed on this device.');
        if (font.source === 'local') {
            const s = font.subset_info ?? {};
            lines.push(`Your font · sanitized ${s.original_format ?? ''} → WOFF2, ${formatBytes(s.sanitized_bytes ?? 0)} (was ${formatBytes(s.original_bytes ?? 0)}), ${s.glyph_count ?? '?'} glyphs, ${s.codepoint_count ?? '?'} characters`);
            if (s.tables_removed?.length) lines.push(`Removed: ${s.tables_removed.join(', ')}`);
            if (font.notice?.copyright) lines.push(font.notice.copyright);
            if (font.notice?.license) lines.push(`Licence: ${font.notice.license.slice(0, 200)}${font.notice.license.length > 200 ? '…' : ''}`);
        }
        info.textContent = lines.join('\n');
    }

    // A labelled range input with its number and a reset (to "unset").
    #slider(label, axis, value, apply, step) {
        const row = document.createElement('div');
        row.className = 'pp-font-axis';
        const initial = Number.isFinite(value) ? value : axis.default;
        row.innerHTML = `
            <span class="pp-font-axis-label">${escapeHtml(label)}</span>
            <input type="range" min="${axis.min}" max="${axis.max}" step="${step}" value="${initial}" />
            <span class="pp-font-axis-value"></span>
            <button type="button" class="pp-properties-close pp-style-reset" title="Back to the default"><i class="fa-solid fa-rotate-left"></i></button>`;
        const range = row.querySelector('input');
        const shown = row.querySelector('.pp-font-axis-value');
        const reset = row.querySelector('button');
        const show = (v) => {
            shown.textContent = Number.isFinite(v) ? String(Math.round(v * 100) / 100) : 'auto';
            reset.hidden = !Number.isFinite(v);
        };
        show(value);
        range.addEventListener('input', () => {
            const v = Number(range.value);
            apply(v);
            show(v);
            this.#emit();
            void this.preview.render({ fontId: this.value.fontFamily, text: this.previewText, size: 22, ...this.value });
        });
        reset.addEventListener('click', () => {
            apply(null);
            range.value = String(axis.default);
            show(null);
            this.#emit();
            void this.preview.render({ fontId: this.value.fontFamily, text: this.previewText, size: 22, ...this.value });
        });
        return row;
    }

    async #upload(file) {
        const status = this.el.querySelector('.pp-font-upload-status');
        const button = this.el.querySelector('[data-upload]');
        const charsets = [...this.el.querySelectorAll('[data-charset]:checked')].map((box) => box.dataset.charset);
        if (charsets.length === 0) {
            status.textContent = 'Choose at least one character set.';
            return;
        }
        button.disabled = true;
        status.classList.remove('pp-font-upload-error');
        status.textContent = `Sanitizing "${file.name}"…`;
        try {
            const record = await ingestFontFile(file, { charsets, layoutText: this.getLayoutText() });
            fontRegistry.addUserFont(record);
            status.textContent = `Added "${record.display_name}" (${formatBytes(record.subset_info.sanitized_bytes)}, ${record.subset_info.glyph_count} glyphs).`;
            notify('success', `Added the font "${record.display_name}".`);
            this.category = 'local';
            this.#select(record.font_id);
        } catch (err) {
            status.classList.add('pp-font-upload-error');
            status.textContent = err.message;
        } finally {
            button.disabled = false;
        }
    }

    #build(title) {
        const el = document.createElement('div');
        el.className = 'pp-font-picker';
        el.innerHTML = `
            <div class="pp-properties-header">
                <span class="pp-properties-title">${escapeHtml(title)}</span>
                <button type="button" class="pp-properties-close" data-close aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="pp-font-chips">
                <button type="button" class="pp-font-chip" data-category="">All</button>
                ${FONT_CATEGORIES.map(([id, label]) => `<button type="button" class="pp-font-chip" data-category="${id}">${label}</button>`).join('')}
            </div>
            <div class="pp-font-controls">
                <input type="search" class="text_pole pp-font-search" placeholder="Search fonts…" aria-label="Search fonts" />
                <input type="text" class="text_pole pp-font-preview-text" placeholder="Preview text" aria-label="Preview text" />
            </div>
            <div class="pp-font-list"></div>
            <div class="pp-font-details">
                <div class="pp-font-details-name"></div>
                <div class="pp-font-preview"></div>
                <div class="pp-font-axes"></div>
                <label class="checkbox_label pp-field-check">
                    <input type="checkbox" data-italic /><span>Italic</span><small class="pp-font-italic-note"></small>
                </label>
                <small class="pp-font-info"></small>
            </div>
            <details class="pp-font-upload">
                <summary>Add your own font</summary>
                <div class="pp-font-charsets">
                    ${Object.entries(CHARSETS).map(([id, set]) => `
                        <label class="checkbox_label"><input type="checkbox" data-charset="${id}" ${DEFAULT_CHARSETS.includes(id) ? 'checked' : ''} /><span>${escapeHtml(set.label)}</span></label>`).join('')}
                </div>
                <small class="pp-font-warning"><i class="fa-solid fa-shield-halved"></i> ${escapeHtml(SANITIZE_WARNING)}</small>
                <button type="button" class="menu_button menu_button_icon" data-upload>
                    <i class="fa-solid fa-file-arrow-up"></i><span>Upload font…</span>
                </button>
                <small class="pp-font-upload-status"></small>
            </details>
        `;
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.querySelector('[data-close]').addEventListener('click', () => this.close());
        for (const chip of el.querySelectorAll('[data-category]')) {
            chip.addEventListener('click', () => {
                this.category = chip.dataset.category;
                this.#renderList();
            });
        }
        el.querySelector('.pp-font-search').addEventListener('input', () => this.#renderList());
        const previewInput = el.querySelector('.pp-font-preview-text');
        previewInput.value = this.previewText === DEFAULT_PREVIEW ? '' : this.previewText;
        previewInput.addEventListener('input', () => {
            this.previewText = previewInput.value.trim() || DEFAULT_PREVIEW;
            this.#renderDetails();
        });
        el.querySelector('[data-italic]').addEventListener('change', (e) => {
            this.value.fontStyle = e.target.checked ? 'italic' : null;
            this.#emit();
            this.#renderDetails();
        });
        el.querySelector('[data-upload]').addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = ACCEPT_ATTRIBUTE;
            input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (file) void this.#upload(file);
            });
            input.click();
        });
        return el;
    }

    #position(anchor) {
        const rect = anchor?.getBoundingClientRect?.() ?? { left: 40, right: 40, top: 40 };
        const w = this.el.offsetWidth || 340;
        const h = this.el.offsetHeight || 520;
        let x = rect.right + 8;
        if (x + w > window.innerWidth) x = rect.left - w - 8;
        x = Math.max(4, Math.min(x, window.innerWidth - w - 4));
        const y = Math.max(4, Math.min(rect.top - 40, window.innerHeight - h - 4));
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
    }
}
