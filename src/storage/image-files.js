// Image FILES for theme assets, stored on the SillyTavern server the same
// way State Engine stores image-variable files (its src/core/image-import.js):
// SillyTavern's POST /api/images/upload saves into the user's own folder
//   data/<user>/user/images/pretty-panels-theme-assets/<file>
// and serves it at the RELATIVE path
//   user/images/pretty-panels-theme-assets/<file>
// which is what gets stored - never base64, a blob: URL or an absolute
// path. Same rules as State Engine: the format is read from the file's
// bytes (png, jpg, gif, webp, bmp), SVG is refused (an SVG opened directly
// runs scripts in SillyTavern's origin), 20 MB at most, and a file name is
// never reused (the server overwrites silently, and a replaced image must
// not be served from the browser cache under its old name).

export const ASSET_FOLDER = 'pretty-panels-theme-assets';
export const ASSET_PATH_PREFIX = `user/images/${ASSET_FOLDER}/`;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const FORMATS = { png: ['png'], jpeg: ['jpg', 'jpeg'], gif: ['gif'], webp: ['webp'], bmp: ['bmp'] };
const FORMAT_LIST = 'PNG, JPEG, GIF, WebP or BMP';

function headers() {
    try {
        return SillyTavern.getContext().getRequestHeaders();
    } catch {
        return { 'Content-Type': 'application/json' };
    }
}

// A path this module produced: one safe file name inside the asset folder.
export function isAssetPath(path) {
    if (typeof path !== 'string' || !path.startsWith(ASSET_PATH_PREFIX)) return false;
    const name = path.slice(ASSET_PATH_PREFIX.length);
    return name !== '' && !/[\\/?#\u0000-\u001f]/.test(name) && !name.includes('..');
}

function sniff(bytes) {
    if (!bytes || bytes.length < 4) return null;
    const b = (i) => bytes[i];
    if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return 'png';
    if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'jpeg';
    if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return 'gif';
    if (bytes.length >= 12 && b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46
        && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'webp';
    if (b(0) === 0x42 && b(1) === 0x4d) return 'bmp';
    return null;
}

export function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

export function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

// Letters, digits, space, _ and - only (a dot would read as an extension).
function safeBaseName(name) {
    const cleaned = String(name ?? '').normalize('NFC')
        .replace(/\.[^.]*$/, '')
        .replace(/[^\p{L}\p{N} _-]+/gu, '_')
        .replace(/[ _]{2,}/g, '_')
        .replace(/^[\s_.-]+|[\s_.-]+$/g, '')
        .slice(0, 80);
    return cleaned || 'image';
}

// Checked bytes -> { base64, ext }. Throws an Error with a user-facing message.
function checkImageBytes(bytes, originalName = '') {
    if (!bytes || bytes.length === 0) throw new Error('The file is empty.');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`The file is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
    const family = sniff(bytes);
    if (!family) throw new Error(`That file is not a supported image (${FORMAT_LIST}).`);
    const own = (String(originalName).match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    return { base64: bytesToBase64(bytes), ext: FORMATS[family].includes(own) ? own : FORMATS[family][0] };
}

// Uploads base64 image data as <baseName>-<unique>.<ext>. -> relative path.
export async function uploadImageBase64(base64, ext, baseName) {
    const unique = `${safeBaseName(baseName)}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const response = await fetch('/api/images/upload', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ image: base64, format: ext, filename: `${unique}.${ext}`, ch_name: ASSET_FOLDER }),
    });
    if (!response.ok) throw new Error(`The server refused the upload (${response.status}).`);
    const body = await response.json();
    // SillyTavern answers "/user/images/<folder>/<file>"; the stored form is relative.
    const path = typeof body?.path === 'string' ? body.path.replace(/^\/+/, '') : '';
    if (!isAssetPath(path)) throw new Error('The server returned an unexpected path.');
    return path;
}

// Uploads a picked File. -> relative path. Throws with a user-facing message.
export async function uploadImageFile(file, baseName) {
    if (!file) throw new Error('No file chosen.');
    if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
        throw new Error(`SVG images can't be used (they can contain scripts). Use ${FORMAT_LIST}.`);
    }
    const { base64, ext } = checkImageBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    return uploadImageBase64(base64, ext, baseName);
}

// A data: URL (an asset from before files) uploaded as a file. -> path.
export async function uploadDataUrl(dataUrl, baseName) {
    const comma = dataUrl.indexOf(',');
    if (!dataUrl.startsWith('data:image/') || !dataUrl.slice(0, comma).includes(';base64')) throw new Error('Not a base64 image.');
    const { base64, ext } = checkImageBytes(base64ToBytes(dataUrl.slice(comma + 1)));
    return uploadImageBase64(base64, ext, baseName);
}

// A stored file's bytes, for exports. -> { base64, ext } or null.
export async function fetchImageFile(path) {
    try {
        const response = await fetch(`/${path}`);
        if (!response.ok) return null;
        return checkImageBytes(new Uint8Array(await response.arrayBuffer()), path);
    } catch {
        return null;
    }
}

// Embedded image data from an export, re-checked and uploaded. -> path.
export async function uploadEmbeddedImage(base64, baseName) {
    const { base64: checked, ext } = checkImageBytes(base64ToBytes(base64));
    return uploadImageBase64(checked, ext, baseName);
}
