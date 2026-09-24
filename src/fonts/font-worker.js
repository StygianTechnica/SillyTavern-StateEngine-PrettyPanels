// The font ingestion sandbox: a dedicated module Worker that owns every
// byte of an untrusted font. It has no DOM, no access to the page or to
// SillyTavern's settings; it receives the file's bytes (transferred, so
// the page no longer holds them), runs FontConverter, and posts back only
// the sanitized WOFF2 plus facts about it. The page terminates the worker
// after each job (font-ingest.js).
//
// Message in:  { bytes: ArrayBuffer, codepoints: number[] | null }
// Message out: { ok: true, woff2: ArrayBuffer, info } | { ok: false, error }

import { FontSubsetter } from './font-subsetter.js';
import { FontConverter } from './font-converter.js';
import { compress, decompress } from '../../vendor/woff2/woff2.js';

const SUBSET_WASM = new URL('../../vendor/harfbuzz/harfbuzz-subset.wasm', import.meta.url);

let converter = null;

async function getConverter() {
    converter ??= FontSubsetter.create(SUBSET_WASM).then((subsetter) => new FontConverter({ subsetter, woff2: { compress, decompress } }));
    return converter;
}

// Final gate: the browser's own font sanitizer (OTS in Chromium and
// Firefox) must accept the result, where workers expose FontFace.
async function browserAccepts(woff2) {
    if (typeof FontFace === 'undefined') return true;
    try {
        await new FontFace('pp-font-verify', woff2).load();
        return true;
    } catch {
        return false;
    }
}

self.addEventListener('message', async ({ data }) => {
    try {
        const codepoints = Array.isArray(data?.codepoints) ? new Set(data.codepoints) : null;
        const { woff2, info } = await (await getConverter()).sanitize(new Uint8Array(data.bytes), { codepoints });
        if (!(await browserAccepts(woff2))) {
            throw Object.assign(new Error('Rejected: the browser refused the sanitized font.'), { name: 'FontError' });
        }
        self.postMessage({ ok: true, woff2: woff2.buffer, info }, [woff2.buffer]);
    } catch (err) {
        const message = err?.name === 'FontError' ? err.message : 'Rejected: the font could not be processed safely.';
        if (err?.name !== 'FontError') console.warn('[PrettyPanels] font worker error', err);
        self.postMessage({ ok: false, error: message });
    }
});
