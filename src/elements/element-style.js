// Element Styling: the visual properties stored in a text or free-text
// element's `style` object (saved with the layout, carried by templates).
// Every property is optional - unset keeps the default look.
//
//   fontFamily   a font id from the FontRegistry (src/fonts/font-registry.js):
//                'inherit' | 'sans' | 'serif' | 'mono' | 'display' (system),
//                a curated id ('inter', 'saira', ...) or an uploaded font
//                ('user-...')
//   fontWeight   100-1000, or a legacy name 'normal' | 'medium' | 'bold' |
//                'extrabold'
//   fontStyle    'normal' | 'italic'
//   fontAxes     { [axisTag]: number } other variable-font axes
//                (wdth, MONO, CASL, ...), drawn with font-variation-settings
//   labelFontFamily  font id for the label only (text elements); unset =
//                the same font as the value
//   fontSize     px, 8-96
//   letterSpacing em, -0.1 to 0.5
//   lineHeight   0.8 to 3 (multiples of the font size)
//   textTransform 'none' | 'uppercase' | 'lowercase' | 'capitalize'
//   textDecoration 'none' | 'underline' | 'overline' | 'line-through'
//   textShadow   'none' | 'soft' | 'hard' | 'glow' | 'outline'
//   shadowColor  CSS color for textShadow
//   textColor    CSS color of the value text
//   labelColor   CSS color of the label text
//   align        'left' | 'center' | 'right' (unset: label left, value right)
//   icon         Font Awesome icon name ("heart", "shield", "bolt"),
//                shown left of the value
//   iconColor    CSS color
//   iconSize     px, 8-72
//   backgroundColor    CSS color behind the whole element, so text stays
//                      readable over a panel's background image
//   backgroundOpacity  %, 0-100 (default 100)
//   backgroundRadius   px, 0-100 corner rounding of that background
//   condition    { threshold, color }: when the value is a number below
//                threshold, the value text takes `color`
//
// Icons use Font Awesome (solid style), which SillyTavern already loads.

import { isColor } from '../panels/panel-style.js';
import { fontRegistry } from '../fonts/font-registry.js';
import { fontVariationCss } from '../fonts/font-preview.js';

export const FONT_SIZE_LIMITS = [8, 96];
export const ICON_SIZE_LIMITS = [8, 72];
export const BACKGROUND_OPACITY_LIMITS = [0, 100];
export const BACKGROUND_RADIUS_LIMITS = [0, 100];
export const LETTER_SPACING_LIMITS = [-0.1, 0.5];
export const LINE_HEIGHT_LIMITS = [0.8, 3];

// Legacy named weights (still accepted in stored styles).
export const FONT_WEIGHTS = [
    ['normal', 'Normal', 400],
    ['medium', 'Medium', 500],
    ['bold', 'Bold', 700],
    ['extrabold', 'Extra Bold', 800],
];

export const ALIGNMENTS = [
    ['left', 'Left'],
    ['center', 'Center'],
    ['right', 'Right'],
];

export const TEXT_TRANSFORMS = [
    ['', 'As typed'],
    ['uppercase', 'UPPERCASE'],
    ['lowercase', 'lowercase'],
    ['capitalize', 'Capitalize Words'],
];

export const TEXT_DECORATIONS = [
    ['', 'None'],
    ['underline', 'Underline'],
    ['overline', 'Overline'],
    ['line-through', 'Strikethrough'],
];

export const TEXT_SHADOWS = [
    ['', 'None'],
    ['soft', 'Soft shadow'],
    ['hard', 'Hard shadow'],
    ['glow', 'Glow'],
    ['outline', 'Outline'],
];

// One-click formatting for free-text elements: each sets these style
// fields (null clears one). Nothing about the preset itself is stored.
export const TEXT_PRESETS = [
    ['title', 'Title', { fontSize: 26, fontWeight: 700, letterSpacing: 0.01, textTransform: null, lineHeight: 1.1 }],
    ['subtitle', 'Subtitle', { fontSize: 18, fontWeight: 600, letterSpacing: null, textTransform: null, lineHeight: 1.2 }],
    ['heading', 'Section heading', { fontSize: 13, fontWeight: 700, letterSpacing: 0.12, textTransform: 'uppercase', lineHeight: null }],
    ['hud', 'HUD label', { fontSize: 12, fontWeight: 600, letterSpacing: 0.16, textTransform: 'uppercase', lineHeight: null }],
    ['body', 'Body text', { fontSize: 14, fontWeight: 400, letterSpacing: null, textTransform: null, lineHeight: 1.35 }],
    ['caption', 'Caption', { fontSize: 11, fontWeight: 400, letterSpacing: 0.02, textTransform: null, lineHeight: 1.3 }],
];

// Offered in the icon field's suggestion list - any Font Awesome solid
// icon name works.
export const ICON_SUGGESTIONS = [
    'heart', 'shield', 'shield-halved', 'bolt', 'star', 'coins', 'gem', 'clock', 'sun', 'moon',
    'location-dot', 'map', 'compass', 'user', 'users', 'skull', 'fire', 'droplet', 'leaf',
    'flask', 'wand-magic-sparkles', 'khanda', 'hand-fist', 'brain', 'eye', 'face-smile',
    'face-angry', 'battery-half', 'box', 'scroll', 'book', 'key', 'lock', 'flag', 'bell',
];

function clampNumber(value, [min, max]) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : null;
}

function clampFloat(value, [min, max]) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
}

// A stored weight (number or legacy name) as a number, or null.
export function numericWeight(weight) {
    if (Number.isFinite(weight)) return Math.min(1000, Math.max(1, Math.round(weight)));
    return FONT_WEIGHTS.find(([id]) => id === weight)?.[2] ?? null;
}

function shadowCss(kind, color) {
    const c = isColor(color) ? color : (kind === 'glow' ? 'var(--SmartThemeQuoteColor)' : 'rgba(0, 0, 0, 0.85)');
    switch (kind) {
        case 'soft': return `0 1px 3px ${c}`;
        case 'hard': return `2px 2px 0 ${c}`;
        case 'glow': return `0 0 4px ${c}, 0 0 10px ${c}`;
        case 'outline': return `-1px -1px 0 ${c}, 1px -1px 0 ${c}, -1px 1px 0 ${c}, 1px 1px 0 ${c}`;
        default: return null;
    }
}

// Font Awesome icon class for a user-typed name ("heart", "fa-heart",
// "Heart"), or null if it isn't a plausible icon name.
export function iconClass(name) {
    const clean = typeof name === 'string' ? name.trim().toLowerCase().replace(/^fa-/, '') : '';
    return /^[a-z0-9][a-z0-9-]*$/.test(clean) ? `fa-solid fa-${clean}` : null;
}

// Applies an element's style to a rendered element (container holding
// .pp-element-label / .pp-element-icon / .pp-element-value). `value` is
// the current variable value, for the conditional colour.
export function applyElementStyle(container, style = {}, value = undefined) {
    const set = (prop, v) => (v === null || v === undefined ? container.style.removeProperty(prop) : container.style.setProperty(prop, v));

    const fontSize = clampNumber(style.fontSize, FONT_SIZE_LIMITS);
    set('--pp-el-font-size', fontSize === null ? null : `${fontSize}px`);
    const font = fontVariationCss({ fontWeight: numericWeight(style.fontWeight), fontStyle: style.fontStyle, fontAxes: style.fontAxes });
    set('--pp-el-font-weight', font.fontWeight);
    set('--pp-el-font-style', font.fontStyle);
    set('--pp-el-font-variation', font.fontVariationSettings);
    const family = typeof style.fontFamily === 'string' && style.fontFamily !== 'inherit' ? fontRegistry.cssFamily(style.fontFamily) : null;
    set('--pp-el-font-family', family === 'inherit' ? null : family);
    const labelFamily = typeof style.labelFontFamily === 'string' && style.labelFontFamily ? fontRegistry.cssFamily(style.labelFontFamily) : null;
    set('--pp-el-label-font-family', labelFamily);
    set('--pp-el-label-color', isColor(style.labelColor) ? style.labelColor : null);

    const spacing = clampFloat(style.letterSpacing, LETTER_SPACING_LIMITS);
    set('--pp-el-letter-spacing', spacing === null ? null : `${spacing}em`);
    const lineHeight = clampFloat(style.lineHeight, LINE_HEIGHT_LIMITS);
    set('--pp-el-line-height', lineHeight === null ? null : String(lineHeight));
    set('--pp-el-transform', TEXT_TRANSFORMS.some(([id]) => id && id === style.textTransform) ? style.textTransform : null);
    set('--pp-el-decoration', TEXT_DECORATIONS.some(([id]) => id && id === style.textDecoration) ? style.textDecoration : null);
    set('--pp-el-shadow', shadowCss(style.textShadow, style.shadowColor));

    const bgOpacity = clampNumber(style.backgroundOpacity, BACKGROUND_OPACITY_LIMITS) ?? 100;
    set('--pp-el-bg', isColor(style.backgroundColor) ? `color-mix(in srgb, ${style.backgroundColor} ${bgOpacity}%, transparent)` : null);
    const bgRadius = clampNumber(style.backgroundRadius, BACKGROUND_RADIUS_LIMITS);
    set('--pp-el-radius', bgRadius === null ? null : `${bgRadius}px`);

    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    const condition = style.condition;
    const conditionMet = condition && Number.isFinite(condition.threshold) && isColor(condition.color)
        && Number.isFinite(n) && n < condition.threshold;
    const textColor = conditionMet ? condition.color : (isColor(style.textColor) ? style.textColor : null);
    set('--pp-el-text-color', textColor);
    container.classList.toggle('pp-element-condition-met', !!conditionMet);

    for (const [id] of ALIGNMENTS) container.classList.toggle(`pp-align-${id}`, style.align === id);

    const icon = container.querySelector('.pp-element-icon');
    const cls = iconClass(style.icon);
    icon.hidden = !cls;
    icon.className = `pp-element-icon ${cls ?? ''}`.trim();
    const iconSize = clampNumber(style.iconSize, ICON_SIZE_LIMITS);
    set('--pp-el-icon-size', iconSize === null ? null : `${iconSize}px`);
    set('--pp-el-icon-color', isColor(style.iconColor) ? style.iconColor : null);
}
