// Theme Library: every Pretty Panels theme, stored in SillyTavern's
// extensionSettings.prettyPanelsThemes as { [themeId]: theme } (global,
// shared by every chat and layout - see src/themes/theme-schema.js for
// the shape). The list order is creation order; the FIRST theme is the
// default for panels that have not chosen one.
//
// The built-in themes are seeded the first time the library is read and
// from then on are ordinary themes (editable, deletable). The library is
// never empty: deleting the last theme is refused, and an emptied or
// corrupt library is re-seeded.
//
// Every mutation saves (SillyTavern's debounced save) and notifies
// onThemesChange listeners, which re-render panels live.

import { generateId, uniqueName, save, clone } from '../storage/store.js';
import { builtInThemes, normalizeTheme, variantNameFor, DEFAULT_VARIANT, FALLBACK_VARIANT, THEME_FONTS, ELEMENT_DEFAULT_FIELDS } from './theme-schema.js';
import { makePayload, readPayload, KIND } from '../library/format.js';
import { assembleFonts, importEmbeddedFonts } from '../fonts/font-export.js';
import { fontRegistry } from '../fonts/font-registry.js';

const SETTINGS_KEY = 'prettyPanelsThemes';
const listeners = new Set();
let checked = false;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The live { id: theme } map, seeded and normalized as needed.
function library() {
    const all = SillyTavern.getContext().extensionSettings;
    let changed = false;
    if (!isObject(all[SETTINGS_KEY])) {
        all[SETTINGS_KEY] = {};
        changed = true;
    }
    const themes = all[SETTINGS_KEY];
    if (Object.keys(themes).length === 0) {
        for (const theme of builtInThemes()) themes[theme.id] = theme;
        changed = true;
    }
    // Once per session: repair anything hand-edited or from an older
    // version (e.g. a theme without variants gets its "default").
    if (!checked) {
        checked = true;
        for (const [id, theme] of Object.entries(themes)) {
            const normalized = normalizeTheme({ ...(isObject(theme) ? theme : {}), id });
            if (JSON.stringify(normalized) !== JSON.stringify(theme)) {
                themes[id] = normalized;
                changed = true;
            }
        }
    }
    if (changed) save();
    return themes;
}

function emit() {
    for (const listener of listeners) listener();
}

export function onThemesChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Every theme, in list order. Live objects - treat as read-only.
export function listThemes() {
    return Object.values(library()).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.name.localeCompare(b.name));
}

export function getTheme(id) {
    return (typeof id === 'string' && library()[id]) || null;
}

export function firstTheme() {
    return listThemes()[0];
}

// The theme a panel uses: its own, else the first one.
export function resolveTheme(id) {
    return getTheme(id) ?? firstTheme();
}

// { themeId, themeVariant } for a panel that has not chosen a theme.
export function defaultThemeChoice() {
    const theme = firstTheme();
    return { themeId: theme.id, themeVariant: variantNameFor(theme, DEFAULT_VARIANT) };
}

function store(theme) {
    const themes = library();
    themes[theme.id] = normalizeTheme(theme);
    save();
    emit();
    return themes[theme.id];
}

// Applies `mutate(draft)` to a copy of the theme and stores the result.
export function updateTheme(id, mutate) {
    const current = getTheme(id);
    if (!current) return null;
    const draft = clone(current);
    mutate(draft);
    draft.id = id;
    return store(draft);
}

function names() {
    return listThemes().map((t) => t.name);
}

export function createTheme(name = 'New theme') {
    const theme = normalizeTheme({ id: generateId('ppt'), name: uniqueName(name, names()), createdAt: Date.now() });
    return store(theme);
}

export function duplicateTheme(id) {
    const source = getTheme(id);
    if (!source) return null;
    return store({ ...clone(source), id: generateId('ppt'), name: uniqueName(`${source.name} (copy)`, names()), createdAt: Date.now(), version: 1 });
}

// Refused (false) for the last remaining theme.
export function deleteTheme(id) {
    const themes = library();
    if (!themes[id] || Object.keys(themes).length <= 1) return false;
    delete themes[id];
    save();
    emit();
    return true;
}

// ---- Variants -------------------------------------------------------------

export function addVariant(id, name, copyFrom = null) {
    const theme = getTheme(id);
    const clean = typeof name === 'string' ? name.trim() : '';
    if (!theme || !clean) return null;
    const unique = uniqueName(clean, Object.keys(theme.variants));
    updateTheme(id, (draft) => {
        draft.variants[unique] = clone(draft.variants[copyFrom] ?? FALLBACK_VARIANT);
    });
    return unique;
}

export function renameVariant(id, from, to) {
    const theme = getTheme(id);
    const clean = typeof to === 'string' ? to.trim() : '';
    if (!theme?.variants[from] || !clean || clean === from || theme.variants[clean]) return false;
    updateTheme(id, (draft) => {
        // Keep the order, swapping the key in place.
        draft.variants = Object.fromEntries(Object.entries(draft.variants).map(([k, v]) => [k === from ? clean : k, v]));
    });
    return true;
}

// Refused (false) for a theme's last variant.
export function deleteVariant(id, name) {
    const theme = getTheme(id);
    if (!theme?.variants[name] || Object.keys(theme.variants).length <= 1) return false;
    updateTheme(id, (draft) => {
        delete draft.variants[name];
    });
    return true;
}

// ---- Import / export ------------------------------------------------------

// Font ids a theme uses (its fonts; element defaults carry none).
function themeFontIds(theme) {
    return [...new Set(THEME_FONTS.map(([key]) => theme.fonts[key]).filter(Boolean))];
}

// The export payload: the theme, plus any of the user's own fonts it uses
// (curated fonts ship with every install, so they aren't embedded).
export async function exportThemePayload(id) {
    const theme = getTheme(id);
    if (!theme) return null;
    await fontRegistry.load();
    const userFontIds = themeFontIds(theme).filter((fid) => fontRegistry.get(fid)?.source === 'local');
    const fonts = await assembleFonts(userFontIds);
    return makePayload(KIND.THEME, { theme: clone(theme), ...(fonts ? { fonts } : {}) });
}

// Imports an exported theme file's text as a NEW theme (never replacing
// one). Throws an Error with a user-facing message.
export async function importThemeText(textContent) {
    const data = readPayload(textContent, KIND.THEME);
    if (!isObject(data.theme)) throw new Error('That file has no theme in it.');
    const remap = data.fonts ? await importEmbeddedFonts(data.fonts) : new Map();
    const theme = clone(data.theme);
    if (isObject(theme.fonts)) {
        for (const [key, fid] of Object.entries(theme.fonts)) if (remap.has(fid)) theme.fonts[key] = remap.get(fid);
    }
    return store({ ...theme, id: generateId('ppt'), name: uniqueName(typeof theme.name === 'string' && theme.name ? theme.name : 'Imported theme', names()), createdAt: Date.now() });
}

// The element-defaults field list for a group (re-exported for the editor).
export { ELEMENT_DEFAULT_FIELDS };
