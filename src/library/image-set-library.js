// Image sets: an enum runtime field's images (Character Manager > Runtime
// fields > Images - an icon per value, e.g. one per mood) as a file, so a
// set made once can be exported, imported into another field or setting,
// and shipped with the extension (assets/image-sets/).
//
// A set file:
//   { format: IMAGE_SET_FORMAT, version: 1, name, description?,
//     values: [value...],              the field's values, in order
//     images: { [value]: image } }     an image per value (some may have none)
// An image is one of:
//   "data:image/...;base64,..."  embedded (what an export writes, so the file
//                                works on any install)
//   "http(s)://..."              a web image, kept as it is
//   "emoji:😀"                   an emoji, drawn as a small SVG (no file)
//   "happy.png"                  a file next to the set file - only for the
//                                sets shipped in assets/image-sets/
//
// Plain functions; the browser work (reading images, uploading them through
// State Engine) is src/ui/image-sets.js.

export const IMAGE_SET_FORMAT = 'pretty-panels-image-set';
export const IMAGE_SET_VERSION = 1;
// State Engine's limits for an enum runtime field (src/core/objects.js).
export const MAX_ENUM_VALUES = 30;
const MAX_VALUE_LENGTH = 60;

const isText = (value) => typeof value === 'string' && value.trim() !== '';
const key = (value) => value.trim().toLowerCase();

// The set in a parsed file, checked: { name, description, values, images }.
// Throws with a reason the user can read.
export function parseImageSet(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This is not an image set file.');
    if (data.format !== IMAGE_SET_FORMAT) throw new Error('This is not a Pretty Panels image set file.');
    if (Number(data.version) > IMAGE_SET_VERSION) throw new Error('This image set was made by a newer Pretty Panels - update to import it.');
    const values = [];
    for (const raw of Array.isArray(data.values) ? data.values : []) {
        if (!isText(raw)) continue;
        const value = raw.trim().slice(0, MAX_VALUE_LENGTH);
        if (!values.some((v) => key(v) === key(value))) values.push(value);
    }
    const images = {};
    const source = data.images && typeof data.images === 'object' && !Array.isArray(data.images) ? data.images : {};
    for (const [raw, image] of Object.entries(source)) {
        if (!isText(raw) || !isText(image)) continue;
        let value = values.find((v) => key(v) === key(raw));
        if (!value) {
            value = raw.trim().slice(0, MAX_VALUE_LENGTH);
            values.push(value);
        }
        images[value] = image.trim();
    }
    if (Object.keys(images).length === 0) throw new Error('This image set has no images.');
    return {
        name: isText(data.name) ? data.name.trim() : 'Image set',
        description: isText(data.description) ? data.description.trim() : '',
        values,
        images,
    };
}

// A set file's payload for a field. `images` are already embedded (see the
// header) - src/ui/image-sets.js reads them.
export function buildImageSet({ name, description = '', values, images }) {
    const kept = {};
    for (const value of values) if (isText(images?.[value])) kept[value] = images[value];
    return {
        format: IMAGE_SET_FORMAT,
        version: IMAGE_SET_VERSION,
        name: isText(name) ? name.trim() : 'Image set',
        ...(isText(description) ? { description: description.trim() } : {}),
        values: [...values],
        images: kept,
    };
}

// How a set lines up with a field's values, matched ignoring case:
//   matched    { [field value]: image } for the field's values the set has an image for
//   extra      the set's values (with an image) the field does not list
//   replacing  field values that already have an image the set would replace
export function matchImageSet(set, fieldValues, fieldImages = {}) {
    const byKey = new Map(fieldValues.map((v) => [key(v), v]));
    const matched = {};
    const extra = [];
    for (const [value, image] of Object.entries(set.images)) {
        const fieldValue = byKey.get(key(value));
        if (fieldValue) matched[fieldValue] = image;
        else extra.push(value);
    }
    const replacing = Object.keys(matched).filter((v) => isText(fieldImages[v]) && fieldImages[v] !== matched[v]);
    return { matched, extra, replacing };
}

// The extra values that fit under State Engine's enum limit, and those that don't.
export function fitExtraValues(fieldValues, extra) {
    const room = Math.max(0, MAX_ENUM_VALUES - fieldValues.length);
    return { added: extra.slice(0, room), skipped: extra.slice(room) };
}

// What kind of image reference this is (the header's list); null for none.
export function imageKind(image) {
    if (!isText(image)) return null;
    const ref = image.trim();
    if (/^data:image\//i.test(ref)) return 'data';
    if (/^https?:\/\//i.test(ref)) return 'url';
    if (/^emoji:/i.test(ref)) return 'emoji';
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null; // some other scheme
    return 'file';
}

// "emoji:😀" -> an SVG data URL drawing it (State Engine shows data:image/svg+xml).
export function emojiImage(image) {
    const emoji = String(image).replace(/^emoji:/i, '').trim();
    if (!emoji) return null;
    const escaped = emoji.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><text x="32" y="34" font-size="52" text-anchor="middle" dominant-baseline="central">${escaped}</text></svg>`;
    return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

// A data URL's bytes and type: { type, bytes: Uint8Array }, or null.
export function decodeDataUrl(url) {
    const match = /^data:([^;,]+)((?:;[^;,]*)*?),(.*)$/s.exec(String(url ?? ''));
    if (!match) return null;
    const base64 = /;base64/i.test(match[2]);
    if (base64) {
        const binary = atob(match[3]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return { type: match[1].toLowerCase(), bytes };
    }
    return { type: match[1].toLowerCase(), bytes: new TextEncoder().encode(decodeURIComponent(match[3])) };
}

// The file name a value's image gets when uploaded: "mood-happy.png".
export function uploadFileName(prefix, value, type) {
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp' }[type] ?? 'png';
    const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `${[slug(prefix), slug(value)].filter(Boolean).join('-') || 'image'}.${ext}`;
}
