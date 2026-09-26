// Theme asset image files. Storing one is State Engine's job: every file
// goes through its Image API (stateEngine.importImageFile, via
// src/api/import-image-file.js) - its checks, its upload, its file naming -
// into user/images/pretty-panels-theme-assets/. Pretty Panels only hands it
// a File and keeps the relative path it gets back. The helpers below just
// move bytes between the forms the browser gives us (a picked File, a
// fetched file, an exported data: URL); they check nothing themselves.

import { EXTENSION_ID } from '../constants.js';
import { importImageFile } from '../api/import-image-file.js';

export const ASSET_FOLDER = 'pretty-panels-theme-assets';

// Stores `blob` (a File or Blob) as an asset file. `name` suggests the
// file name ("<theme>-<asset>"); State Engine makes it safe and unique and
// works out the real format from the bytes. -> "user/images/<folder>/<file>".
export function storeAssetFile(blob, name) {
    const ext = (typeof blob?.name === 'string' && blob.name.match(/\.[A-Za-z0-9]+$/)?.[0]) || '';
    const file = new File([blob], `${String(name).replace(/\./g, '-')}${ext}`, { type: blob?.type ?? '' });
    return importImageFile(EXTENSION_ID, file, { folder: ASSET_FOLDER });
}

// An exported/legacy data: URL stored as an asset file.
export async function storeDataUrl(dataUrl, name) {
    const blob = await (await fetch(dataUrl)).blob();
    return storeAssetFile(blob, name);
}

// A stored asset file as a data: URL, for a theme export (another install
// has no copy of the file). null when it can't be read.
export async function readAssetFile(path) {
    if (typeof path !== 'string' || !path) return null;
    try {
        const response = await fetch(`/${path}`);
        if (!response.ok) return null;
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    } catch {
        return null;
    }
}
