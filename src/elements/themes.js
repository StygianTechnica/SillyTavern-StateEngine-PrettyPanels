// Themes: named bundles of default styling that elements pick by id and
// may override field by field. Only the `clock` section exists so far -
// the defaults an analogClock element (src/elements/clock.js) uses for
// every Clock Property it leaves unset:
//
//   theme.clock.backdropImage     clock face image URL
//   theme.clock.hourHandImage     hand image URLs (drawn pointing up, pivot
//   theme.clock.minuteHandImage   at the bottom minus the hand's offset)
//   theme.clock.secondHandImage
//   theme.clock.style             drawn face: 'classic' | 'minimal' | 'none'
//   theme.clock.numerals          'arabic' | 'roman' | 'none'
//   theme.clock.tickMarks         'all' (hours and minutes) | 'hours' | 'none'
//
// Every field is optional; a missing one falls back to CLOCK_FALLBACK.
// Other extensions (or later versions) can add themes with registerTheme().

export const DEFAULT_THEME_ID = 'classic';

export const CLOCK_FALLBACK = Object.freeze({ style: 'classic', numerals: 'arabic', tickMarks: 'all' });

const themes = new Map([
    ['classic', { label: 'Classic', clock: { style: 'classic', numerals: 'arabic', tickMarks: 'all' } }],
    ['roman', { label: 'Roman', clock: { style: 'classic', numerals: 'roman', tickMarks: 'hours' } }],
    ['minimal', { label: 'Minimal', clock: { style: 'minimal', numerals: 'none', tickMarks: 'hours' } }],
    ['backdrop', { label: 'Backdrop only', clock: { style: 'none', numerals: 'none', tickMarks: 'none' } }],
]);

const listeners = new Set();

// Adds (or replaces) a theme. `theme` is { label?, clock? }.
export function registerTheme(id, theme) {
    if (typeof id !== 'string' || !id.trim() || !theme || typeof theme !== 'object') return false;
    themes.set(id.trim(), { label: typeof theme.label === 'string' && theme.label ? theme.label : id.trim(), clock: { ...(theme.clock ?? {}) } });
    for (const listener of listeners) listener();
    return true;
}

export function onThemesChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// [[id, label], ...] for a theme dropdown.
export function listThemes() {
    return [...themes].map(([id, theme]) => [id, theme.label]);
}

// The theme `id` names, else the default one.
export function getTheme(id) {
    return themes.get(id) ?? themes.get(DEFAULT_THEME_ID);
}
