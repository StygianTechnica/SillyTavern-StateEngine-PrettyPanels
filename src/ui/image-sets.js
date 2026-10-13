// Image sets in the browser (src/library/image-set-library.js holds the
// format and the rules): exporting an enum runtime field's images with each
// image embedded, importing a set file into a field - its images uploaded
// through State Engine's Image API so the field points at the user's own
// files - and the sets shipped in assets/image-sets/.

import { EXTENSION_ID } from '../constants.js';
import { importImageFile } from '../api/import-image-file.js';
import {
    parseImageSet, buildImageSet, matchImageSet, fitExtraValues, imageKind, emojiImage, decodeDataUrl, uploadFileName,
} from '../library/image-set-library.js';
import { downloadJson, pickJsonFile, safeFilename } from './files.js';
import { confirmYesNo, promptText, notify, chooseFromList } from './dialogs.js';

const BUILT_IN_DIR = new URL('../../assets/image-sets/', import.meta.url);
const BUILT_IN_INDEX = new URL('index.json', BUILT_IN_DIR);

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener('load', () => resolve(reader.result));
        reader.addEventListener('error', () => reject(reader.error));
        reader.readAsDataURL(blob);
    });
}

// A field image as a data URL, for an export. A web image that can't be
// read (the site does not allow it) stays a link; null when unreadable.
async function embed(reference) {
    const kind = imageKind(reference);
    if (kind === 'data') return reference;
    if (kind === 'emoji') return emojiImage(reference);
    try {
        const response = await fetch(reference);
        if (!response.ok) throw new Error(String(response.status));
        return await blobToDataUrl(await response.blob());
    } catch {
        return kind === 'url' ? reference : null;
    }
}

// Exports field `{ name, values: [..], images }` as a set file.
export async function exportImageSet(field) {
    const references = Object.entries(field.images ?? {}).filter(([value, ref]) => field.values.includes(value) && ref);
    if (references.length === 0) {
        notify('warning', 'This field has no images to export yet.');
        return;
    }
    const name = await promptText('Name for the image set:', field.name ? `${field.name[0].toUpperCase()}${field.name.slice(1)} images` : 'Image set');
    if (!name) return;
    const images = {};
    const missing = [];
    for (const [value, reference] of references) {
        const embedded = await embed(reference);
        if (embedded) images[value] = embedded;
        else missing.push(value);
    }
    if (missing.length) notify('warning', `Left out ${missing.length} image(s) that could not be read: ${missing.join(', ')}.`);
    downloadJson(`${safeFilename(name)}.image-set.json`, buildImageSet({ name, values: field.values, images }));
}

// One image of a set, made into what a field stores: an emoji or SVG as a
// data URL (State Engine cannot store SVG files), a web link as it is, any
// other image uploaded into user/images/<folder>/. `base` resolves a file
// name (a shipped set's own files).
async function materialize(image, { value, setName, folder, base }) {
    const kind = imageKind(image);
    if (kind === 'emoji') return emojiImage(image);
    if (kind === 'url') return image;
    let type;
    let bytes;
    if (kind === 'data') {
        const decoded = decodeDataUrl(image);
        if (!decoded) throw new Error('the embedded image is damaged');
        ({ type, bytes } = decoded);
    } else if (kind === 'file' && base) {
        const response = await fetch(new URL(image, base));
        if (!response.ok) throw new Error(`could not load ${image} (${response.status})`);
        const blob = await response.blob();
        type = blob.type || 'image/png';
        bytes = new Uint8Array(await blob.arrayBuffer());
    } else {
        throw new Error('the image is not embedded in the file');
    }
    if (type === 'image/svg+xml') return blobToDataUrl(new Blob([bytes], { type }));
    const file = new File([bytes], uploadFileName(setName, value, type), { type });
    return importImageFile(EXTENSION_ID, file, { folder });
}

// Applies a parsed set to field `{ name, values: [..], images }`, asking
// about values the field lacks and images it would replace. Resolves to
// `{ values, images }` for the field's draft, or null when cancelled or
// nothing was imported.
async function applySet(set, field, { folder, base = null }) {
    const { matched, extra, replacing } = matchImageSet(set, field.values, field.images ?? {});
    let values = [...field.values];
    let wanted = { ...matched };
    if (extra.length) {
        const { added, skipped } = fitExtraValues(values, extra);
        const note = skipped.length ? ` (${skipped.length} more would go past the ${values.length + added.length}-value limit and are left out)` : '';
        if (added.length && await confirmYesNo(`"${set.name}" has ${added.length} value(s) this field doesn't list: ${added.join(', ')}${note}. Add them to the field's values?`)) {
            values = [...values, ...added];
            for (const value of added) wanted[value] = set.images[value];
        }
    }
    if (replacing.length && !await confirmYesNo(`Replace the image(s) this field already has for ${replacing.join(', ')}?`)) {
        wanted = Object.fromEntries(Object.entries(wanted).filter(([value]) => !replacing.includes(value)));
    }
    const todo = Object.entries(wanted);
    if (todo.length === 0) {
        notify('info', `Nothing imported - "${set.name}" has no images for this field's values (${field.values.join(', ')}).`);
        return null;
    }
    if (todo.length > 2) notify('info', `Importing ${todo.length} images from "${set.name}"…`);
    const images = { ...(field.images ?? {}) };
    const failed = [];
    for (const [value, image] of todo) {
        try {
            images[value] = await materialize(image, { value, setName: field.name || set.name, folder, base });
        } catch (err) {
            failed.push(`${value} (${err?.message ?? err})`);
        }
    }
    if (failed.length) notify('warning', `Could not import: ${failed.join('; ')}.`);
    if (failed.length === todo.length) return null;
    notify('success', `Imported ${todo.length - failed.length} image(s) from "${set.name}" - Save fields to keep them.`);
    return { values, images };
}

// Picks a set file and applies it to the field (see applySet).
export async function importImageSet(field, { folder }) {
    const text = await pickJsonFile();
    if (!text) return null;
    let set;
    try {
        set = parseImageSet(JSON.parse(text));
    } catch (err) {
        notify('error', err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
        return null;
    }
    return applySet(set, field, { folder });
}

// The shipped sets: [{ file, name, description }] from assets/image-sets/index.json.
async function builtInSets() {
    try {
        const response = await fetch(BUILT_IN_INDEX);
        if (!response.ok) return [];
        const index = await response.json();
        return (Array.isArray(index?.sets) ? index.sets : []).filter((s) => typeof s?.file === 'string' && s.file);
    } catch {
        return [];
    }
}

// Lets the user choose a shipped set and applies it to the field.
export async function chooseBuiltInImageSet(field, { folder }) {
    const sets = await builtInSets();
    const file = await chooseFromList({
        title: 'Built-in image sets',
        items: sets.map((s) => ({ value: s.file, label: s.name ?? s.file, detail: s.description ?? '', icon: 'fa-icons' })),
        emptyText: 'No built-in image sets were found.',
    });
    if (!file) return null;
    const url = new URL(file, BUILT_IN_DIR);
    let set;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`could not load the set (${response.status})`);
        set = parseImageSet(await response.json());
    } catch (err) {
        notify('error', `That image set could not be loaded: ${err.message}`);
        return null;
    }
    return applySet(set, field, { folder, base: url });
}
