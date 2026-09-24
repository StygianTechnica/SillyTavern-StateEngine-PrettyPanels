// Element Styling: the visual properties stored in a VariableElement's
// `style` object (saved with the layout, carried by templates). Every
// property is optional - unset keeps the default look.
//
//   fontSize     px, 8-72
//   fontWeight   'normal' | 'medium' | 'bold' | 'extrabold'
//   fontFamily   'inherit' | 'sans' | 'serif' | 'mono' | 'display'
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

export const FONT_SIZE_LIMITS = [8, 72];
export const ICON_SIZE_LIMITS = [8, 72];
export const BACKGROUND_OPACITY_LIMITS = [0, 100];
export const BACKGROUND_RADIUS_LIMITS = [0, 100];

export const FONT_WEIGHTS = [
    ['normal', 'Normal', '400'],
    ['medium', 'Medium', '500'],
    ['bold', 'Bold', '700'],
    ['extrabold', 'Extra Bold', '800'],
];

export const FONT_FAMILIES = [
    ['inherit', 'Default (inherit)', 'inherit'],
    ['sans', 'Sans Serif', 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'],
    ['serif', 'Serif', 'Georgia, Cambria, "Times New Roman", Times, serif'],
    ['mono', 'Mono', 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace'],
    ['display', 'Display', 'Impact, Haettenschweiler, "Arial Narrow Bold", "Franklin Gothic Bold", sans-serif'],
];

export const ALIGNMENTS = [
    ['left', 'Left'],
    ['center', 'Center'],
    ['right', 'Right'],
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
    set('--pp-el-font-weight', FONT_WEIGHTS.find(([id]) => id === style.fontWeight)?.[2] ?? null);
    const family = FONT_FAMILIES.find(([id]) => id === style.fontFamily);
    set('--pp-el-font-family', family && family[0] !== 'inherit' ? family[2] : null);
    set('--pp-el-label-color', isColor(style.labelColor) ? style.labelColor : null);

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
