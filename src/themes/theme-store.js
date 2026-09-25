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
//
// Theme ASSETS are images uploaded in the Theme Editor. Each is a Pretty
// Panels image variable (src/storage/pp-variables.js) named
// pp_theme_<themeId>_<assetName>, and theme.assets maps the asset name to
// that variable name. Duplicating a theme copies its assets under the new
// theme's id, deleting a theme deletes them, and exports carry them.

import { generateId, uniqueName, save, clone } from '../storage/store.js';
import { builtInThemes, normalizeTheme, variantNameFor, DEFAULT_VARIANT, FALLBACK_VARIANT, THEME_FONTS, ELEMENT_DEFAULT_FIELDS } from './theme-schema.js';
import { makePayload, readPayload, KIND } from '../library/format.js';
import { assembleFonts, importEmbeddedFonts } from '../fonts/font-export.js';
import { fontRegistry } from '../fonts/font-registry.js';
import { getPPVariable, setImageVariable, deletePPVariable, themeAssetVariableName } from '../storage/pp-variables.js';
import { ASSET_NAME_PATTERN } from './theme-schema.js';

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

// Every string in `value` equal to a key of `renames` replaced by its value
// (asset variable names moving to a new theme id).
function rewriteRefs(value, renames) {
    if (typeof value === 'string') return renames.get(value) ?? value;
    if (Array.isArray(value)) return value.map((v) => rewriteRefs(v, renames));
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewriteRefs(v, renames)]));
    return value;
}

// Stores `images` ({ assetName: image record }) as theme `themeId`'s asset
// variables; returns Map(old variable name -> new) for rewriteRefs.
function adoptAssets(themeId, oldRefs, images) {
    const renames = new Map();
    for (const [assetName, image] of Object.entries(images)) {
        if (!ASSET_NAME_PATTERN.test(assetName) || typeof image?.value !== 'string' || !image.value.startsWith('data:image/')) continue;
        const name = themeAssetVariableName(themeId, assetName);
        setImageVariable(name, image, { themeId, assetName });
        if (oldRefs[assetName]) renames.set(oldRefs[assetName], name);
    }
    return renames;
}

export function duplicateTheme(id) {
    const source = getTheme(id);
    if (!source) return null;
    const newId = generateId('ppt');
    const images = Object.fromEntries(Object.entries(source.assets).map(([n, ref]) => [n, getPPVariable(ref)]).filter(([, rec]) => rec));
    const renames = adoptAssets(newId, source.assets, images);
    const copy = rewriteRefs(clone(source), renames);
    copy.assets = Object.fromEntries(Object.keys(images).map((n) => [n, themeAssetVariableName(newId, n)]));
    return store({ ...copy, id: newId, name: uniqueName(`${source.name} (copy)`, names()), createdAt: Date.now(), version: 1 });
}

// Refused (false) for the last remaining theme. Its asset variables go too.
export function deleteTheme(id) {
    const themes = library();
    if (!themes[id] || Object.keys(themes).length <= 1) return false;
    for (const ref of Object.values(themes[id].assets ?? {})) deletePPVariable(ref);
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

// ---- Assets ---------------------------------------------------------------

// Adds (or replaces) asset `assetName` from a prepared image
// (src/ui/image-upload.js prepareImage). Returns its variable name.
export function setThemeAsset(id, assetName, image) {
    if (!getTheme(id)) return null;
    if (!ASSET_NAME_PATTERN.test(assetName)) throw new Error('Asset names are letters, digits, "_" and "-" (up to 40), starting with a letter or digit.');
    const name = themeAssetVariableName(id, assetName);
    setImageVariable(name, image, { themeId: id, assetName });
    updateTheme(id, (draft) => {
        draft.assets[assetName] = name;
    });
    return name;
}

// Removes an asset and its variable. Fields still naming it show nothing.
export function removeThemeAsset(id, assetName) {
    const theme = getTheme(id);
    const ref = theme?.assets[assetName];
    if (!ref) return false;
    deletePPVariable(ref);
    updateTheme(id, (draft) => {
        delete draft.assets[assetName];
    });
    return true;
}

// [[assetName, variableName], ...] for a theme.
export function themeAssets(id) {
    return Object.entries(getTheme(id)?.assets ?? {});
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
    // Asset images travel inside the file (they live in settings, not at a URL).
    const assets = {};
    for (const [assetName, ref] of Object.entries(theme.assets)) {
        const record = getPPVariable(ref);
        if (record) assets[assetName] = { value: record.value, mime: record.mime, width: record.width, height: record.height, bytes: record.bytes };
    }
    return makePayload(KIND.THEME, { theme: clone(theme), ...(fonts ? { fonts } : {}), ...(Object.keys(assets).length ? { assets } : {}) });
}

// Imports an exported theme file's text as a NEW theme (never replacing
// one). Throws an Error with a user-facing message.
export async function importThemeText(textContent) {
    const data = readPayload(textContent, KIND.THEME);
    if (!isObject(data.theme)) throw new Error('That file has no theme in it.');
    const remap = data.fonts ? await importEmbeddedFonts(data.fonts) : new Map();
    let theme = clone(data.theme);
    if (isObject(theme.fonts)) {
        for (const [key, fid] of Object.entries(theme.fonts)) if (remap.has(fid)) theme.fonts[key] = remap.get(fid);
    }
    const newId = generateId('ppt');
    const oldRefs = isObject(theme.assets) ? theme.assets : {};
    const images = isObject(data.assets) ? data.assets : {};
    theme = rewriteRefs(theme, adoptAssets(newId, oldRefs, images));
    theme.assets = Object.fromEntries(Object.keys(images).filter((n) => ASSET_NAME_PATTERN.test(n)).map((n) => [n, themeAssetVariableName(newId, n)]));
    return store({ ...theme, id: newId, name: uniqueName(typeof theme.name === 'string' && theme.name ? theme.name : 'Imported theme', names()), createdAt: Date.now() });
}

// The element-defaults field list for a group (re-exported for the editor).
export { ELEMENT_DEFAULT_FIELDS };
