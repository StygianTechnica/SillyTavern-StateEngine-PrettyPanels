// FontConverter: turns an untrusted font file into a sanitized, subsetted
// WOFF2 - the only form Pretty Panels ever stores or exports. Runs inside
// the ingestion Worker (font-worker.js); it never sees the page.
//
// Pipeline (sanitize()):
//   1. Identify the format (TTF/OTF, WOFF, WOFF2; collections refused) and
//      decode it to plain SFNT.
//   2. Validate the table directory (every offset bounds-checked) and
//      require the tables a usable font needs.
//   3. Honour the font's own embedding licence (OS/2 fsType): fonts
//      marked "restricted", "no subsetting" or "bitmap only" are refused.
//   4. Keep only whitelisted tables (ALLOWED_TABLES): outlines, metrics,
//      character map, layout and variation data. Everything else - hinting
//      bytecode (fpgm, prep, cvt, cvar, hdmx, VDMX, LTSH), SVG documents,
//      bitmap strikes, signatures (DSIG), metadata (meta), Graphite/AAT
//      programs, vendor tables - is removed.
//   5. Subset with HarfBuzz (font-subsetter.js) to the requested code
//      points, also stripping glyph instructions and CFF hints. The name
//      table keeps only naming, version and legal-notice records.
//   6. Whitelist again (belt and braces) and rebuild the SFNT.
//   7. Compress to WOFF2, decompress it again and re-validate - a font
//      that does not survive the round trip is rejected.
//
// Any failure throws FontError with a message safe to show the user.

import {
    FontError, detectFormat, readTables, writeSfnt, inflateWoff, readNames, embeddingPermissions, readAxes, readCodepoints,
} from './sfnt.js';

export const REQUIRED_TABLES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post'];
export const ALLOWED_TABLES = new Set([
    ...REQUIRED_TABLES,
    'glyf', 'loca', 'CFF ', 'CFF2', 'VORG', // outlines
    'GDEF', 'GPOS', 'GSUB', 'kern', // layout
    'fvar', 'gvar', 'avar', 'HVAR', 'MVAR', 'VVAR', 'STAT', // variations
    'vhea', 'vmtx', 'COLR', 'CPAL', 'gasp',
]);
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;

const FORMAT_LABELS = { sfnt: 'TrueType/OpenType', woff: 'WOFF', woff2: 'WOFF2' };

function whitelist(tables) {
    const kept = new Map();
    const removed = [];
    for (const [tag, data] of tables) {
        if (ALLOWED_TABLES.has(tag)) kept.set(tag, data);
        else removed.push(tag.trim());
    }
    return { kept, removed };
}

function requireTables(tables, stage) {
    const missing = REQUIRED_TABLES.filter((tag) => !tables.has(tag));
    const outlines = (tables.has('glyf') && tables.has('loca')) || tables.has('CFF ') || tables.has('CFF2');
    if (missing.length || !outlines) {
        const what = [...missing.map((t) => t.trim()), ...(outlines ? [] : ['glyph outlines'])].join(', ');
        throw new FontError(`${stage}: the font is missing required data (${what}).`);
    }
}

export class FontConverter {
    // subsetter: a FontSubsetter; woff2: { compress, decompress } (vendor/woff2).
    constructor({ subsetter, woff2 }) {
        this.subsetter = subsetter;
        this.woff2 = woff2;
    }

    // Any supported input -> { format, sfnt }.
    async toSfnt(bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) throw new FontError('The file is empty.');
        if (bytes.byteLength > MAX_INPUT_BYTES) throw new FontError('The font file is too large (over 15 MB).');
        const format = detectFormat(bytes);
        if (format === 'collection') throw new FontError('Font collections (.ttc/.otc) are not supported - export a single font first.');
        if (!format) throw new FontError('This is not a font file Pretty Panels can read (.ttf, .otf, .woff or .woff2).');
        let sfnt = bytes;
        try {
            if (format === 'woff') sfnt = await inflateWoff(bytes);
            else if (format === 'woff2') sfnt = await this.woff2.decompress(bytes);
        } catch (err) {
            if (err instanceof FontError) throw err;
            throw new FontError(`The ${FORMAT_LABELS[format]} file could not be decoded - it may be damaged.`);
        }
        if (detectFormat(sfnt) !== 'sfnt') throw new FontError('The file did not decode to a usable font.');
        return { format, sfnt };
    }

    // Read-only facts about an SFNT (used for naming and the picker).
    inspect(sfnt) {
        const { flavor, tables } = readTables(sfnt);
        const names = readNames(tables);
        return {
            flavor,
            tables,
            family: names[16] || names[1] || '',
            style: names[17] || names[2] || '',
            version: names[5] || '',
            copyright: names[0] || '',
            license: names[13] || '',
            licenseUrl: names[14] || '',
            axes: readAxes(tables),
            permissions: embeddingPermissions(tables),
        };
    }

    // Untrusted bytes -> { woff2: Uint8Array, info }. `codepoints` is the
    // Set of characters to keep, or null to keep every character the font
    // maps (re-sanitizing an already-subsetted font from an import).
    async sanitize(bytes, { codepoints }) {
        const { format, sfnt } = await this.toSfnt(bytes);
        const facts = this.inspect(sfnt);
        requireTables(facts.tables, 'Rejected');

        const { permissions } = facts;
        if (permissions.restricted) {
            throw new FontError('Rejected: this font\'s licence forbids embedding it ("restricted license" in its OS/2 table), so it can\'t be used in panels or exported layouts.');
        }
        if (permissions.noSubsetting) {
            throw new FontError('Rejected: this font\'s licence forbids subsetting it, and Pretty Panels only stores subsetted fonts.');
        }
        if (permissions.bitmapOnly) {
            throw new FontError('Rejected: this font\'s licence only allows embedding bitmaps, which Pretty Panels does not use.');
        }

        const available = readCodepoints(facts.tables);
        const wanted = codepoints ? [...codepoints].filter((c) => available.has(c)) : [...available];
        if (wanted.length === 0) throw new FontError('Rejected: the font has none of the characters in the chosen character sets.');

        const first = whitelist(facts.tables);
        let subset;
        try {
            subset = this.subsetter.subset(writeSfnt(facts.flavor, first.kept), { codepoints: wanted, noHinting: true });
        } catch (err) {
            if (err instanceof FontError) throw err;
            throw new FontError('Rejected: the font could not be subsetted - it may be damaged.');
        }

        const second = readTables(subset);
        const final = whitelist(second.tables);
        requireTables(final.kept, 'Rejected after sanitizing');
        const clean = writeSfnt(second.flavor, final.kept);

        let woff2;
        try {
            woff2 = await this.woff2.compress(clean);
            const back = await this.woff2.decompress(woff2);
            requireTables(readTables(back).tables, 'Rejected after conversion');
        } catch (err) {
            if (err instanceof FontError) throw err;
            throw new FontError('Rejected: the sanitized font could not be converted to WOFF2.');
        }

        const kept = readCodepoints(final.kept);
        const removedTables = [...new Set([...first.removed, ...[...facts.tables.keys()].map((t) => t.trim()).filter((t) => !final.kept.has(t.padEnd(4)))])];
        return {
            woff2,
            info: {
                family: facts.family,
                style: facts.style,
                version: facts.version,
                copyright: facts.copyright,
                license: facts.license,
                licenseUrl: facts.licenseUrl,
                axes: readAxes(final.kept),
                originalFormat: FORMAT_LABELS[format],
                originalBytes: bytes.byteLength,
                sanitizedBytes: woff2.byteLength,
                codepoints: [...kept].sort((a, b) => a - b),
                glyphCount: new DataView(final.kept.get('maxp').buffer).getUint16(4),
                tablesKept: [...final.kept.keys()].map((t) => t.trim()).sort(),
                tablesRemoved: removedTables.sort(),
                hintingRemoved: true,
                fsType: permissions.fsType,
            },
        };
    }
}
