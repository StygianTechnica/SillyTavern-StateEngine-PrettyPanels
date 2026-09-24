// Page-side entry points for bringing a font INTO Pretty Panels. Both
// paths run the untrusted bytes through the sandboxed worker
// (font-worker.js) and get back a user font record ready for
// fontRegistry.addUserFont() - holding only the sanitized WOFF2:
//
//   ingestFontFile(file, { charsets, layoutText })   a user's upload
//   resanitizeEmbeddedFont(entry)                     a font embedded in an
//                                                     imported layout/template
//
// The raw file is read into an ArrayBuffer that is TRANSFERRED to the
// worker (so the page no longer holds it) and is never stored anywhere.

import { codepointsFor, toUnicodeRange, CHARSETS } from './charsets.js';
import { bytesToBase64, base64ToBytes, MAX_USER_FONT_BASE64 } from './font-registry.js';

const WORKER_URL = new URL('./font-worker.js', import.meta.url);
const WORKER_TIMEOUT_MS = 60000;
const ACCEPTED_EXTENSIONS = /\.(ttf|otf|woff2?)$/i;
export const ACCEPT_ATTRIBUTE = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2';
const MAX_FILE_BYTES = 15 * 1024 * 1024;

function runWorker(buffer, codepoints) {
    return new Promise((resolve, reject) => {
        let worker;
        try {
            worker = new Worker(WORKER_URL, { type: 'module', name: 'pretty-panels-font-sandbox' });
        } catch {
            reject(new Error('This browser cannot start the font sandbox.'));
            return;
        }
        const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('Rejected: processing the font took too long.'));
        }, WORKER_TIMEOUT_MS);
        const done = () => {
            clearTimeout(timer);
            worker.terminate();
        };
        worker.addEventListener('message', ({ data }) => {
            done();
            if (data?.ok) resolve({ woff2: new Uint8Array(data.woff2), info: data.info });
            else reject(new Error(data?.error || 'Rejected: the font could not be processed.'));
        });
        worker.addEventListener('error', (e) => {
            done();
            e.preventDefault?.();
            reject(new Error('The font sandbox failed to start.'));
        });
        worker.postMessage({ bytes: buffer, codepoints: codepoints ? [...codepoints] : null }, [buffer]);
    });
}

function shortId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function buildRecord({ woff2, info }, { displayName, charsets, extraCharacters }) {
    const b64 = bytesToBase64(woff2);
    if (b64.length > MAX_USER_FONT_BASE64) {
        throw new Error('Rejected: even after subsetting, the font is too large to store (over 1.5 MB). Try fewer character sets.');
    }
    const id = shortId();
    const name = displayName || [info.family, info.style && info.style !== 'Regular' ? info.style : ''].filter(Boolean).join(' ') || 'Uploaded font';
    return {
        font_id: `user-${id}`,
        display_name: name.slice(0, 80),
        source: 'local',
        family: `UserFont_${id}`,
        category: 'local',
        sanitized_base64_woff2: b64,
        variable_axes: info.axes,
        fallback_stack: 'system-ui, sans-serif',
        // Legal notices the font carries (kept inside the font too).
        notice: {
            copyright: info.copyright.slice(0, 500),
            license: info.license.slice(0, 500),
            license_url: info.licenseUrl.slice(0, 300),
        },
        subset_info: {
            charsets,
            extra_characters: extraCharacters,
            codepoint_count: info.codepoints.length,
            unicode_range: toUnicodeRange(info.codepoints),
            glyph_count: info.glyphCount,
            tables_kept: info.tablesKept,
            tables_removed: info.tablesRemoved,
            hinting_removed: info.hintingRemoved,
            original_format: info.originalFormat,
            original_bytes: info.originalBytes,
            sanitized_bytes: info.sanitizedBytes,
            created_at: new Date().toISOString(),
            tool: 'hb-subset + woff2 (Pretty Panels font sandbox)',
        },
    };
}

// A user's upload -> sanitized record. `charsets`: ids from charsets.js;
// `layoutText`: every character currently shown in the layout, also kept.
export async function ingestFontFile(file, { charsets, layoutText = '' }) {
    if (!file) throw new Error('No file chosen.');
    if (!ACCEPTED_EXTENSIONS.test(file.name)) throw new Error('Choose a .ttf, .otf, .woff or .woff2 font file.');
    if (file.size > MAX_FILE_BYTES) throw new Error('The font file is too large (over 15 MB).');
    const valid = charsets.filter((id) => CHARSETS[id]);
    const extra = [...new Set(layoutText)].join('');
    const codepoints = codepointsFor(valid, extra);
    const result = await runWorker(await file.arrayBuffer(), codepoints);
    return buildRecord(result, { charsets: valid, extraCharacters: extra.length });
}

// An embedded font from an imported file -> freshly sanitized record.
// The imported bytes are treated exactly like an upload: they go through
// the same sandbox and whitelist, keeping the characters they have.
export async function resanitizeEmbeddedFont(entry) {
    const faces = Array.isArray(entry?.faces) ? entry.faces : [];
    const face = faces.find((f) => typeof f?.base64_woff2 === 'string');
    if (!face) throw new Error(`The embedded font "${entry?.display_name ?? '?'}" has no data.`);
    let bytes;
    try {
        bytes = base64ToBytes(face.base64_woff2);
    } catch {
        throw new Error(`The embedded font "${entry.display_name}" is not valid base64.`);
    }
    const result = await runWorker(bytes.buffer, null);
    const record = buildRecord(result, {
        displayName: typeof entry.display_name === 'string' ? entry.display_name : '',
        charsets: Array.isArray(entry.subset_info?.charsets) ? entry.subset_info.charsets.filter((id) => CHARSETS[id]) : [],
        extraCharacters: 0,
    });
    record.subset_info.imported = true;
    return record;
}
