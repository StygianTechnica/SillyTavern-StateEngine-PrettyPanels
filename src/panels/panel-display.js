// Conditional panels and banners (docs/PLAN - FLAGS, DRAWERS, BANNERS,
// ATMOSPHERE.md, phase 3). A layout panel's DISPLAY decides when it is on
// screen:
//
//   always   (no display record) - as every panel always was
//   while    shown while a flag is on (invert: while it is off), animating in
//            and out as the flag changes
//   timed    a banner: hidden until its trigger fires - the flag turning on
//            (or off, with invert), or the variable changing - then animates
//            in, holds for holdSeconds and animates out, even if the flag
//            stays on. Banners that fire together play one after another,
//            and one fires at most once per minGapSeconds.
//
// The flag / variable is a State Engine ref (a variable name or role:...);
// Pretty Panels never evaluates conditions (src/chat/flag-watch.js reports
// the changes, a chat load never counts as one). fullWidth stretches a
// floating panel across the window at its y position - the cinematic band.
//
// In Editing Mode a conditional panel is hidden unless PINNED for editing
// (the drawer's Layout Panels list) - a full-screen banner is edited on its
// own instead of covering the layout. Pins are per session, never saved.
//
// This module is plain logic (no DOM): the record, the play queue, pins.

export const DISPLAY_MODES = [
    ['always', 'Always'],
    ['while', 'While a flag is on'],
    ['timed', 'Banner (timed, when triggered)'],
];

export const DISPLAY_TRIGGERS = [
    ['flag', 'When the flag turns on'],
    ['change', 'When the variable changes'],
];

export const DISPLAY_ANIMATIONS = [
    ['none', 'None'],
    ['fade', 'Fade'],
    ['slide-top', 'Slide from the top'],
    ['slide-bottom', 'Slide from the bottom'],
    ['slide-left', 'Slide from the left'],
    ['slide-right', 'Slide from the right'],
    ['zoom', 'Zoom'],
];

export const DISPLAY_LIMITS = {
    holdSeconds: [0.5, 60],
    durationMs: [0, 5000],
    minGapSeconds: [0, 3600],
};

export const DISPLAY_DEFAULTS = {
    trigger: 'flag',
    invert: false,
    holdSeconds: 4,
    animIn: 'fade',
    animOut: 'fade',
    durationMs: 600,
    minGapSeconds: 10,
    fullWidth: false,
};

function limited(value, key) {
    const [min, max] = DISPLAY_LIMITS[key];
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : DISPLAY_DEFAULTS[key];
}

function oneOf(list, value, fallback) {
    return list.some(([id]) => id === value) ? value : fallback;
}

// A stored display, or null for "always". A conditional mode without a ref
// is kept (the author is still choosing one) - it just never shows outside
// Editing Mode until it has one.
export function normalizeDisplay(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const mode = oneOf(DISPLAY_MODES, raw.mode, 'always');
    if (mode === 'always') return raw.fullWidth === true ? { mode, fullWidth: true } : null;
    return {
        mode,
        ref: typeof raw.ref === 'string' ? raw.ref.trim() : '',
        trigger: mode === 'timed' ? oneOf(DISPLAY_TRIGGERS, raw.trigger, DISPLAY_DEFAULTS.trigger) : 'flag',
        invert: raw.invert === true,
        holdSeconds: limited(raw.holdSeconds, 'holdSeconds'),
        animIn: oneOf(DISPLAY_ANIMATIONS, raw.animIn, DISPLAY_DEFAULTS.animIn),
        animOut: oneOf(DISPLAY_ANIMATIONS, raw.animOut, DISPLAY_DEFAULTS.animOut),
        durationMs: Math.round(limited(raw.durationMs, 'durationMs')),
        minGapSeconds: limited(raw.minGapSeconds, 'minGapSeconds'),
        fullWidth: raw.fullWidth === true,
    };
}

export function isConditional(display) {
    return !!display && display.mode !== 'always';
}

// A short description for lists: "Banner - when se__location changes".
export function describeDisplay(display) {
    if (!isConditional(display)) return display?.fullWidth ? 'Always (full width)' : 'Always';
    const ref = display.ref || '(no flag chosen)';
    if (display.mode === 'while') return `While ${ref} is ${display.invert ? 'off' : 'on'}`;
    if (display.trigger === 'change') return `Banner - when ${ref} changes`;
    return `Banner - when ${ref} turns ${display.invert ? 'off' : 'on'}`;
}

// ---- the banner queue ---------------------------------------------------------

// Plays banners one at a time. enqueue(id, play, minGapMs): play() returns a
// promise that settles when the banner has gone again. Dropped: an id
// already waiting or playing, and an id that STARTED playing less than
// minGapMs ago (a flickering flag). `now` is replaceable for tests.
export function createPlayQueue(now = () => Date.now()) {
    const waiting = [];
    const lastStart = new Map();
    let playing = null;

    async function next() {
        if (playing || waiting.length === 0) return;
        const item = waiting.shift();
        playing = item.id;
        lastStart.set(item.id, now());
        try {
            await item.play();
        } catch (err) {
            console.warn('[PrettyPanels] a banner failed to play (gracefully handled)', err);
        }
        playing = null;
        await next();
    }

    return {
        // Returns whether it was queued.
        enqueue(id, play, minGapMs = 0) {
            if (playing === id || waiting.some((item) => item.id === id)) return false;
            const last = lastStart.get(id);
            if (last !== undefined && now() - last < minGapMs) return false;
            waiting.push({ id, play });
            void next();
            return true;
        },
        // Drops everything waiting (the one playing finishes).
        clear() {
            waiting.length = 0;
        },
        isBusy() {
            return playing !== null || waiting.length > 0;
        },
    };
}

export const bannerQueue = createPlayQueue();

// ---- pinned for editing (per session) ---------------------------------------

const pinned = new Set();
const pinListeners = new Set();

export function isPinned(panelId) {
    return pinned.has(panelId);
}

export function setPinned(panelId, value) {
    if (value === pinned.has(panelId)) return;
    if (value) pinned.add(panelId);
    else pinned.delete(panelId);
    for (const listener of [...pinListeners]) listener(panelId, value);
}

export function onPinChange(listener) {
    pinListeners.add(listener);
    return () => pinListeners.delete(listener);
}
