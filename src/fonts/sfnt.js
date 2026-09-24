// Minimal, defensive SFNT (TrueType / OpenType) reading and writing -
// just what the font pipeline needs, with no dependencies, so it runs the
// same in the ingestion worker, the export path and Node (build scripts):
//
//   detectFormat(bytes)        'sfnt' | 'woff' | 'woff2' | 'collection' | null
//   readTables(bytes)          validated table directory -> Map(tag -> bytes)
//   writeSfnt(flavor, tables)  a fresh SFNT with correct padding/checksums
//   inflateWoff(bytes)         WOFF 1.0 -> SFNT (zlib via DecompressionStream)
//   readNames(tables)          name table records -> { [nameId]: string }
//   embeddingPermissions(tables)  decoded OS/2 fsType
//
// Every reader bounds-checks against the buffer and throws a FontError
// with a message safe to show the user; nothing here trusts offsets.

export class FontError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FontError';
    }
}

const TAG_TRUE = 0x74727565; // 'true' (old Apple TrueType)
const SFNT_TRUETYPE = 0x00010000;
const SFNT_CFF = 0x4f54544f; // 'OTTO'
const MAX_TABLES = 128;

export function tagToString(tag) {
    return String.fromCharCode((tag >>> 24) & 255, (tag >>> 16) & 255, (tag >>> 8) & 255, tag & 255);
}

export function stringToTag(text) {
    const s = `${text}    `.slice(0, 4);
    return ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
}

function view(bytes) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export function detectFormat(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 12) return null;
    const magic = view(bytes).getUint32(0);
    if (magic === SFNT_TRUETYPE || magic === SFNT_CFF || magic === TAG_TRUE) return 'sfnt';
    if (magic === 0x774f4646) return 'woff'; // 'wOFF'
    if (magic === 0x774f4632) return 'woff2'; // 'wOF2'
    if (magic === 0x74746366) return 'collection'; // 'ttcf'
    return null;
}

// Validated table directory. Returns { flavor, tables: Map(tag -> Uint8Array copy) }.
export function readTables(bytes) {
    if (detectFormat(bytes) !== 'sfnt') throw new FontError('Not a TrueType or OpenType font.');
    const dv = view(bytes);
    const flavor = dv.getUint32(0);
    const count = dv.getUint16(4);
    if (count === 0 || count > MAX_TABLES) throw new FontError('The font has an invalid table directory.');
    if (12 + count * 16 > bytes.byteLength) throw new FontError('The font file is truncated.');
    const tables = new Map();
    for (let i = 0; i < count; i++) {
        const o = 12 + i * 16;
        const tag = tagToString(dv.getUint32(o));
        const offset = dv.getUint32(o + 8);
        const length = dv.getUint32(o + 12);
        if (!/^[\x20-\x7e]{4}$/.test(tag)) throw new FontError('The font has a malformed table tag.');
        if (offset + length > bytes.byteLength || offset < 12 + count * 16) {
            throw new FontError(`The font's "${tag.trim()}" table points outside the file.`);
        }
        if (tables.has(tag)) throw new FontError(`The font has a duplicate "${tag.trim()}" table.`);
        tables.set(tag, bytes.slice(offset, offset + length));
    }
    return { flavor, tables };
}

function checksum(bytes) {
    const padded = bytes.byteLength % 4 ? new Uint8Array(bytes.byteLength + (4 - (bytes.byteLength % 4))) : bytes;
    if (padded !== bytes) padded.set(bytes);
    const dv = view(padded);
    let sum = 0;
    for (let i = 0; i < padded.byteLength; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
    return sum;
}

// Builds an SFNT from Map(tag -> bytes): sorted directory, 4-byte
// alignment, per-table checksums and head.checkSumAdjustment.
export function writeSfnt(flavor, tables) {
    const tags = [...tables.keys()].sort();
    const count = tags.length;
    const pow = 2 ** Math.floor(Math.log2(count));
    let offset = 12 + count * 16;
    const layout = tags.map((tag) => {
        const data = tables.get(tag);
        const entry = { tag, data, offset };
        offset += data.byteLength + ((4 - (data.byteLength % 4)) % 4);
        return entry;
    });
    const out = new Uint8Array(offset);
    const dv = view(out);
    dv.setUint32(0, flavor);
    dv.setUint16(4, count);
    dv.setUint16(6, pow * 16);
    dv.setUint16(8, Math.log2(pow));
    dv.setUint16(10, count * 16 - pow * 16);
    let headOffset = -1;
    layout.forEach(({ tag, data, offset: at }, i) => {
        let body = data;
        if (tag === 'head' && data.byteLength >= 12) {
            body = data.slice();
            view(body).setUint32(8, 0); // checkSumAdjustment is computed last
            headOffset = at;
        }
        const o = 12 + i * 16;
        dv.setUint32(o, stringToTag(tag));
        dv.setUint32(o + 4, checksum(body));
        dv.setUint32(o + 8, at);
        dv.setUint32(o + 12, body.byteLength);
        out.set(body, at);
    });
    if (headOffset >= 0) dv.setUint32(headOffset + 8, (0xb1b0afba - checksum(out)) >>> 0);
    return out;
}

async function inflate(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new FontError('This browser cannot read WOFF 1.0 fonts.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

// WOFF 1.0 -> SFNT. Each table is zlib-compressed unless storing it raw
// was smaller; the result is rebuilt (not trusted) by writeSfnt().
export async function inflateWoff(bytes) {
    const dv = view(bytes);
    if (bytes.byteLength < 44) throw new FontError('The WOFF file is truncated.');
    const flavor = dv.getUint32(4);
    const count = dv.getUint16(12);
    if (count === 0 || count > MAX_TABLES || 44 + count * 20 > bytes.byteLength) {
        throw new FontError('The WOFF file has an invalid table directory.');
    }
    const tables = new Map();
    for (let i = 0; i < count; i++) {
        const o = 44 + i * 20;
        const tag = tagToString(dv.getUint32(o));
        const offset = dv.getUint32(o + 4);
        const compLength = dv.getUint32(o + 8);
        const origLength = dv.getUint32(o + 12);
        if (offset + compLength > bytes.byteLength || origLength > 64 * 1024 * 1024) {
            throw new FontError(`The WOFF file's "${tag.trim()}" table is invalid.`);
        }
        const raw = bytes.subarray(offset, offset + compLength);
        const data = compLength < origLength ? await inflate(raw) : raw.slice();
        if (data.byteLength !== origLength) throw new FontError(`The WOFF file's "${tag.trim()}" table did not decompress correctly.`);
        tables.set(tag, data);
    }
    return writeSfnt(flavor, tables);
}

// name table -> { [nameId]: string }, preferring Windows Unicode English.
export function readNames(tables) {
    const name = tables.get('name');
    const out = {};
    if (!name || name.byteLength < 6) return out;
    const dv = view(name);
    const count = dv.getUint16(2);
    const storage = dv.getUint16(4);
    const rank = {};
    for (let i = 0; i < count; i++) {
        const o = 6 + i * 12;
        if (o + 12 > name.byteLength) break;
        const platform = dv.getUint16(o);
        const encoding = dv.getUint16(o + 2);
        const language = dv.getUint16(o + 4);
        const id = dv.getUint16(o + 6);
        const length = dv.getUint16(o + 8);
        const start = storage + dv.getUint16(o + 10);
        if (start + length > name.byteLength) continue;
        const raw = name.subarray(start, start + length);
        let text;
        let score;
        if (platform === 3 || platform === 0) {
            text = '';
            for (let j = 0; j + 1 < raw.length; j += 2) text += String.fromCharCode((raw[j] << 8) | raw[j + 1]);
            score = platform === 3 && language === 0x409 ? 3 : 2;
        } else if (platform === 1 && encoding === 0) {
            text = String.fromCharCode(...raw);
            score = 1;
        } else {
            continue;
        }
        if ((rank[id] ?? 0) < score) {
            rank[id] = score;
            out[id] = text;
        }
    }
    return out;
}

// OS/2 fsType (the font's own embedding licence bits). A font without an
// OS/2 table is treated as installable (the OpenType default).
export function embeddingPermissions(tables) {
    const os2 = tables.get('OS/2');
    const fsType = os2 && os2.byteLength >= 10 ? view(os2).getUint16(8) : 0;
    return {
        fsType,
        restricted: (fsType & 0x000f) === 0x0002,
        noSubsetting: (fsType & 0x0100) !== 0,
        bitmapOnly: (fsType & 0x0200) !== 0,
    };
}

// fvar axes: [{ tag, min, default, max }].
export function readAxes(tables) {
    const fvar = tables.get('fvar');
    if (!fvar || fvar.byteLength < 16) return [];
    const dv = view(fvar);
    const axesOffset = dv.getUint16(4);
    const count = dv.getUint16(8);
    const size = dv.getUint16(10);
    const axes = [];
    for (let i = 0; i < count; i++) {
        const o = axesOffset + i * size;
        if (o + 20 > fvar.byteLength) break;
        const fixed = (p) => Math.round((dv.getInt32(p) / 65536) * 100) / 100;
        axes.push({ tag: tagToString(dv.getUint32(o)), min: fixed(o + 4), default: fixed(o + 8), max: fixed(o + 12) });
    }
    return axes;
}

// Unicode code points the font maps (cmap format 4 and 12 subtables).
export function readCodepoints(tables) {
    const cmap = tables.get('cmap');
    const points = new Set();
    if (!cmap || cmap.byteLength < 4) return points;
    const dv = view(cmap);
    const count = dv.getUint16(2);
    for (let i = 0; i < count; i++) {
        const rec = 4 + i * 8;
        if (rec + 8 > cmap.byteLength) break;
        const offset = dv.getUint32(rec + 4);
        if (offset + 4 > cmap.byteLength) continue;
        const format = dv.getUint16(offset);
        if (format === 4) {
            const segX2 = dv.getUint16(offset + 6);
            const ends = offset + 14;
            const starts = ends + segX2 + 2;
            for (let s = 0; s < segX2 / 2; s++) {
                if (starts + s * 2 + 2 > cmap.byteLength) break;
                const end = dv.getUint16(ends + s * 2);
                const start = dv.getUint16(starts + s * 2);
                for (let c = start; c <= end && c !== 0xffff; c++) points.add(c);
            }
        } else if (format === 12) {
            const groups = dv.getUint32(offset + 12);
            for (let g = 0; g < groups && g < 100000; g++) {
                const o = offset + 16 + g * 12;
                if (o + 12 > cmap.byteLength) break;
                const start = dv.getUint32(o);
                const end = Math.min(dv.getUint32(o + 4), start + 0x10000);
                for (let c = start; c <= end; c++) points.add(c);
            }
        }
    }
    return points;
}
