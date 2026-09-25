// Theme schema: what a Pretty Panels theme holds, its field definitions
// (shared by the renderer and the Theme Editor), the built-in themes, and
// normalization. Plain data only - src/themes/theme-store.js persists
// themes, src/themes/theme-apply.js puts them on screen.
//
//   theme = {
//     id, name, version, description, createdAt,
//     colors:      { primary, secondary, accent, background, text, border, glow }
//                  CSS colours; '' = unset (the SillyTavern colour)
//     fonts:       { titleFont, labelFont, valueFont, accentFont }
//                  font ids (src/fonts/font-registry.js); '' = inherit
//     formatting:  { dateFull, dateShort, time }  datetime patterns ('' = the
//                  calendar's own), { number }    a number format id ('' = as stored)
//     variants:    { [name]: { background, backgroundImage, backgroundBlend,
//                  borderColor, borderWidth, borderRadius, shadow, padding,
//                  margin, shape, accent, opacity } } - panel looks; at least one
//     elementDefaults: { text, shapes, images, gauges, clock } - defaults for
//                  the matching element properties (ELEMENT_DEFAULT_FIELDS)
//     components:  { sceneCard, questCard, timeCard, clockCard } - card looks
//                  ({ variant, accent, icon, titleSize }), shown in the editor's
//                  preview
//     assets:      { [assetName]: 'pp_theme_<themeId>_<assetName>' } - images
//                  uploaded in the Theme Editor, each stored as a Pretty Panels
//                  image variable (src/storage/pp-variables.js)
//   }
//
// Every image field (a variant's background/texture/accent/corner image,
// the clock defaults' face and hands, a component's icon) holds either a
// URL or an asset's variable name - pp-variables.js resolveImageRef()
// shows either.
//
// Where each colour and font is used:
//   primary     bar and gauge fills          titleFont   free text, card titles
//   secondary   bar and gauge tracks         labelFont   element labels
//   accent      icons, clock second hand     valueFont   element values
//   background  panel background, clock face accentFont  gauge values, clock numerals
//   text        text on the panel
//   border      panel border
//   glow        glow text shadows, the Glow panel shadow

import { ALIGNMENTS, TEXT_TRANSFORMS, TEXT_SHADOWS, FONT_SIZE_LIMITS, BACKGROUND_OPACITY_LIMITS, BACKGROUND_RADIUS_LIMITS } from '../elements/element-style.js';
import { SHAPE_KINDS, SHAPE_LIMITS } from '../elements/shapes.js';
import { WIDGET_LIMITS } from '../elements/widgets.js';
import { IMAGE_FITS, IMAGE_CLIP_SHAPES, IMAGE_RADIUS_LIMITS, IMAGE_BORDER_WIDTH_LIMITS } from '../elements/element-model.js';
import { CLOCK_STYLES, CLOCK_NUMERALS, CLOCK_TICKS, CLOCK_LIMITS } from '../elements/clock.js';

export const DEFAULT_VARIANT = 'default';

export const THEME_COLORS = [
    ['primary', 'Primary', 'Bar and gauge fills'],
    ['secondary', 'Secondary', 'Bar and gauge tracks'],
    ['accent', 'Accent', 'Icons, highlights, the clock second hand'],
    ['background', 'Background', 'Panel background, clock face'],
    ['text', 'Text', 'Text on panels'],
    ['border', 'Border', 'Panel borders'],
    ['glow', 'Glow', 'Glow text shadows and the Glow panel shadow'],
];

export const THEME_FONTS = [
    ['titleFont', 'Title font', 'Free text elements and card titles'],
    ['labelFont', 'Label font', 'Element labels'],
    ['valueFont', 'Value font', 'Element values'],
    ['accentFont', 'Accent font', 'Gauge values and clock numerals'],
];

export const NUMBER_FORMATS = [
    ['', 'As stored'],
    ['integer', 'Whole number'],
    ['fixed1', '1 decimal place'],
    ['fixed2', '2 decimal places'],
    ['grouped', 'Thousands separators'],
];

export const THEME_FORMATTING = [
    ['dateFull', 'Full date', 'Used for "Date and time". Blank: the calendar\'s own.'],
    ['dateShort', 'Short date', 'Used for "Date only". Blank: the calendar\'s own.'],
    ['time', 'Time', 'Used for "Time only". Blank: the calendar\'s own.'],
    ['number', 'Number', 'How numbers show when an element\'s format is "As stored".'],
];

export const VARIANT_SHAPES = [
    ['rounded', 'Rounded (corner radius)'],
    ['square', 'Square'],
    ['pill', 'Pill'],
    ['ellipse', 'Ellipse'],
];

export const VARIANT_SHADOWS = [
    ['none', 'None'],
    ['soft', 'Soft'],
    ['standard', 'Standard'],
    ['strong', 'Strong'],
    ['glow', 'Glow (glow colour)'],
];

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light', 'color-dodge', 'color-burn', 'darken', 'lighten', 'luminosity']
    .map((mode) => [mode, mode === 'normal' ? 'Normal' : mode.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase())]);

// Theme assets: suggested names (any name matching ASSET_NAME_PATTERN works).
export const ASSET_SUGGESTIONS = ['backdrop', 'panelTexture', 'accentStripe', 'cornerGlyph', 'clockFace', 'hourHand', 'minuteHand', 'secondHand'];
export const ASSET_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export const ACCENT_POSITIONS = [
    ['top', 'Top edge'],
    ['bottom', 'Bottom edge'],
    ['left', 'Left edge'],
    ['right', 'Right edge'],
];

export const VARIANT_LIMITS = {
    borderWidth: [0, 20],
    borderRadius: [0, 50],
    padding: [0, 64],
    margin: [0, 64],
    opacity: [0, 100],
    textureOpacity: [0, 100],
    accentSize: [1, 200],
    cornerSize: [4, 200],
};

// The look panels had before themes: SillyTavern's own colours (unset),
// a 1px border, 10px corners and the standard drop shadow.
export const FALLBACK_VARIANT = Object.freeze({
    background: '',
    backgroundImage: '',
    backgroundBlend: 'normal',
    borderColor: '',
    borderWidth: 1,
    borderRadius: 10,
    shadow: 'standard',
    padding: 0,
    margin: 0,
    shape: 'rounded',
    accent: '',
    opacity: 100,
    textureImage: '',
    textureBlend: 'normal',
    textureOpacity: 100,
    accentImage: '',
    accentPosition: 'top',
    accentSize: 8,
    cornerImage: '',
    cornerSize: 24,
});

// Variant fields, for the editor.
export const VARIANT_FIELDS = [
    { key: 'background', type: 'color', label: 'Background', hint: 'Blank: the theme\'s background colour' },
    { key: 'opacity', type: 'number', label: 'Opacity', limits: VARIANT_LIMITS.opacity, unit: '%', hint: 'Background colour only' },
    { key: 'backgroundImage', type: 'image', label: 'Image' },
    { key: 'backgroundBlend', type: 'select', label: 'Image blend', options: BLEND_MODES },
    { key: 'borderColor', type: 'color', label: 'Border', hint: 'Blank: the theme\'s border colour' },
    { key: 'borderWidth', type: 'number', label: 'Border width', limits: VARIANT_LIMITS.borderWidth, unit: 'px' },
    { key: 'shape', type: 'select', label: 'Shape', options: VARIANT_SHAPES },
    { key: 'borderRadius', type: 'number', label: 'Corners', limits: VARIANT_LIMITS.borderRadius, unit: 'px', hint: 'For the Rounded shape' },
    { key: 'shadow', type: 'select', label: 'Shadow', options: VARIANT_SHADOWS },
    { key: 'padding', type: 'number', label: 'Padding', limits: VARIANT_LIMITS.padding, unit: 'px' },
    { key: 'margin', type: 'number', label: 'Margin', limits: VARIANT_LIMITS.margin, unit: 'px' },
    { key: 'accent', type: 'color', label: 'Accent', hint: 'Blank: the theme\'s accent colour' },
    { key: 'textureImage', type: 'image', label: 'Texture', hint: 'Tiled over the background, e.g. a panelTexture asset' },
    { key: 'textureBlend', type: 'select', label: 'Texture blend', options: BLEND_MODES },
    { key: 'textureOpacity', type: 'number', label: 'Texture opacity', limits: VARIANT_LIMITS.textureOpacity, unit: '%' },
    { key: 'accentImage', type: 'image', label: 'Accent stripe', hint: 'Stretched along one edge, e.g. an accentStripe asset' },
    { key: 'accentPosition', type: 'select', label: 'Stripe edge', options: ACCENT_POSITIONS },
    { key: 'accentSize', type: 'number', label: 'Stripe size', limits: VARIANT_LIMITS.accentSize, unit: 'px' },
    { key: 'cornerImage', type: 'image', label: 'Corner glyph', hint: 'Drawn in all four corners (mirrored), e.g. a cornerGlyph asset' },
    { key: 'cornerSize', type: 'number', label: 'Glyph size', limits: VARIANT_LIMITS.cornerSize, unit: 'px' },
];

// Element defaults: the element properties a theme can set, per group.
// Keys are the elements' own property names (element.style for text,
// element.shape, element.widget, the image fields, element.clock).
const opt = (list) => [['', 'Default'], ...list.filter(([id]) => id !== '')];
export const ELEMENT_DEFAULT_FIELDS = {
    text: [
        { key: 'fontSize', type: 'number', label: 'Font size', limits: FONT_SIZE_LIMITS, unit: 'px' },
        { key: 'textColor', type: 'color', label: 'Value colour' },
        { key: 'labelColor', type: 'color', label: 'Label colour' },
        { key: 'align', type: 'select', label: 'Align', options: opt(ALIGNMENTS) },
        { key: 'textTransform', type: 'select', label: 'Case', options: opt(TEXT_TRANSFORMS) },
        { key: 'textShadow', type: 'select', label: 'Shadow', options: opt(TEXT_SHADOWS) },
        { key: 'shadowColor', type: 'color', label: 'Shadow colour' },
        { key: 'backgroundColor', type: 'color', label: 'Background' },
        { key: 'backgroundOpacity', type: 'number', label: 'Bg opacity', limits: BACKGROUND_OPACITY_LIMITS, unit: '%' },
        { key: 'backgroundRadius', type: 'number', label: 'Bg corners', limits: BACKGROUND_RADIUS_LIMITS, unit: 'px' },
        { key: 'iconColor', type: 'color', label: 'Icon colour' },
    ],
    shapes: [
        { key: 'kind', type: 'select', label: 'Shape', options: opt(SHAPE_KINDS.map(([id, label]) => [id, label])) },
        { key: 'fillColor', type: 'color', label: 'Fill' },
        { key: 'fillOpacity', type: 'number', label: 'Fill opacity', limits: SHAPE_LIMITS.fillOpacity, unit: '%' },
        { key: 'borderColor', type: 'color', label: 'Border' },
        { key: 'borderWidth', type: 'number', label: 'Border width', limits: SHAPE_LIMITS.borderWidth, unit: 'px' },
        { key: 'cornerRadius', type: 'number', label: 'Corners', limits: SHAPE_LIMITS.cornerRadius, unit: 'px' },
    ],
    images: [
        { key: 'opacity', type: 'number', label: 'Opacity', limits: [0, 1], step: 0.05, unit: '0-1' },
        { key: 'fit', type: 'select', label: 'Fit', options: opt(IMAGE_FITS) },
        { key: 'clipShape', type: 'select', label: 'Clip shape', options: opt(IMAGE_CLIP_SHAPES) },
        { key: 'borderRadius', type: 'number', label: 'Clip corners', limits: IMAGE_RADIUS_LIMITS, unit: 'px' },
        { key: 'borderWidth', type: 'number', label: 'Clip border', limits: IMAGE_BORDER_WIDTH_LIMITS, unit: 'px' },
        { key: 'borderColor', type: 'color', label: 'Clip border colour' },
    ],
    gauges: [
        { key: 'fillColor', type: 'color', label: 'Fill', hint: 'Blank: the theme\'s primary colour' },
        { key: 'trackColor', type: 'color', label: 'Track', hint: 'Blank: the theme\'s secondary colour' },
        { key: 'strokeWidth', type: 'number', label: 'Gauge stroke', limits: WIDGET_LIMITS.strokeWidth, unit: 'px' },
        { key: 'cornerRadius', type: 'number', label: 'Bar corners', limits: WIDGET_LIMITS.cornerRadius, unit: 'px' },
        { key: 'barHeight', type: 'number', label: 'Bar height', limits: WIDGET_LIMITS.barHeight, unit: 'px' },
        { key: 'showValue', type: 'select', label: 'Gauge value', options: [['', 'Default'], ['true', 'Shown'], ['false', 'Hidden']], boolean: true },
        { key: 'animate', type: 'select', label: 'Animate', options: [['', 'Default'], ['true', 'On'], ['false', 'Off']], boolean: true },
    ],
    clock: [
        { key: 'style', type: 'select', label: 'Face', options: opt(CLOCK_STYLES) },
        { key: 'numerals', type: 'select', label: 'Numerals', options: opt(CLOCK_NUMERALS) },
        { key: 'tickMarks', type: 'select', label: 'Tick marks', options: opt(CLOCK_TICKS) },
        { key: 'backdropImage', type: 'image', label: 'Backdrop' },
        { key: 'hourHandImage', type: 'image', label: 'Hour hand' },
        { key: 'minuteHandImage', type: 'image', label: 'Minute hand' },
        { key: 'secondHandImage', type: 'image', label: 'Second hand' },
        { key: 'hourHandLength', type: 'number', label: 'Hour length', limits: CLOCK_LIMITS.hourHandLength, unit: '%' },
        { key: 'minuteHandLength', type: 'number', label: 'Minute length', limits: CLOCK_LIMITS.minuteHandLength, unit: '%' },
        { key: 'secondHandLength', type: 'number', label: 'Second length', limits: CLOCK_LIMITS.secondHandLength, unit: '%' },
        { key: 'hourHandOffset', type: 'number', label: 'Hour offset', limits: CLOCK_LIMITS.hourHandOffset, unit: '%' },
        { key: 'minuteHandOffset', type: 'number', label: 'Minute offset', limits: CLOCK_LIMITS.minuteHandOffset, unit: '%' },
        { key: 'secondHandOffset', type: 'number', label: 'Second offset', limits: CLOCK_LIMITS.secondHandOffset, unit: '%' },
    ],
};

export const ELEMENT_DEFAULT_GROUPS = [
    ['text', 'Text'],
    ['shapes', 'Shapes'],
    ['images', 'Images'],
    ['gauges', 'Bars and gauges'],
    ['clock', 'Clock'],
];

export const COMPONENTS = [
    ['sceneCard', 'Scene card', 'location-dot'],
    ['questCard', 'Quest card', 'scroll'],
    ['timeCard', 'Time card', 'hourglass-half'],
    ['clockCard', 'Clock card', 'clock'],
];

export const COMPONENT_FIELDS = [
    { key: 'variant', type: 'variant', label: 'Variant' },
    { key: 'accent', type: 'color', label: 'Accent', hint: 'Blank: the variant\'s accent' },
    { key: 'icon', type: 'icon', label: 'Icon', hint: 'A theme asset (e.g. cornerGlyph) or a Font Awesome icon name' },
    { key: 'titleSize', type: 'number', label: 'Title size', limits: [8, 48], unit: 'px' },
];

// ---- Built-in themes (seeded into settings the first time) -------------

function baseTheme(id, name, description, createdAt) {
    return {
        id, name, description, version: 1, createdAt,
        colors: { primary: '', secondary: '', accent: '', background: '', text: '', border: '', glow: '' },
        fonts: { titleFont: '', labelFont: '', valueFont: '', accentFont: '' },
        formatting: { dateFull: '', dateShort: '', time: '', number: '' },
        variants: { [DEFAULT_VARIANT]: { ...FALLBACK_VARIANT } },
        elementDefaults: { text: {}, shapes: {}, images: {}, gauges: {}, clock: {} },
        components: Object.fromEntries(COMPONENTS.map(([key]) => [key, {}])),
        assets: {},
    };
}

export function builtInThemes() {
    const sillytavern = baseTheme('ppt-sillytavern', 'SillyTavern', 'Follows your SillyTavern UI theme - how panels looked before themes existed.', 1);
    sillytavern.variants.subtle = { ...FALLBACK_VARIANT, borderWidth: 0, shadow: 'none', opacity: 55 };
    sillytavern.variants.highlight = { ...FALLBACK_VARIANT, borderColor: 'var(--SmartThemeQuoteColor)', borderWidth: 2, shadow: 'glow' };
    sillytavern.variants.clear = { ...FALLBACK_VARIANT, borderWidth: 0, shadow: 'none', opacity: 0 };

    const parchment = baseTheme('ppt-parchment', 'Parchment', 'Warm paper, ink and brass, with serif type.', 2);
    Object.assign(parchment.colors, {
        primary: '#8b3a2b', secondary: '#d8c7a3', accent: '#9a6b1f', background: '#efe2c4',
        text: '#3b2a1a', border: '#8a6d3b', glow: '#c9a24a',
    });
    Object.assign(parchment.fonts, { titleFont: 'unifrakturmaguntia', labelFont: 'crimson-pro', valueFont: 'eb-garamond', accentFont: 'eb-garamond' });
    parchment.formatting.number = 'grouped';
    parchment.variants[DEFAULT_VARIANT] = { ...FALLBACK_VARIANT, borderWidth: 2, borderRadius: 6, shadow: 'strong', padding: 4 };
    parchment.variants.scroll = { ...FALLBACK_VARIANT, borderWidth: 3, borderRadius: 18, shadow: 'strong', padding: 8, background: '#f5ecd7' };
    parchment.variants.seal = { ...FALLBACK_VARIANT, shape: 'ellipse', borderWidth: 3, borderColor: '#8b3a2b', shadow: 'soft' };
    parchment.elementDefaults.clock = { numerals: 'roman', tickMarks: 'hours' };
    parchment.elementDefaults.text = { labelColor: '#6b4f2a' };

    const neon = baseTheme('ppt-neon-hud', 'Neon HUD', 'Dark glass, cyan light and HUD type.', 3);
    Object.assign(neon.colors, {
        primary: '#22e4ff', secondary: 'rgba(34, 228, 255, 0.15)', accent: '#ff3cac', background: '#070b14',
        text: '#d6f7ff', border: '#22e4ff', glow: '#22e4ff',
    });
    Object.assign(neon.fonts, { titleFont: 'orbitron', labelFont: 'saira', valueFont: 'saira', accentFont: 'orbitron' });
    neon.variants[DEFAULT_VARIANT] = { ...FALLBACK_VARIANT, opacity: 80, borderRadius: 4, shadow: 'glow' };
    neon.variants.alert = { ...FALLBACK_VARIANT, opacity: 85, borderRadius: 4, borderWidth: 2, borderColor: '#ff3cac', accent: '#ff3cac', shadow: 'glow' };
    neon.variants.pill = { ...FALLBACK_VARIANT, shape: 'pill', opacity: 70, shadow: 'glow' };
    neon.elementDefaults.clock = { style: 'minimal', numerals: 'none', tickMarks: 'all' };
    neon.elementDefaults.text = { textShadow: 'glow', textTransform: 'uppercase' };
    neon.elementDefaults.gauges = { strokeWidth: 4 };
    neon.components.sceneCard = { variant: DEFAULT_VARIANT, icon: 'location-crosshairs' };
    neon.components.questCard = { variant: 'alert' };

    return [sillytavern, parchment, neon];
}

// ---- Normalization ------------------------------------------------------

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => (typeof v === 'string' ? v : '');

function clampNumber(value, [min, max], fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

function pickStrings(source, keys) {
    const src = isObject(source) ? source : {};
    return Object.fromEntries(keys.map((key) => [key, text(src[key])]));
}

export function normalizeVariant(raw) {
    const v = isObject(raw) ? raw : {};
    const oneOf = (value, list, fallback) => (list.some(([id]) => id === value) ? value : fallback);
    return {
        ...v,
        background: text(v.background),
        backgroundImage: text(v.backgroundImage),
        backgroundBlend: oneOf(v.backgroundBlend, BLEND_MODES, FALLBACK_VARIANT.backgroundBlend),
        borderColor: text(v.borderColor),
        borderWidth: clampNumber(v.borderWidth, VARIANT_LIMITS.borderWidth, FALLBACK_VARIANT.borderWidth),
        borderRadius: clampNumber(v.borderRadius, VARIANT_LIMITS.borderRadius, FALLBACK_VARIANT.borderRadius),
        shadow: oneOf(v.shadow, VARIANT_SHADOWS, FALLBACK_VARIANT.shadow),
        padding: clampNumber(v.padding, VARIANT_LIMITS.padding, FALLBACK_VARIANT.padding),
        margin: clampNumber(v.margin, VARIANT_LIMITS.margin, FALLBACK_VARIANT.margin),
        shape: oneOf(v.shape, VARIANT_SHAPES, FALLBACK_VARIANT.shape),
        accent: text(v.accent),
        opacity: clampNumber(v.opacity, VARIANT_LIMITS.opacity, FALLBACK_VARIANT.opacity),
        textureImage: text(v.textureImage),
        textureBlend: oneOf(v.textureBlend, BLEND_MODES, FALLBACK_VARIANT.textureBlend),
        textureOpacity: clampNumber(v.textureOpacity, VARIANT_LIMITS.textureOpacity, FALLBACK_VARIANT.textureOpacity),
        accentImage: text(v.accentImage),
        accentPosition: oneOf(v.accentPosition, ACCENT_POSITIONS, FALLBACK_VARIANT.accentPosition),
        accentSize: clampNumber(v.accentSize, VARIANT_LIMITS.accentSize, FALLBACK_VARIANT.accentSize),
        cornerImage: text(v.cornerImage),
        cornerSize: clampNumber(v.cornerSize, VARIANT_LIMITS.cornerSize, FALLBACK_VARIANT.cornerSize),
    };
}

// Fills every missing part of a theme; unknown fields are kept. A theme
// with no variants gets a "default" one with the fallback look.
export function normalizeTheme(raw) {
    const t = isObject(raw) ? raw : {};
    const variants = {};
    for (const [name, variant] of Object.entries(isObject(t.variants) ? t.variants : {})) {
        if (typeof name === 'string' && name.trim()) variants[name.trim()] = normalizeVariant(variant);
    }
    if (Object.keys(variants).length === 0) variants[DEFAULT_VARIANT] = { ...FALLBACK_VARIANT };
    const defaults = isObject(t.elementDefaults) ? t.elementDefaults : {};
    const components = isObject(t.components) ? t.components : {};
    const assets = {};
    for (const [name, ref] of Object.entries(isObject(t.assets) ? t.assets : {})) {
        if (ASSET_NAME_PATTERN.test(name) && typeof ref === 'string' && ref) assets[name] = ref;
    }
    return {
        ...t,
        id: typeof t.id === 'string' && t.id ? t.id : '',
        name: text(t.name).trim() || 'Theme',
        version: Number.isInteger(t.version) && t.version > 0 ? t.version : 1,
        description: text(t.description),
        createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(),
        colors: pickStrings(t.colors, THEME_COLORS.map(([key]) => key)),
        fonts: pickStrings(t.fonts, THEME_FONTS.map(([key]) => key)),
        formatting: pickStrings(t.formatting, THEME_FORMATTING.map(([key]) => key)),
        variants,
        elementDefaults: Object.fromEntries(ELEMENT_DEFAULT_GROUPS.map(([key]) => [key, isObject(defaults[key]) ? { ...defaults[key] } : {}])),
        components: Object.fromEntries(COMPONENTS.map(([key]) => [key, isObject(components[key]) ? { ...components[key] } : {}])),
        assets,
    };
}

// The variant name a panel shows: its own if the theme has it, else
// "default", else the theme's first variant.
export function variantNameFor(theme, name) {
    if (name && theme.variants[name]) return name;
    if (theme.variants[DEFAULT_VARIANT]) return DEFAULT_VARIANT;
    return Object.keys(theme.variants)[0];
}
