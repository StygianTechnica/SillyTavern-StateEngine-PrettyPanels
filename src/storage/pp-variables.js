// Pretty Panels variables: values Pretty Panels owns itself (unlike State
// Engine variables, which belong to a chat), stored in SillyTavern's
// extensionSettings.prettyPanelsVariables as { [name]: record }. So far
// the only kind is an IMAGE - a theme asset (src/themes/theme-store.js),
// named pp_theme_<themeId>_<assetName>:
//
//   { name, type: 'image', value: 'data:image/...;base64,...', mime, width,
//     height, bytes, createdAt, updatedAt, meta: { themeId, assetName } }
//
// Anywhere a theme takes an image (variant images, clock faces and hands,
// component icons) it may hold either a URL or such a variable's name;
// resolveImageRef() turns either into something an <img> / CSS url() can
// show. A variable's image is handed out as a blob: URL (cached until the
// variable changes), so a large data URL is decoded once instead of being
// copied into every style it appears in.

import { save } from './store.js';

const SETTINGS_KEY = 'prettyPanelsVariables';
export const THEME_ASSET_PREFIX = 'pp_theme_';

const blobUrls = new Map(); // name -> { value, url }
const listeners = new Set();

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
    return isObject(record) && record.type === 'image' && typeof record.value === 'string' && record.value.startsWith('data:image/');
}

function emit() {
    for (const listener of listeners) listener();
}

export function onPPVariablesChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
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

// Creates or replaces an image variable. `image`: { value (data URL),
// mime, width, height, bytes }.
export function setImageVariable(name, image, meta = {}) {
    const all = variables();
    const now = Date.now();
    all[name] = {
        name,
        type: 'image',
        value: image.value,
        mime: image.mime,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        createdAt: all[name]?.createdAt ?? now,
        updatedAt: now,
        meta: { ...meta },
    };
    save();
    emit();
    return all[name];
}

export function deletePPVariable(name) {
    const all = variables();
    if (!all[name]) return false;
    delete all[name];
    const cached = blobUrls.get(name);
    if (cached) URL.revokeObjectURL(cached.url);
    blobUrls.delete(name);
    save();
    emit();
    return true;
}

function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',', 2);
    const mime = head.slice(5).split(';')[0];
    if (head.includes(';base64')) {
        const binary = atob(body);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
}

// A URL for an image reference: a Pretty Panels image variable's name ->
// its (cached) blob: URL; any other non-empty string is returned as the
// URL it already is; '' / null / a missing variable -> null.
export function resolveImageRef(ref) {
    if (typeof ref !== 'string' || !ref.trim()) return null;
    const name = ref.trim();
    if (!name.startsWith(THEME_ASSET_PREFIX)) return name;
    const record = getPPVariable(name);
    if (!record) return null;
    const cached = blobUrls.get(name);
    if (cached?.value === record.value) return cached.url;
    if (cached) URL.revokeObjectURL(cached.url);
    try {
        const url = URL.createObjectURL(dataUrlToBlob(record.value));
        blobUrls.set(name, { value: record.value, url });
        return url;
    } catch {
        return record.value;
    }
}
