// Text formatting: ONE pipeline for every piece of text Pretty Panels shows -
// free text, a variable's value, a role's value (its assigned variable's),
// and a gauge's value. An element's formatting lives in one structure,
// element.format:
//
//   {
//     textCase:   '' (as typed) | 'upper' | 'lower' | 'capitalize'
//     themeStyle: '' | 'title' | 'subtitle' | 'heading' | 'hud' | 'body' | 'caption'
//     value: {                     value formatting, by the value's kind - each
//                                  kind keeps its own choice, so rebinding to a
//                                  variable of another type doesn't lose it
//       number:  '' (as stored) | 'commas' | 'fixed' | 'rounded' | 'percent' |
//                'ofMax' | 'duration' | 'durationHuman' | 'custom'
//       decimals: 0-6           for commas, fixed and custom numbers
//       numberPattern: string   custom numbers: text with {value}
//       date:    '' (automatic) | 'iso' | 'long' | 'dayMonth' | 'none' | 'custom'
//       time:    '' (automatic) | 'hms' | 'hm' | '12h' | 'none'
//       datePattern: string     custom date/time pattern (brace placeholders)
//       boolean: '' | 'yesno' | 'onoff' | 'check'
//       list:    '' | 'lines' | 'count'
//       image:   '' | 'url'            imageList: '' | 'count'
//       characterPresence: boolean  characters: show the presence dot (default on)
//       characterAliases:  boolean  characters: list the aliases (default off)
//     }
//   }
//
// render: formatText(value, def, format) = value formatting (by kind) ->
// text case. Theme Style is applied to the element's look by
// src/themes/theme-apply.js themedElement() (font family, size, weight,
// spacing, line height and colour from the panel's theme); text case is
// applied here, to the text itself, never through CSS.
//
// Datetime values are formatted by State Engine's calendar-aware formatter
// (fantasy calendars work), installed at startup with
// setDateTimeFormatter(). Automatic date/time follow the variable's
// datetimeMode and the theme's formatting patterns (or the calendar's own).

export const TEXT_CASES = [
    ['', 'As typed'],
    ['upper', 'UPPERCASE'],
    ['lower', 'lowercase'],
    ['capitalize', 'Capitalize Words'],
];

// Theme Style presets. Sizes and spacing are fixed; font and colour come
// from the panel's theme (CSS variables set by theme-apply.js themeVars).
export const THEME_STYLES = [
    ['', 'None'],
    ['title', 'Title'],
    ['subtitle', 'Subtitle'],
    ['heading', 'Section heading'],
    ['hud', 'HUD label'],
    ['body', 'Body text'],
    ['caption', 'Caption'],
];
const TEXT_COLOR = 'var(--ppt-text, var(--SmartThemeBodyColor))';
const THEME_STYLE_LOOKS = {
    title: { fontSize: 26, fontWeight: 700, letterSpacing: 0.01, lineHeight: 1.1, font: '--ppt-title-font', color: TEXT_COLOR },
    subtitle: { fontSize: 18, fontWeight: 600, letterSpacing: 0, lineHeight: 1.2, font: '--ppt-title-font', color: TEXT_COLOR },
    heading: { fontSize: 13, fontWeight: 700, letterSpacing: 0.12, lineHeight: 1.2, font: '--ppt-label-font', color: 'var(--ppt-accent, var(--SmartThemeQuoteColor))' },
    hud: { fontSize: 12, fontWeight: 600, letterSpacing: 0.16, lineHeight: 1.2, font: '--ppt-label-font', color: 'var(--ppt-accent, var(--SmartThemeQuoteColor))' },
    body: { fontSize: 14, fontWeight: 400, letterSpacing: 0, lineHeight: 1.35, font: '--ppt-value-font', color: TEXT_COLOR },
    caption: { fontSize: 11, fontWeight: 400, letterSpacing: 0.02, lineHeight: 1.3, font: '--ppt-value-font', color: `color-mix(in srgb, ${TEXT_COLOR} 70%, transparent)` },
};

// The style layer a Theme Style puts under an element's own styling:
// { fontSize, fontWeight, letterSpacing, lineHeight } plus the CSS font
// family and colour (theme variables) - or null for none.
export function themeStyleLayer(id) {
    const look = THEME_STYLE_LOOKS[id];
    if (!look) return null;
    const { font, color, ...metrics } = look;
    return { ...metrics, fontFamilyCss: `var(${font}, inherit)`, textColorCss: color };
}

// Value formatting options per kind.
export const VALUE_FORMATS = {
    number: [
        ['', 'As stored'],
        ['commas', 'Comma separators'],
        ['fixed', 'Fixed decimals'],
        ['rounded', 'Rounded'],
        ['percent', 'Percent of max'],
        ['ofMax', 'Value / max'],
        ['duration', 'Duration (HH:mm:ss)'],
        ['durationHuman', 'Duration (human-readable)'],
        ['custom', 'Custom'],
    ],
    date: [
        ['', 'Automatic'],
        ['iso', 'YYYY-MM-DD'],
        ['long', 'Month DD, YYYY'],
        ['dayMonth', 'DD Month YYYY'],
        ['none', 'Hidden'],
        ['custom', 'Custom'],
    ],
    time: [
        ['', 'Automatic'],
        ['hms', 'HH:mm:ss'],
        ['hm', 'HH:mm'],
        ['12h', '12-hour clock'],
        ['none', 'Hidden'],
    ],
    boolean: [
        ['', 'true / false'],
        ['yesno', 'Yes / No'],
        ['onoff', 'On / Off'],
        ['check', '✓ / ✗'],
    ],
    list: [
        ['', 'Comma separated'],
        ['lines', 'One per line'],
        ['count', 'Item count'],
    ],
    image: [
        ['', 'Image'],
        ['url', 'Image URL'],
    ],
    imageList: [
        ['', 'First image'],
        ['count', 'Image count'],
    ],
};
export const DECIMAL_LIMITS = [0, 6];
// Number formats that use the Decimals setting.
export const DECIMAL_FORMATS = new Set(['commas', 'fixed', 'custom']);

export const DATETIME_PATTERN_HINT = 'Placeholders: {monthName} {month} {MM} {day} {DD} {year} {HH} {h} {hh} {mm} {ss} {ampm} {weekday} {weekday_short} {season} {era} {cycle}.';
export const NUMBER_PATTERN_HINT = 'Text with {value} where the number goes, e.g. "{value} gp" or "HP {value}".';

const DATE_PATTERNS = { iso: '{year}-{MM}-{DD}', long: '{monthName} {day}, {year}', dayMonth: '{day} {monthName} {year}' };
const TIME_PATTERNS = { hms: '{HH}:{mm}:{ss}', hm: '{HH}:{mm}', '12h': '{h}:{mm} {ampm}' };

function choice(raw, kind) {
    return typeof raw === 'string' && VALUE_FORMATS[kind].some(([id]) => id === raw) ? raw : '';
}

function patternText(raw) {
    return typeof raw === 'string' ? raw.slice(0, 200) : '';
}

// element.format, validated. Anything else - including the format strings
// and patterns elements had before this structure - becomes the defaults.
export function normalizeFormat(raw) {
    const format = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const value = format.value && typeof format.value === 'object' && !Array.isArray(format.value) ? format.value : {};
    const decimals = Number.isFinite(value.decimals) ? Math.min(DECIMAL_LIMITS[1], Math.max(DECIMAL_LIMITS[0], Math.round(value.decimals))) : 2;
    return {
        textCase: TEXT_CASES.some(([id]) => id && id === format.textCase) ? format.textCase : '',
        themeStyle: THEME_STYLES.some(([id]) => id && id === format.themeStyle) ? format.themeStyle : '',
        value: {
            number: choice(value.number, 'number'),
            decimals,
            numberPattern: patternText(value.numberPattern),
            date: choice(value.date, 'date'),
            time: choice(value.time, 'time'),
            datePattern: patternText(value.datePattern),
            boolean: choice(value.boolean, 'boolean'),
            list: choice(value.list, 'list'),
            image: choice(value.image, 'image'),
            imageList: choice(value.imageList, 'imageList'),
            characterPresence: value.characterPresence !== false,
            characterAliases: value.characterAliases === true,
        },
    };
}

let formatDateTime = null;

export function setDateTimeFormatter(formatter) {
    formatDateTime = typeof formatter === 'function' ? formatter : null;
}

// The value's kind, which decides its value formatting: 'number' |
// 'datetime' | 'boolean' | 'list' | 'image' | 'imageList' | 'imageMap' |
// 'character' (a character, or a list of characters - drawn as cards by
// character-card.js) | 'text'. `def.type` is a variable type, or a role type for a role element
// without a value yet (date, list, text). A calculated (or unknown, or
// 'any') one goes by the value it holds.
export function valueKind(def, value) {
    if (def?.type === 'character' || (def?.type === 'array' && def?.itemType === 'character')) return 'character';
    switch (def?.type) {
        case 'number': return 'number';
        case 'datetime':
        case 'date': return 'datetime';
        case 'boolean': return 'boolean';
        case 'array':
        case 'list': return 'list';
        case 'text': return 'text';
        case 'image': return 'image';
        case 'imageList': return 'imageList';
        case 'imageMap': return 'imageMap';
        case 'string':
        case 'enum': return 'text';
        default:
            if (Array.isArray(value)) return 'list';
            if (typeof value === 'number') return 'number';
            if (typeof value === 'boolean') return 'boolean';
            return 'text';
    }
}

export function applyTextCase(text, textCase) {
    if (typeof text !== 'string' || !text) return text ?? '';
    if (textCase === 'upper') return text.toUpperCase();
    if (textCase === 'lower') return text.toLowerCase();
    if (textCase === 'capitalize') return text.replace(/\p{L}[\p{L}\p{M}'’]*/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
    return text;
}

function plain(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

function fixed(n, decimals) {
    return n.toFixed(decimals);
}

function commas(n, decimals) {
    return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Seconds -> "HH:mm:ss" (hours not capped at 24), or "1d 2h 5m" style.
function duration(seconds, human) {
    const total = Math.round(Math.abs(seconds));
    const sign = seconds < 0 ? '-' : '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (!human) return `${sign}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    const d = Math.floor(h / 24);
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h % 24) parts.push(`${h % 24}h`);
    if (m) parts.push(`${m}m`);
    if (s || parts.length === 0) parts.push(`${s}s`);
    return sign + parts.join(' ');
}

// The theme's number format ids (theme.formatting.number), used when an
// element leaves its number format at "As stored".
export const THEME_NUMBER_FORMATS = [
    ['', 'As stored'],
    ['rounded', 'Rounded'],
    ['fixed1', '1 decimal place'],
    ['fixed2', '2 decimal places'],
    ['commas', 'Comma separators'],
];

function formatNumber(n, def, options, formatting) {
    let kind = options.number;
    let decimals = options.decimals;
    if (!kind) {
        // The theme's default number look.
        if (formatting?.number === 'rounded') kind = 'rounded';
        else if (formatting?.number === 'fixed1') { kind = 'fixed'; decimals = 1; }
        else if (formatting?.number === 'fixed2') { kind = 'fixed'; decimals = 2; }
        else if (formatting?.number === 'commas') { kind = 'commas'; decimals = 0; }
    }
    const min = Number.isFinite(def?.min) ? def.min : 0;
    const max = Number.isFinite(def?.max) ? def.max : null;
    switch (kind) {
        case 'commas': return commas(n, decimals);
        case 'fixed': return fixed(n, decimals);
        case 'rounded': return String(Math.round(n));
        case 'percent': return max !== null && max !== min ? `${Math.round(((n - min) / (max - min)) * 100)}%` : String(n);
        case 'ofMax': return max !== null ? `${n} / ${max}` : String(n);
        case 'duration': return duration(n, false);
        case 'durationHuman': return duration(n, true);
        case 'custom': {
            const pattern = options.numberPattern.includes('{value}') ? options.numberPattern : '{value}';
            return pattern.split('{value}').join(fixed(n, decimals));
        }
        default: return String(n);
    }
}

// Theme formatting key for an automatic datetime, by what is shown.
const THEME_DATETIME_KEYS = { full: 'dateFull', date: 'dateShort', time: 'time' };
const AUTO_STYLES = { full: 'full', date: 'date', time: 'time' };

// What an automatic datetime shows, by the variable's datetimeMode.
function datetimeShown(def) {
    return def?.datetimeMode === 'dateOnly' ? 'date' : def?.datetimeMode === 'timeOnly' ? 'time' : 'full';
}

function formatDatetime(value, def, options, formatting) {
    const calendar = def?.calendar || 'gregorian';
    const scalar = Number(value);
    const run = (opts) => formatDateTime(calendar, scalar, opts);
    if (options.date === 'custom') {
        const pattern = options.datePattern.trim();
        return pattern ? run({ style: 'custom', pattern }) : run({ style: 'full' });
    }
    const shown = datetimeShown(def);
    // Each part: an explicit choice, else automatic (shown by datetimeMode).
    const date = options.date || (shown === 'time' ? 'none' : 'auto');
    const time = options.time || (shown === 'date' ? 'none' : 'auto');
    if (date === 'auto' && time === 'auto') return autoDatetime(run, 'full', formatting);
    if (date === 'none' && time === 'auto') return autoDatetime(run, 'time', formatting);
    if (date === 'auto' && time === 'none') return autoDatetime(run, 'date', formatting);
    const parts = [];
    if (date === 'auto') parts.push(autoDatetime(run, 'date', formatting));
    else if (DATE_PATTERNS[date]) parts.push(run({ style: 'custom', pattern: DATE_PATTERNS[date] }));
    if (time === 'auto') parts.push(autoDatetime(run, 'time', formatting));
    else if (TIME_PATTERNS[time]) parts.push(run({ style: 'custom', pattern: TIME_PATTERNS[time] }));
    return parts.join(' ');
}

// The calendar's own (or the theme's) pattern for a full / date / time display.
function autoDatetime(run, shown, formatting) {
    const themed = typeof formatting?.[THEME_DATETIME_KEYS[shown]] === 'string' ? formatting[THEME_DATETIME_KEYS[shown]].trim() : '';
    return run(themed ? { style: 'custom', pattern: themed } : { style: AUTO_STYLES[shown] });
}

// Value formatting by kind. { text } or { image: url }. Never throws - a
// value that can't be formatted as asked falls back to its plain text.
function formatValuePart(value, def, options, formatting) {
    const kind = valueKind(def, value);
    try {
        switch (kind) {
            case 'number': {
                const n = Number(value);
                return { text: Number.isFinite(n) ? formatNumber(n, def, options, formatting) : plain(value) };
            }
            case 'boolean': {
                const on = value === true || value === 'true';
                if (options.boolean === 'yesno') return { text: on ? 'Yes' : 'No' };
                if (options.boolean === 'onoff') return { text: on ? 'On' : 'Off' };
                if (options.boolean === 'check') return { text: on ? '✓' : '✗' };
                return { text: String(on) };
            }
            case 'list': {
                const items = Array.isArray(value) ? value.map(plain) : [plain(value)];
                if (options.list === 'count') return { text: String(items.length) };
                if (options.list === 'lines') return { text: items.join('\n') };
                return { text: items.join(', ') };
            }
            case 'datetime':
                return { text: formatDateTime && Number.isFinite(Number(value)) ? formatDatetime(value, def, options, formatting) : plain(value) };
            case 'image': {
                const url = typeof value === 'string' ? value : '';
                return options.image === 'url' || !url ? { text: url } : { image: url };
            }
            case 'imageList': {
                const list = Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v) : [];
                return options.imageList === 'count' || list.length === 0 ? { text: String(list.length) } : { image: list[0] };
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

// THE pipeline: a value as displayed - value formatting for its kind, then
// text case. `format` is element.format (normalized here, so anything works);
// `formatting` is the panel theme's formatting. { text } or { image: url }.
export function formatText(value, def, format, formatting = null) {
    const { textCase, value: options } = normalizeFormat(format);
    const out = formatValuePart(value, def, options, formatting);
    return out.image !== undefined ? out : { text: applyTextCase(out.text, textCase) };
}

// Free text (or a label) through the same pipeline: text case only - there
// is no value to format.
export function formatPlainText(text, format) {
    return applyTextCase(typeof text === 'string' ? text : '', normalizeFormat(format).textCase);
}
