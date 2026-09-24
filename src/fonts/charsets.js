// Named character sets an uploaded font is subsetted to (plus whatever
// characters the layout already uses - see font-ingest.js). Ranges follow
// the Google Fonts / Fontsource script splits, so curated and uploaded
// fonts cover the same text.

export const CHARSETS = {
    latin: {
        label: 'Latin (English, Western European)',
        ranges: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    },
    'latin-ext': {
        label: 'Latin Extended (Central European, more accents)',
        ranges: 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF',
    },
    cyrillic: {
        label: 'Cyrillic',
        ranges: 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116',
    },
    greek: {
        label: 'Greek',
        ranges: 'U+0370-0377,U+037A-037F,U+0384-038A,U+038C,U+038E-03A1,U+03A3-03FF',
    },
    symbols: {
        label: 'Symbols (arrows, shapes, stars, hearts)',
        ranges: 'U+2190-21FF,U+2500-257F,U+25A0-25FF,U+2600-26FF,U+2700-27BF',
    },
};

export const DEFAULT_CHARSETS = ['latin', 'latin-ext'];

// "U+0041-005A,U+00E9" -> [[0x41, 0x5a], [0xe9, 0xe9]]
export function parseRanges(text) {
    const out = [];
    for (const part of String(text).split(',')) {
        const m = part.trim().match(/^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i);
        if (!m) continue;
        const start = parseInt(m[1], 16);
        const end = m[2] ? parseInt(m[2], 16) : start;
        if (end >= start && end <= 0x10ffff) out.push([start, end]);
    }
    return out;
}

// Code points for a list of charset ids plus any extra text.
export function codepointsFor(charsetIds, extraText = '') {
    const points = new Set();
    for (const id of charsetIds) {
        for (const [start, end] of parseRanges(CHARSETS[id]?.ranges ?? '')) {
            for (let c = start; c <= end; c++) points.add(c);
        }
    }
    for (const ch of String(extraText)) {
        const c = ch.codePointAt(0);
        if (c >= 0x20) points.add(c);
    }
    return points;
}

// A sorted set of code points -> a compact CSS unicode-range value.
export function toUnicodeRange(points) {
    const sorted = [...points].sort((a, b) => a - b);
    const parts = [];
    for (let i = 0; i < sorted.length; i++) {
        const start = sorted[i];
        while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
        const hex = (n) => n.toString(16).toUpperCase().padStart(4, '0');
        parts.push(start === sorted[i] ? `U+${hex(start)}` : `U+${hex(start)}-${hex(sorted[i])}`);
    }
    return parts.join(',');
}
