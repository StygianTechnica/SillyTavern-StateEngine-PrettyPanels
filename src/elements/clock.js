// Analog clock elements (type 'analogClock'): the time of a bound
// datetime variable drawn as a clock face with hour, minute and second
// hands. Works for any calendar - the hands are placed from State
// Engine's time primitives (getDateTimeParts: time.hour/minute/second and
// the calendar's hoursPerDay/minutesPerHour/secondsPerMinute), so a
// 30-hour day with 100-minute hours gets a dial to match. The hour hand
// goes round once per calendar DAY:
//
//   hourAngle   = 360 * hour / hoursPerDay + 360 * minute / (hoursPerDay * minutesPerHour)
//   minuteAngle = 360 * minute / minutesPerHour
//   secondAngle = 360 * second / secondsPerMinute
//
// Clock Properties live in element.clock (saved with the layout); every
// one is optional. Unset ones come from the element's theme
// (src/elements/themes.js), then CLOCK_DEFAULTS:
//
//   themeStyle                    theme id (blank: the default theme)
//   style, numerals, tickMarks    override the theme's drawn face
//   backdropImage                 face image: a URL string, or
//   hourHandImage                 { variable: '<image variable name>' }
//   minuteHandImage               (the image that variable is showing).
//   secondHandImage               A hand image is drawn pointing UP.
//   radius                        px (blank: fits the element)
//   centerX, centerY              px from the element's top-left (blank: middle)
//   hourHandLength ...            % of the radius from the centre to the tip
//   hourHandOffset ...            % of the radius the hand extends BEHIND
//                                 the centre (its tail / the image's pivot)
//
// element.opacity and element.zIndex apply as for any element. Hands
// rotate with CSS transforms about the clock's centre.

import { getTheme, CLOCK_FALLBACK } from './themes.js';
import { getImage } from '../chat/variable-service.js';

export const ELEMENT_TYPE_ANALOG_CLOCK = 'analogClock';

export const CLOCK_HANDS = ['hour', 'minute', 'second'];
export const CLOCK_IMAGE_KEYS = ['backdropImage', 'hourHandImage', 'minuteHandImage', 'secondHandImage'];

export const CLOCK_STYLES = [['classic', 'Classic face'], ['minimal', 'Minimal ring'], ['none', 'None (backdrop only)']];
export const CLOCK_NUMERALS = [['arabic', 'Numbers'], ['roman', 'Roman numerals'], ['none', 'None']];
export const CLOCK_TICKS = [['all', 'Hours and minutes'], ['hours', 'Hours only'], ['none', 'None']];

export const CLOCK_LIMITS = {
    radius: [2, 2000],
    centerX: [0, 4000],
    centerY: [0, 4000],
    hourHandLength: [0, 150],
    minuteHandLength: [0, 150],
    secondHandLength: [0, 150],
    hourHandOffset: [0, 100],
    minuteHandOffset: [0, 100],
    secondHandOffset: [0, 100],
};

export const CLOCK_DEFAULTS = {
    hourHandLength: 50,
    minuteHandLength: 75,
    secondHandLength: 88,
    hourHandOffset: 12,
    minuteHandOffset: 14,
    secondHandOffset: 20,
};

// Drawn (imageless) hand thickness, as a fraction of the radius.
const HAND_WIDTH = { hour: 0.07, minute: 0.045, second: 0.018 };

let readParts = null;

// Installed at startup (src/extension.js): (calendarId, scalar) => parts.
export function setDateTimePartsReader(reader) {
    readParts = typeof reader === 'function' ? reader : null;
}

// ---- Pure helpers (no DOM) ------------------------------------------------

// Hand angles in degrees clockwise from 12 o'clock (see header).
export function clockAngles(time, calendar) {
    const { hoursPerDay, minutesPerHour, secondsPerMinute } = calendar;
    return {
        hour: 360 * (time.hour / hoursPerDay) + 360 * (time.minute / (hoursPerDay * minutesPerHour)),
        minute: 360 * (time.minute / minutesPerHour),
        second: 360 * (time.second / secondsPerMinute),
    };
}

// A stored image value -> { url } | { variable } | null.
export function clockImageSource(value) {
    if (typeof value === 'string') return value.trim() ? { url: value.trim() } : null;
    if (value && typeof value === 'object' && typeof value.variable === 'string' && value.variable) return { variable: value.variable };
    return null;
}

// The image variables an element's Clock Properties use.
export function clockImageVariables(element) {
    if (element?.type !== ELEMENT_TYPE_ANALOG_CLOCK) return [];
    return CLOCK_IMAGE_KEYS.map((key) => clockImageSource(element.clock?.[key])?.variable).filter(Boolean);
}

function limited(value, key) {
    const [min, max] = CLOCK_LIMITS[key];
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

// The Clock Properties actually in effect: the element's own, else its
// theme's, else the defaults. Images stay as sources ({ url } / { variable }).
export function effectiveClock(clock = {}) {
    const theme = getTheme(clock.themeStyle).clock ?? {};
    const pick = (key, allowed) => {
        const valid = (v) => allowed.some(([id]) => id === v);
        if (valid(clock[key])) return clock[key];
        return valid(theme[key]) ? theme[key] : CLOCK_FALLBACK[key];
    };
    const out = {
        style: pick('style', CLOCK_STYLES),
        numerals: pick('numerals', CLOCK_NUMERALS),
        tickMarks: pick('tickMarks', CLOCK_TICKS),
    };
    for (const key of CLOCK_IMAGE_KEYS) out[key] = clockImageSource(clock[key]) ?? clockImageSource(theme[key]);
    for (const key of Object.keys(CLOCK_DEFAULTS)) out[key] = limited(clock[key], key) ?? CLOCK_DEFAULTS[key];
    return out;
}

// Centre and radius inside a width x height box: the stored values, else
// the middle and the largest circle that fits around that centre.
export function clockGeometry(clock = {}, width, height) {
    const cx = limited(clock.centerX, 'centerX') ?? width / 2;
    const cy = limited(clock.centerY, 'centerY') ?? height / 2;
    const auto = Math.max(2, Math.min(cx, cy, width - cx, height - cy) - 1);
    return { cx, cy, r: limited(clock.radius, 'radius') ?? auto };
}

const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];

export function toRoman(n) {
    let out = '';
    let rest = n;
    for (const [value, letters] of ROMAN) {
        while (rest >= value) {
            out += letters;
            rest -= value;
        }
    }
    return out;
}

// ---- DOM ------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
}

function build(holder) {
    holder.replaceChildren();
    holder.dataset.type = ELEMENT_TYPE_ANALOG_CLOCK;
    delete holder.dataset.faceKey;
    const backdrop = document.createElement('img');
    backdrop.className = 'pp-clock-backdrop';
    backdrop.alt = '';
    backdrop.draggable = false;
    const face = svg('svg', { class: 'pp-clock-face' });
    holder.append(backdrop, face);
    for (const hand of CLOCK_HANDS) {
        const el = document.createElement('div');
        el.className = `pp-clock-hand pp-clock-hand-${hand}`;
        el.innerHTML = '<img alt="" draggable="false" />';
        holder.appendChild(el);
    }
    const cap = document.createElement('div');
    cap.className = 'pp-clock-cap';
    holder.appendChild(cap);
}

// A display-safe image URL for a source, or null.
function resolveImage(source) {
    if (!source) return null;
    if (source.url) return source.url;
    return getImage(source.variable) || null;
}

// Redraws the face (rim, ticks, numerals) - only when something it
// depends on changed, since a 24-hour dial with minute ticks is a few
// hundred nodes.
function drawFace(face, width, height, geo, eff, calendar) {
    const key = [width, height, geo.cx, geo.cy, geo.r, eff.style, eff.numerals, eff.tickMarks, calendar.hoursPerDay, calendar.minutesPerHour].join('|');
    if (face.dataset.faceKey === key) return;
    face.dataset.faceKey = key;
    face.replaceChildren();
    face.setAttribute('viewBox', `0 0 ${width} ${height}`);
    face.setAttribute('width', String(width));
    face.setAttribute('height', String(height));

    const { cx, cy, r } = geo;
    const rim = Math.max(1, r * 0.04);
    if (eff.style === 'classic') {
        face.appendChild(svg('circle', { class: 'pp-clock-dial', cx, cy, r: r - rim / 2, 'stroke-width': rim }));
    } else if (eff.style === 'minimal') {
        face.appendChild(svg('circle', { class: 'pp-clock-dial pp-clock-dial-minimal', cx, cy, r: r - 0.5, 'stroke-width': 1 }));
    }

    const point = (deg, dist) => {
        const a = (deg * Math.PI) / 180;
        return [cx + Math.sin(a) * dist, cy - Math.cos(a) * dist];
    };
    const tick = (deg, length, strokeWidth, cls) => {
        const [x1, y1] = point(deg, r - rim - length);
        const [x2, y2] = point(deg, r - rim);
        face.appendChild(svg('line', { class: cls, x1, y1, x2, y2, 'stroke-width': strokeWidth }));
    };
    const hours = calendar.hoursPerDay;
    if (eff.tickMarks === 'all' && calendar.minutesPerHour <= 240) {
        for (let m = 0; m < calendar.minutesPerHour; m++) tick((360 * m) / calendar.minutesPerHour, r * 0.05, Math.max(0.5, r * 0.012), 'pp-clock-tick pp-clock-tick-minor');
    }
    if (eff.tickMarks !== 'none' && hours <= 240) {
        for (let h = 0; h < hours; h++) tick((360 * h) / hours, r * 0.1, Math.max(1, r * 0.03), 'pp-clock-tick');
    }

    if (eff.numerals !== 'none') {
        const size = Math.max(6, r * (hours > 12 ? 0.12 : 0.16));
        const dist = r - rim - (eff.tickMarks === 'none' ? size * 0.9 : r * 0.1 + size * 0.9);
        // Fewer labels than hours when they would crowd the ring.
        const room = Math.max(4, Math.floor((2 * Math.PI * dist) / (size * (eff.numerals === 'roman' ? 2.6 : 1.8))));
        const step = Math.max(1, Math.ceil(hours / room));
        for (let h = 0; h < hours; h += step) {
            const n = h === 0 ? hours : h;
            const [x, y] = point((360 * h) / hours, dist);
            const text = svg('text', { class: 'pp-clock-numeral', x, y, 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
            text.textContent = eff.numerals === 'roman' ? toRoman(n) : String(n);
            face.appendChild(text);
        }
    }
}

// Places one hand: its box runs from `length` above the centre to
// `offset` below it, and rotates about the centre.
function placeHand(el, hand, angle, geo, eff) {
    const length = (geo.r * eff[`${hand}HandLength`]) / 100;
    const offset = (geo.r * eff[`${hand}HandOffset`]) / 100;
    el.hidden = length <= 0;
    if (el.hidden) return;
    const url = resolveImage(eff[`${hand}HandImage`]);
    const img = el.querySelector('img');
    el.classList.toggle('pp-clock-hand-image', !!url);
    if (url) {
        if (img.getAttribute('src') !== url) img.src = url;
        el.style.width = '';
    } else {
        img.removeAttribute('src');
        el.style.width = `${Math.max(1, geo.r * HAND_WIDTH[hand])}px`;
    }
    Object.assign(el.style, {
        left: `${geo.cx}px`,
        top: `${geo.cy - length}px`,
        height: `${length + offset}px`,
        transformOrigin: `50% ${length}px`,
        transform: `translateX(-50%) rotate(${angle}deg)`,
    });
}

// The moment to show: { time, calendar } from the bound datetime value,
// or null when there is none (the hands then rest at 12).
function momentOf(entry) {
    if (!readParts || entry === undefined || entry === null) return null;
    const scalar = Number(entry.value);
    if (entry.value === null || entry.value === '' || !Number.isFinite(scalar)) return null;
    try {
        const parts = readParts(entry.def?.calendar || 'gregorian', scalar);
        return parts?.time && parts?.calendar ? parts : null;
    } catch {
        return null;
    }
}

const FALLBACK_CALENDAR = { hoursPerDay: 12, minutesPerHour: 60, secondsPerMinute: 60 };

// Draws (or updates) an analog clock element inside `holder` (.pp-widget).
export function renderClock(holder, element, entry) {
    if (holder.dataset.type !== ELEMENT_TYPE_ANALOG_CLOCK) build(holder);
    const clock = element.clock ?? {};
    const eff = effectiveClock(clock);
    // The element's content box: its 1px (transparent) border inset.
    const width = Math.max(1, element.width - 2);
    const height = Math.max(1, element.height - 2);
    const geo = clockGeometry(clock, width, height);
    const moment = momentOf(entry);
    const calendar = moment?.calendar ?? FALLBACK_CALENDAR;

    // The element's opacity, dimmed further (like other widgets) when there
    // is no time to show - set inline, so it has to include the dimming.
    const opacity = Number.isFinite(element.opacity) ? Math.min(1, Math.max(0, element.opacity)) : 1;
    holder.style.opacity = String(moment ? opacity : opacity * 0.45);

    const backdrop = holder.querySelector('.pp-clock-backdrop');
    const backdropUrl = resolveImage(eff.backdropImage);
    backdrop.hidden = !backdropUrl;
    if (backdropUrl) {
        if (backdrop.getAttribute('src') !== backdropUrl) backdrop.src = backdropUrl;
        Object.assign(backdrop.style, {
            left: `${geo.cx - geo.r}px`, top: `${geo.cy - geo.r}px`, width: `${2 * geo.r}px`, height: `${2 * geo.r}px`,
        });
    }

    drawFace(holder.querySelector('.pp-clock-face'), width, height, geo, eff, calendar);

    const angles = moment ? clockAngles(moment.time, calendar) : { hour: 0, minute: 0, second: 0 };
    for (const hand of CLOCK_HANDS) placeHand(holder.querySelector(`.pp-clock-hand-${hand}`), hand, angles[hand], geo, eff);

    const cap = holder.querySelector('.pp-clock-cap');
    const capSize = Math.max(3, geo.r * 0.09);
    cap.hidden = eff.style === 'none';
    Object.assign(cap.style, { left: `${geo.cx}px`, top: `${geo.cy}px`, width: `${capSize}px`, height: `${capSize}px` });

    if (moment) {
        const { hour, minute, second } = moment.time;
        const pad = (n) => String(n).padStart(2, '0');
        holder.title = `${pad(hour)}:${pad(minute)}:${pad(second)}${moment.weekdayName ? ` · ${moment.weekdayName}` : ''}`;
    } else {
        holder.removeAttribute('title');
    }
}
