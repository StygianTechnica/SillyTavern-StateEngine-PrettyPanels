// FontExportAssembler: the fonts section of a layout or panel-template
// export, and its import counterpart.
//
// Export (assembleFonts): every non-system font the exported elements
// use is embedded as base64 WOFF2 - curated fonts from their bundled
// files (already Latin subsets), user fonts from their stored sanitized
// subset. No URL is ever referenced and nothing but WOFF2 is embedded
// (each face is checked for the WOFF2 signature). The result carries both
// structured data and ready-to-use @font-face CSS:
//
//   data.fonts = {
//     faces: [{ font_id, display_name, source, family, fallback_stack,
//               variable_axes, subset_info?, notice?, license?,
//               faces: [{ weight, style, stretch, unicode_range, base64_woff2 }] }],
//     css: '@font-face { font-family: "UserFont_abc"; src: url(data:font/woff2;base64,...) format("woff2"); ... }',
//   }
//
// Import (importEmbeddedFonts): curated fonts already installed are used
// as-is (the embedded copy is ignored); every other embedded font goes
// back through the sandbox (resanitizeEmbeddedFont) - the embedded CSS is
// never injected. Returns a Map of renamed ids for remapWidgetFonts().

import { fontRegistry, bytesToBase64, SYSTEM_FONT_IDS } from './font-registry.js';
import { resanitizeEmbeddedFont } from './font-ingest.js';

const WOFF2_MAGIC_B64 = 'd09GMg';
const CURATED_DIR = new URL('../../fonts/curated/', import.meta.url);

// One @font-face block (the export's CSS form).
export function fontFaceCss(family, face) {
    const lines = [
        `  font-family: "${family}";`,
        `  src: url(data:font/woff2;base64,${face.base64_woff2}) format("woff2");`,
        `  font-weight: ${face.weight || 'normal'};`,
        `  font-style: ${face.style || 'normal'};`,
    ];
    if (face.stretch) lines.push(`  font-stretch: ${face.stretch};`);
    if (face.unicode_range) lines.push(`  unicode-range: ${face.unicode_range};`);
    lines.push('  font-display: swap;');
    return `@font-face {\n${lines.join('\n')}\n}`;
}

async function curatedFaces(font) {
    const faces = [];
    for (const face of font.faces) {
        const response = await fetch(new URL(face.file_path, CURATED_DIR));
        if (!response.ok) throw new Error(`The bundled font file ${face.file_path} is missing.`);
        const b64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
        faces.push({ weight: face.weight, style: face.style, stretch: face.stretch ?? null, unicode_range: face.unicode_range, base64_woff2: b64 });
    }
    return faces;
}

function userFaces(font) {
    const wght = font.variable_axes?.find((a) => a.tag === 'wght');
    const wdth = font.variable_axes?.find((a) => a.tag === 'wdth');
    return [{
        weight: wght ? `${wght.min} ${wght.max}` : '400',
        style: 'normal',
        stretch: wdth ? `${wdth.min}% ${wdth.max}%` : null,
        unicode_range: font.subset_info?.unicode_range ?? null,
        base64_woff2: font.sanitized_base64_woff2,
    }];
}

// fontIds: Iterable of font ids -> the export's `fonts` section, or null
// when nothing needs embedding. Unknown ids are skipped.
export async function assembleFonts(fontIds) {
    await fontRegistry.load();
    const entries = [];
    for (const id of fontIds) {
        if (SYSTEM_FONT_IDS.has(id)) continue;
        const font = fontRegistry.get(id);
        if (!font) continue;
        const faces = font.source === 'curated' ? await curatedFaces(font) : userFaces(font);
        if (!faces.every((f) => typeof f.base64_woff2 === 'string' && f.base64_woff2.startsWith(WOFF2_MAGIC_B64))) {
            throw new Error(`"${font.display_name}" is not a sanitized WOFF2 font and cannot be exported.`);
        }
        entries.push({
            font_id: font.font_id,
            display_name: font.display_name,
            source: font.source,
            family: font.family,
            fallback_stack: font.fallback_stack,
            variable_axes: font.variable_axes ?? [],
            ...(font.source === 'curated' ? { license: font.license } : { subset_info: font.subset_info, notice: font.notice }),
            faces,
        });
    }
    if (entries.length === 0) return null;
    return {
        faces: entries,
        css: entries.flatMap((e) => e.faces.map((face) => fontFaceCss(e.family, face))).join('\n\n'),
    };
}

// The `fonts` section of an imported file -> Map(oldId -> newId) for ids
// that changed. Throws an Error naming the font if one is rejected.
export async function importEmbeddedFonts(section, { onProgress } = {}) {
    const remap = new Map();
    const entries = Array.isArray(section?.faces) ? section.faces : [];
    await fontRegistry.load();
    for (const entry of entries) {
        const id = typeof entry?.font_id === 'string' ? entry.font_id : '';
        if (!id || SYSTEM_FONT_IDS.has(id)) continue;
        const existing = fontRegistry.get(id);
        if (existing?.source === 'curated') continue;
        if (existing && existing.sanitized_base64_woff2 === entry.faces?.[0]?.base64_woff2) continue;
        onProgress?.(entry.display_name ?? id);
        let record;
        try {
            record = await resanitizeEmbeddedFont(entry);
        } catch (err) {
            throw new Error(`The embedded font "${entry.display_name ?? id}" was rejected: ${err.message}`);
        }
        // The same font imported before (identical sanitized output) is reused.
        const same = fontRegistry.userFonts().find((f) => f.sanitized_base64_woff2 === record.sanitized_base64_woff2);
        if (!same) fontRegistry.addUserFont(record);
        remap.set(id, (same ?? record).font_id);
    }
    return remap;
}
