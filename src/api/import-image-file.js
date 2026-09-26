// Thin wrapper around the Image API's importImageFile() call.
// No additional logic belongs in this file.

// See src/api/namespace.js for why this is a dynamic import, and why
// these two paths (adjust if your State Engine folder is named
// differently) are repeated per-file rather than centralized - each
// src/api/*.js file wraps exactly one call, independently, on purpose.
const API_PATH = '../../../SillyTavern-StateEngine/src/api/index.js';
const IDENTITY_PATH = '../../../SillyTavern-StateEngine/src/api/identity.js';

// Stores an image File through State Engine's own image pipeline (its
// checks, its upload) into user/images/<folder>/ and resolves to the
// relative path "user/images/<folder>/<file>". Rejects with State Engine's
// reason on failure. See the State Engine API Reference, "Image API".
export async function importImageFile(extensionId, file, { folder } = {}) {
    const { stateEngine } = await import(API_PATH);
    const { ensureInstanceId } = await import(IDENTITY_PATH);
    if (typeof stateEngine.importImageFile !== 'function') {
        throw new Error('This State Engine version has no image API - update State Engine to upload theme assets.');
    }
    return stateEngine.importImageFile(extensionId, ensureInstanceId(), file, { folder });
}
