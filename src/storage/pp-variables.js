// Pretty Panels variables: values Pretty Panels owns itself (unlike State
// Engine variables, which belong to a chat), stored in SillyTavern's
// extensionSettings.prettyPanelsVariables as
//
//   { [name]: { name, type: 'image', value, version } }
//
// `value` is a RELATIVE path to a file on the SillyTavern server
// ("user/images/pretty-panels-theme-assets/<file>", src/storage/image-files.js)
// - never base64, a blob: URL or an absolute path. `version` starts at 1
// and goes up each time the image is replaced.
//
// So far every one is a theme asset (src/themes/theme-store.js), named
// pp_theme_<themeId>_<assetName>. They show up in the variable picker as a
// "Pretty Panels" group (src/chat/variable-service.js) and bind, drop and
// display like any image variable. Anywhere an image is taken (Panel
// Styling's image, variant images, clock images, component icons) may hold
// a URL or such a variable's name; resolveImageRef() shows either.

import { save } from './store.js';
import { uploadDataUrl } from './image-files.js';

const SETTINGS_KEY = 'prettyPanelsVariables';
export const THEME_ASSET_PREFIX = 'pp_theme_';

const listeners = new Set();
let labelFor = (name) => name;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function variables() {
    const all = SillyTavern.getContext().extensionSettings;
    if (!isObject(all[SETTINGS_KEY])) {
        all[SETTINGS_KEY] = {};
        save();
    }
    return all[SETTINGS_KEY];
}

function isImageRecord(record) {
    return isObject(record) && record.type === 'image' && typeof record.value === 'string' && record.value !== '';
}

function emit() {
    for (const listener of listeners) listener();
}

export function onPPVariablesChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Lets the theme store name asset variables for the picker ("Parchment ·
// backdrop") without this module depending on it.
export function setPPVariableLabeler(fn) {
    if (typeof fn === 'function') labelFor = fn;
}

export function ppVariableLabel(name) {
    try {
        return labelFor(name) || name;
    } catch {
        return name;
    }
}

// A theme asset's variable name. Asset names are letters, digits, _ and -.
export function themeAssetVariableName(themeId, assetName) {
    return `${THEME_ASSET_PREFIX}${themeId}_${assetName}`;
}

export function getPPVariable(name) {
    const record = typeof name === 'string' ? variables()[name] : null;
    return isImageRecord(record) ? record : null;
}

export function isPPImageVariable(name) {
    return !!getPPVariable(name);
}

export function listPPVariables() {
    return Object.values(variables()).filter(isImageRecord);
}

// Creates or replaces an image variable pointing at `path`.
export function setImageVariable(name, path) {
    const all = variables();
    const previous = all[name];
    all[name] = { name, type: 'image', value: path, version: isImageRecord(previous) ? (Number(previous.version) || 1) + 1 : 1 };
    save();
    emit();
    return all[name];
}

export function deletePPVariable(name) {
    const all = variables();
    if (!all[name]) return false;
    delete all[name];
    save();
    emit();
    return true;
}

// A displayable URL for an image reference: a Pretty Panels image
// variable's name -> its file's relative path; any other non-empty string
// is already a URL/path; '' / null / a missing variable -> null.
export function resolveImageRef(ref) {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const name = ref.trim();
    if (!name.startsWith(THEME_ASSET_PREFIX)) return name;
    return getPPVariable(name)?.value ?? null;
}

// Assets saved by the first version of theme assets held their image as
// a data: URL inside the variable. Each is uploaded as a file and the
// variable pointed at it (keeping its version). Best effort: one that
// can't be uploaded now is tried again next load.
export async function migrateInlineImages() {
    let changed = false;
    for (const record of Object.values(variables())) {
        if (!isObject(record) || typeof record.value !== 'string' || !record.value.startsWith('data:')) continue;
        try {
            const path = await uploadDataUrl(record.value, record.name);
            variables()[record.name] = { name: record.name, type: 'image', value: path, version: Number(record.version) || 1 };
            changed = true;
        } catch (err) {
            console.warn(`[PrettyPanels] could not move the image of "${record.name}" to a file`, err);
        }
    }
    if (changed) {
        save();
        emit();
    }
    return changed;
}
