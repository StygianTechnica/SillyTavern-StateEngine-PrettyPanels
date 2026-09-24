// FontSubsetter: keeps only the glyphs a set of code points needs, using
// HarfBuzz's own subsetter (hb-subset, the engine Google Fonts uses),
// compiled to a standalone WebAssembly module with no imports
// (vendor/harfbuzz/harfbuzz-subset.wasm - it cannot touch the page, the
// network or anything else; it only sees the bytes it is given).
//
// Subsetting also sanitizes: hb-subset rebuilds every table it keeps from
// its parsed contents, drops tables it doesn't recognize, and - with
// `noHinting` - removes TrueType bytecode (fpgm, prep, cvt, glyph
// instructions) and CFF hints.
//
//   const subsetter = await FontSubsetter.create(wasmUrlOrBytes);
//   const out = subsetter.subset(sfntBytes, { codepoints, keepNameIds, noHinting, pinAxes });
//
// Works in a Worker, on the page and in Node.

import { FontError, stringToTag } from './sfnt.js';

// hb_subset_sets_t
const SETS_UNICODE = 1;
const SETS_DROP_TABLE_TAG = 3;
const SETS_NAME_ID = 4;
// hb_subset_flags_t
const FLAG_NO_HINTING = 0x1;
const FLAG_DESUBROUTINIZE = 0x4;
// hb_memory_mode_t
const MEMORY_MODE_READONLY = 1;

// Name records kept by default: family/style/full/PostScript names and
// version (1-6, 16, 17, 25) plus the font's legal notices - copyright (0),
// trademark (7), licence description (13) and licence URL (14), which a
// font's licence usually requires to travel with every copy.
export const DEFAULT_NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 13, 14, 16, 17, 25];

export class FontSubsetter {
    static async create(source) {
        let bytes = source;
        if (typeof source === 'string' || source instanceof URL) {
            const response = await fetch(source);
            if (!response.ok) throw new FontError('The font subsetter could not be loaded.');
            bytes = await response.arrayBuffer();
        }
        const { instance } = await WebAssembly.instantiate(bytes, {});
        return new FontSubsetter(instance.exports);
    }

    constructor(exports) {
        this.hb = exports;
        exports._initialize?.();
    }

    // codepoints: Iterable<number>, or 'all' to keep every glyph (only
    // useful with pinAxes). pinAxes: { tag: value } instances
    // those axes away (a smaller static slice of a variable font).
    // Returns the subsetted SFNT bytes; throws FontError on failure.
    subset(sfnt, { codepoints, keepNameIds = DEFAULT_NAME_IDS, dropTables = [], noHinting = true, desubroutinize = false, pinAxes = {} } = {}) {
        const hb = this.hb;
        const fontPtr = hb.malloc(sfnt.byteLength);
        if (!fontPtr) throw new FontError('Not enough memory to process this font.');
        new Uint8Array(hb.memory.buffer).set(sfnt, fontPtr);
        const blob = hb.hb_blob_create(fontPtr, sfnt.byteLength, MEMORY_MODE_READONLY, 0, 0);
        const face = hb.hb_face_create(blob, 0);
        hb.hb_blob_destroy(blob);
        const input = hb.hb_subset_input_create_or_fail();
        try {
            if (!input) throw new FontError('The font subsetter could not start.');

            const unicodes = hb.hb_subset_input_unicode_set(input);
            if (codepoints === 'all') hb.hb_set_invert(unicodes);
            else for (const c of codepoints) hb.hb_set_add(unicodes, c);

            const names = hb.hb_subset_input_set(input, SETS_NAME_ID);
            hb.hb_set_clear(names);
            for (const id of keepNameIds) hb.hb_set_add(names, id);

            const drop = hb.hb_subset_input_set(input, SETS_DROP_TABLE_TAG);
            for (const tag of dropTables) hb.hb_set_add(drop, stringToTag(tag));

            let flags = hb.hb_subset_input_get_flags(input);
            if (noHinting) flags |= FLAG_NO_HINTING;
            if (desubroutinize) flags |= FLAG_DESUBROUTINIZE;
            hb.hb_subset_input_set_flags(input, flags >>> 0);

            for (const [tag, value] of Object.entries(pinAxes)) {
                if (!hb.hb_subset_input_pin_axis_location(input, face, stringToTag(tag), value)) {
                    throw new FontError(`The font has no "${tag}" axis to pin.`);
                }
            }

            const result = hb.hb_subset_or_fail(face, input);
            if (!result) throw new FontError('The font could not be subsetted - it may be damaged or use an unsupported format.');
            const outBlob = hb.hb_face_reference_blob(result);
            const length = hb.hb_blob_get_length(outBlob);
            const dataPtr = hb.hb_blob_get_data(outBlob, 0);
            const out = length && dataPtr ? new Uint8Array(hb.memory.buffer, dataPtr, length).slice() : null;
            hb.hb_blob_destroy(outBlob);
            hb.hb_face_destroy(result);
            if (!out) throw new FontError('Subsetting produced an empty font.');
            return out;
        } finally {
            if (input) hb.hb_subset_input_destroy(input);
            hb.hb_face_destroy(face);
            hb.free(fontPtr);
        }
    }
}
