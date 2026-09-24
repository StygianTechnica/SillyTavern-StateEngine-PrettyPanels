// FontRegistry: every font Pretty Panels can draw text with, from three
// sources, behind one id space:
//
//   system   the browser's own generic stacks ('inherit', 'sans', 'serif',
//            'mono', 'display' - the ids Element Styling always had)
//   curated  bundled OFL fonts, fonts/curated/manifest.json
//   local    fonts the user uploaded - ONLY their sanitized, subsetted
//            WOFF2 (font-ingest.js), stored in extensionSettings under
//            prettyPanels.userFonts
//
// An element refers to a font by id (element.style.fontFamily). The
// registry turns an id into a CSS font-family value. Every font's faces
// are registered with document.fonts when the registry loads (FontFace
// API - no stylesheet is injected, nothing is fetched from outside the
// extension folder), under the family names "PP_<font_id>" (curated) and
// "UserFont_<id>" (uploaded), so themes can use them too - see
// docs/FONTS.md.

import { getStore, save } from '../storage/store.js';

const MANIFEST_URL = new URL('../../fonts/curated/manifest.json', import.meta.url);
const CURATED_DIR = new URL('../../fonts/curated/', import.meta.url);

export const FONT_CATEGORIES = [
    ['ui', 'UI'],
    ['fantasy', 'Fantasy'],
    ['sci_fi', 'Sci-Fi'],
    ['gothic', 'Gothic'],
    ['handwritten', 'Handwritten'],
    ['hud', 'HUD'],
    ['system', 'System'],
    ['local', 'My Fonts'],
];

const SYSTEM_FONTS = [
    ['inherit', 'Default (inherit)', 'inherit'],
    ['sans', 'Sans Serif', 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
    ['serif', 'Serif', 'Georgia, Cambria, "Times New Roman", Times, serif'],
    ['mono', 'Mono', 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace'],
    ['display', 'Display', 'Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Bold", sans-serif'],
];
export const SYSTEM_FONT_IDS = new Set(SYSTEM_FONTS.map(([id]) => id));

// A stored user font's size cap (base64 characters): keeps settings.json
// sane. A sanitized Latin subset is typically 15-150 KB.
export const MAX_USER_FONT_BASE64 = 2 * 1024 * 1024;

const WOFF2_MAGIC_B64 = 'd09GMg'; // "wOF2"

function quote(family) {
    return `"${family.replace(/["\\]/g, '')}"`;
}

export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function bytesToBase64(bytes) {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}

// A stored/imported user font record is only accepted if it holds a
// WOFF2 (never a raw font) within the size cap.
export function isValidUserFontRecord(record) {
    return !!record && typeof record === 'object'
        && typeof record.font_id === 'string' && /^user-[a-z0-9-]{4,40}$/.test(record.font_id)
        && typeof record.family === 'string' && /^UserFont_[A-Za-z0-9_]{1,40}$/.test(record.family)
        && record.source === 'local'
        && typeof record.sanitized_base64_woff2 === 'string'
        && record.sanitized_base64_woff2.startsWith(WOFF2_MAGIC_B64)
        && record.sanitized_base64_woff2.length <= MAX_USER_FONT_BASE64;
}

function weightRange(axes) {
    const wght = axes?.find((a) => a.tag === 'wght');
    return wght ? `${wght.min} ${wght.max}` : '400';
}

function stretchRange(axes) {
    const wdth = axes?.find((a) => a.tag === 'wdth');
    return wdth ? `${wdth.min}% ${wdth.max}%` : '100%';
}

export class FontRegistry {
    #curated = new Map();
    #faces = new Map(); // font_id -> FontFace[] registered with document.fonts
    #listeners = new Set();
    #ready = null;

    // Loads the curated manifest once. Safe to call repeatedly.
    load() {
        this.#ready ??= fetch(MANIFEST_URL)
            .then((r) => (r.ok ? r.json() : { fonts: [] }))
            .then((manifest) => {
                for (const font of manifest.fonts ?? []) {
                    if (typeof font?.font_id === 'string' && Array.isArray(font.faces)) {
                        this.#curated.set(font.font_id, { ...font, source: 'curated', family: `PP_${font.font_id}` });
                    }
                }
                // Register every font up front so its family name also works
                // in SillyTavern themes / Custom CSS. A curated file is still
                // only downloaded when some text actually uses it.
                for (const id of this.#curated.keys()) this.ensureRegistered(id);
                for (const font of this.userFonts()) this.ensureRegistered(font.font_id);
                this.#emit();
            })
            .catch((err) => console.warn('[PrettyPanels] curated font manifest could not be loaded', err));
        return this.#ready;
    }

    onChange(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }

    #emit() {
        for (const listener of this.#listeners) listener();
    }

    #userFonts() {
        const store = getStore();
        if (!store.userFonts || typeof store.userFonts !== 'object') store.userFonts = {};
        return store.userFonts;
    }

    // Every font as a summary: { font_id, display_name, category, source,
    // variable_axes, fallback_stack, hasItalic }.
    list({ category = '', query = '' } = {}) {
        const q = query.trim().toLowerCase();
        const all = [
            ...SYSTEM_FONTS.map(([id, name, stack]) => ({ font_id: id, display_name: name, category: 'system', source: 'system', variable_axes: [], fallback_stack: stack, hasItalic: true })),
            ...[...this.#curated.values()].map((f) => this.#summary(f)),
            ...Object.values(this.#userFonts()).filter(isValidUserFontRecord).map((f) => this.#summary({ ...f, category: 'local' })),
        ];
        return all.filter((f) => (!category || f.category === category)
            && (!q || f.display_name.toLowerCase().includes(q) || (f.tags ?? []).some((t) => t.includes(q))));
    }

    #summary(font) {
        return {
            font_id: font.font_id,
            display_name: font.display_name,
            category: font.category,
            tags: font.tags ?? [],
            source: font.source,
            variable_axes: font.variable_axes ?? [],
            fallback_stack: font.fallback_stack,
            hasItalic: font.source === 'curated' ? font.faces.some((f) => f.style === 'italic') : false,
            license: font.license ?? null,
            notice: font.notice ?? null,
            subset_info: font.subset_info ?? null,
        };
    }

    // Full record (curated manifest entry or stored user record), or null.
    get(id) {
        if (SYSTEM_FONT_IDS.has(id)) return this.list({ category: 'system' }).find((f) => f.font_id === id);
        if (this.#curated.has(id)) return this.#curated.get(id);
        const user = this.#userFonts()[id];
        return isValidUserFontRecord(user) ? user : null;
    }

    isKnown(id) {
        return !!this.get(id);
    }

    // CSS font-family value for an id; unknown ids fall back to inherit.
    cssFamily(id) {
        const system = SYSTEM_FONTS.find(([sid]) => sid === id);
        if (system) return system[2];
        const font = this.get(id);
        if (!font) return 'inherit';
        this.ensureRegistered(id);
        return `${quote(font.family)}, ${font.fallback_stack || 'sans-serif'}`;
    }

    // Adds the font's faces to document.fonts (idempotent). The browser
    // downloads a curated file only when text actually uses it.
    ensureRegistered(id) {
        if (this.#faces.has(id) || typeof FontFace === 'undefined') return this.#faces.get(id) ?? [];
        const font = this.get(id);
        if (!font || font.source === 'system') return [];
        const faces = [];
        try {
            if (font.source === 'curated') {
                for (const face of font.faces) {
                    faces.push(new FontFace(font.family, `url("${new URL(face.file_path, CURATED_DIR).href}") format("woff2")`, {
                        weight: face.weight,
                        style: face.style,
                        ...(face.stretch ? { stretch: face.stretch } : {}),
                        unicodeRange: face.unicode_range,
                        display: 'swap',
                    }));
                }
            } else {
                faces.push(new FontFace(font.family, base64ToBytes(font.sanitized_base64_woff2), {
                    weight: weightRange(font.variable_axes),
                    stretch: stretchRange(font.variable_axes),
                    style: 'normal',
                    unicodeRange: font.subset_info?.unicode_range || 'U+0-10FFFF',
                    display: 'swap',
                }));
            }
        } catch (err) {
            console.warn(`[PrettyPanels] font "${id}" could not be registered`, err);
            return [];
        }
        for (const face of faces) document.fonts.add(face);
        this.#faces.set(id, faces);
        return faces;
    }

    // Registers and downloads/decodes a font; resolves when usable.
    async loadFont(id) {
        await Promise.allSettled(this.ensureRegistered(id).map((face) => face.load()));
    }

    // ---- user fonts ----

    addUserFont(record) {
        if (!isValidUserFontRecord(record)) throw new Error('Only sanitized WOFF2 fonts can be stored.');
        this.#userFonts()[record.font_id] = record;
        this.ensureRegistered(record.font_id);
        save();
        this.#emit();
        return record;
    }

    removeUserFont(id) {
        const fonts = this.#userFonts();
        if (!fonts[id]) return false;
        delete fonts[id];
        for (const face of this.#faces.get(id) ?? []) document.fonts.delete(face);
        this.#faces.delete(id);
        save();
        this.#emit();
        return true;
    }

    userFonts() {
        return Object.values(this.#userFonts()).filter(isValidUserFontRecord);
    }
}

export const fontRegistry = new FontRegistry();

// Font ids an element list refers to (system fonts excluded).
export function fontIdsInWidgets(widgets) {
    const ids = new Set();
    for (const w of widgets ?? []) {
        for (const key of ['fontFamily', 'labelFontFamily']) {
            const id = w?.style?.[key];
            if (typeof id === 'string' && id && !SYSTEM_FONT_IDS.has(id)) ids.add(id);
        }
    }
    return ids;
}

// Rewrites font ids in element styles (after an import renamed some).
export function remapWidgetFonts(widgets, remap) {
    if (!remap || remap.size === 0) return widgets;
    return (widgets ?? []).map((w) => {
        if (!w?.style) return w;
        const style = { ...w.style };
        for (const key of ['fontFamily', 'labelFontFamily']) {
            if (remap.has(style[key])) style[key] = remap.get(style[key]);
        }
        return { ...w, style };
    });
}
