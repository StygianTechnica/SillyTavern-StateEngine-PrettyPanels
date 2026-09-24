// Value formatting for VariableElements. The Format dropdown offers the
// formats for the bound variable's type; 'auto' always exists and is the
// sensible default for that type. A calculated variable is formatted by
// the type of the value it actually produced.
//
// Datetime values are formatted through State Engine's calendar-aware
// formatter (so fantasy calendars work), installed at startup with
// setDateTimeFormatter(). 'auto' follows the variable's own datetimeMode
// (a "Date only" variable shows its date, "Time only" its time); the other
// datetime formats let one variable be shown several ways, and 'custom'
// uses the element's own `formatPattern`.

const FORMATS = {
    number: [
        ['auto', 'As stored'],
        ['integer', 'Whole number'],
        ['fixed1', '1 decimal place'],
        ['fixed2', '2 decimal places'],
        ['grouped', 'Thousands separators'],
        ['ofMax', 'Value / max'],
        ['percent', 'Percent of max'],
    ],
    boolean: [
        ['auto', 'true / false'],
        ['yesno', 'Yes / No'],
        ['onoff', 'On / Off'],
        ['check', '✓ / ✗'],
    ],
    string: [
        ['auto', 'As stored'],
        ['upper', 'UPPERCASE'],
        ['lower', 'lowercase'],
        ['title', 'Title Case'],
    ],
    array: [
        ['auto', 'Comma separated'],
        ['lines', 'One per line'],
        ['count', 'Item count'],
    ],
    datetime: [
        ['auto', 'Automatic'],
        ['full', 'Date and time'],
        ['date', 'Date only'],
        ['time', 'Time only'],
        ['timeShort', 'Time (hours:minutes)'],
        ['longDate', 'Long date'],
        ['longDateTime', 'Long date and time'],
        ['month', 'Month name'],
        ['year', 'Year'],
        ['season', 'Season'],
        ['custom', 'Custom pattern…'],
    ],
    image: [
        ['auto', 'Image'],
        ['text', 'Image URL'],
    ],
    imageList: [
        ['auto', 'First image'],
        ['count', 'Image count'],
    ],
    imageMap: [
        ['auto', 'Image count'],
    ],
};
FORMATS.enum = FORMATS.string;

// Datetime format -> the Calendar API's formatDateTime() options. Brace
// templates work for every calendar (Gregorian patterns have no unpadded
// day token), and use the calendar's own month and season names.
const DATETIME_OPTIONS = {
    full: { style: 'full' },
    date: { style: 'date' },
    time: { style: 'time' },
    timeShort: { style: 'custom', pattern: 'HH:mm' },
    longDate: { style: 'custom', pattern: '{monthName} {day}, {year}' },
    longDateTime: { style: 'custom', pattern: '{monthName} {day}, {year} {HH}:{mm}' },
    month: { style: 'month' },
    year: { style: 'year' },
    season: { style: 'custom', pattern: '{season}' },
};

// What 'auto' means for a datetime variable, by its datetimeMode.
const DATETIME_MODE_FORMATS = { dateOnly: 'date', timeOnly: 'time' };
const DATETIME_AUTO_LABELS = { date: 'Automatic (date only)', time: 'Automatic (time only)', full: 'Automatic (date and time)' };

function datetimeAuto(def) {
    return DATETIME_MODE_FORMATS[def?.datetimeMode] ?? 'full';
}

// Shown under a Custom pattern field.
export const DATETIME_PATTERN_HINT = 'Placeholders: {monthName} {month} {day} {year} {HH} {mm} {ss} {season} {era} {cycle}. Or tokens: YYYY MM DD HH mm ss MMM MMMM.';

let formatDateTime = null;

export function setDateTimeFormatter(formatter) {
    formatDateTime = typeof formatter === 'function' ? formatter : null;
}

// The format family for a definition (and, for calculated or unknown
// definitions, the value it holds).
export function formatType(def, value) {
    const type = def?.type;
    if (type && type !== 'calculated' && FORMATS[type]) return type;
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'string';
}

export function formatsFor(def, value) {
    const family = formatType(def, value);
    return FORMATS[family].map(([id, label]) => ({
        id,
        label: family === 'datetime' && id === 'auto' ? DATETIME_AUTO_LABELS[datetimeAuto(def)] : label,
    }));
}

function titleCase(text) {
    return text.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function plain(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

// Returns { text } or { image: url } for rendering. Never throws - a value
// that can't be formatted as asked falls back to its plain text.
// `pattern` is the element's formatPattern, used by the 'custom' format.
export function formatValue(value, def, format = 'auto', pattern = '') {
    const family = formatType(def, value);
    const known = FORMATS[family].some(([id]) => id === format);
    const fmt = known ? format : 'auto';
    try {
        switch (family) {
            case 'number': {
                const n = Number(value);
                if (!Number.isFinite(n)) return { text: plain(value) };
                const min = Number.isFinite(def?.min) ? def.min : 0;
                const max = Number.isFinite(def?.max) ? def.max : null;
                if (fmt === 'integer') return { text: String(Math.round(n)) };
                if (fmt === 'fixed1') return { text: n.toFixed(1) };
                if (fmt === 'fixed2') return { text: n.toFixed(2) };
                if (fmt === 'grouped') return { text: n.toLocaleString() };
                if (fmt === 'ofMax' && max !== null) return { text: `${n} / ${max}` };
                if (fmt === 'percent' && max !== null && max !== min) {
                    return { text: `${Math.round(((n - min) / (max - min)) * 100)}%` };
                }
                return { text: String(n) };
            }
            case 'boolean': {
                const on = value === true || value === 'true';
                if (fmt === 'yesno') return { text: on ? 'Yes' : 'No' };
                if (fmt === 'onoff') return { text: on ? 'On' : 'Off' };
                if (fmt === 'check') return { text: on ? '✓' : '✗' };
                return { text: String(on) };
            }
            case 'string':
            case 'enum': {
                const text = plain(value);
                if (fmt === 'upper') return { text: text.toUpperCase() };
                if (fmt === 'lower') return { text: text.toLowerCase() };
                if (fmt === 'title') return { text: titleCase(text) };
                return { text };
            }
            case 'array': {
                const items = Array.isArray(value) ? value.map(plain) : [plain(value)];
                if (fmt === 'count') return { text: String(items.length) };
                if (fmt === 'lines') return { text: items.join('\n') };
                return { text: items.join(', ') };
            }
            case 'datetime': {
                if (formatDateTime && Number.isFinite(Number(value))) {
                    const key = fmt === 'auto' ? datetimeAuto(def) : fmt;
                    const custom = typeof pattern === 'string' ? pattern.trim() : '';
                    const options = key === 'custom'
                        ? (custom ? { style: 'custom', pattern: custom } : DATETIME_OPTIONS.full)
                        : DATETIME_OPTIONS[key];
                    return { text: formatDateTime(def?.calendar || 'gregorian', Number(value), options) };
                }
                return { text: plain(value) };
            }
            case 'image': {
                const url = typeof value === 'string' ? value : '';
                if (fmt === 'text' || !url) return { text: url };
                return { image: url };
            }
            case 'imageList': {
                const list = Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];
                if (fmt === 'count' || list.length === 0) return { text: String(list.length) };
                return { image: list[0] };
            }
            case 'imageMap': {
                const count = value && typeof value === 'object' ? Object.keys(value).length : 0;
                return { text: `${count} image${count === 1 ? '' : 's'}` };
            }
            default:
                return { text: plain(value) };
        }
    } catch {
        return { text: plain(value) };
    }
}
