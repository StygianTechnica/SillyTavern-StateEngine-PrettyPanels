// Panel Styling: the visual properties stored in a panel instance's
// `style` object (part of its design, so saved with the layout and
// carried by templates). Every property is optional - unset means "use
// the panel's theme and variant" (src/themes/theme-apply.js merges the
// variant underneath these before they reach panelStyleVars()).
//
//   backgroundColor    CSS color (the pickers store #rrggbb)
//   panelOpacity       0-100 (%), the background colour layer only - never
//                      the border, the image or the elements (formerly
//                      backgroundOpacity; migrated in store.js)
//   borderColor        CSS color
//   borderWidth        px, 0-20
//   borderRadius       px, 0-50
//   shadow             boolean; true (default) = standard drop shadow
//   padding            px, 0-64 - space between the panel edge and elements
//   margin             px, 0-64 - the visible panel is inset by this much
//                      inside its stored bounds (geometry is unchanged)
//   backgroundImage    image URL (remote, or a SillyTavern-served path)
//   backgroundImageVariable  a State Engine image / imageList / imageMap
//                      variable; when set, the image it is showing replaces
//                      backgroundImage (which stays stored). A binding, so
//                      stripped from panel templates like element bindings.
//   backgroundImageMode  'cover' (default) | 'contain' | 'tile' | 'stretch'
//   backgroundImageOpacity  0-100 (%), the image layer only
//
// Layers, bottom to top: background colour (panelOpacity), image
// (backgroundImageOpacity; PNG/SVG/WebP alpha kept - nothing fills behind
// it), border, content. With panelOpacity 0 there is no frosted backdrop
// and the drop shadow follows the image's own shape instead of a box;
// with panelOpacity 0, no visible image and border 0 the panel is fully
// invisible while still holding its elements.
//
// Applied as --pp-* custom properties on the panel element; style.css
// maps them onto .pp-panel-box / .pp-panel-body.

export const PANEL_STYLE_LIMITS = {
    panelOpacity: [0, 100],
    borderWidth: [0, 20],
    borderRadius: [0, 50],
    padding: [0, 64],
    margin: [0, 64],
    backgroundImageOpacity: [0, 100],
};

export const IMAGE_MODES = [
    ['cover', 'Cover'],
    ['contain', 'Contain'],
    ['tile', 'Tile'],
    ['stretch', 'Stretch'],
];

// background-size / background-repeat per image mode.
const IMAGE_MODE_CSS = {
    cover: ['cover', 'no-repeat'],
    contain: ['contain', 'no-repeat'],
    tile: ['auto', 'repeat'],
    stretch: ['100% 100%', 'no-repeat'],
};

// A CSS url() for a user-entered URL, or null. Quoted and escaped so a
// URL can never break out of the declaration.
export function cssUrl(url) {
    if (typeof url !== 'string') return null;
    // Drop control characters; percent-encode the two characters that
    // could end a quoted CSS string (" and backslash, codes 34 and 92).
    const clean = [...url.trim()]
        .filter((ch) => ch.charCodeAt(0) > 31 && ch.charCodeAt(0) !== 127)
        .map((ch) => (ch.charCodeAt(0) === 34 || ch.charCodeAt(0) === 92 ? `%${ch.charCodeAt(0).toString(16).toUpperCase()}` : ch))
        .join('');
    if (!clean) return null;
    // Made absolute against the PAGE: a relative url() inside a CSS custom
    // property resolves against the stylesheet that uses it (this
    // extension's folder), so State Engine's "user/images/..." paths would
    // otherwise 404 while the same path works in an <img>.
    let absolute = clean;
    try {
        absolute = new URL(clean, document.baseURI).href;
    } catch {
        // not a URL we can resolve - use it as written
    }
    return `url("${absolute}")`;
}

export const STANDARD_SHADOW = '0px 2px 6px rgba(0, 0, 0, 0.4)';

export function isColor(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
        return typeof CSS !== 'undefined' && CSS.supports ? CSS.supports('color', value) : /^#[0-9a-f]{3,8}$/i.test(value);
    } catch {
        return false;
    }
}

// Clamps a numeric style value to its limits; null if not a number.
export function clampStyleNumber(key, value) {
    const [min, max] = PANEL_STYLE_LIMITS[key];
    if (!Number.isFinite(value)) return null;
    return Math.min(max, Math.max(min, Math.round(value)));
}

function number(style, key) {
    return clampStyleNumber(key, style?.[key]);
}

// The --pp-* property values for a style (null = unset, use the theme).
// `image` is the resolved image of backgroundImageVariable (undefined when
// the panel has no image variable), which replaces backgroundImage.
export function panelStyleVars(style = {}, image = undefined) {
    const bgColor = isColor(style.backgroundColor) ? style.backgroundColor : null;
    const opacity = number(style, 'panelOpacity') ?? number({ panelOpacity: style.backgroundOpacity }, 'panelOpacity');
    let background = null;
    if (bgColor || opacity !== null) {
        const base = bgColor ?? 'var(--ppt-background, var(--SmartThemeBlurTintColor))';
        background = opacity === null ? base : `color-mix(in srgb, ${base} ${opacity}%, transparent)`;
    }
    const px = (v) => (v === null ? null : `${v}px`);
    const images = imageVars(style, image);
    const imageVisible = images['--pp-bg-image'] !== null && number(style, 'backgroundImageOpacity') !== 0;
    const clearPanel = opacity === 0;
    const shadowOn = style.shadow !== false;
    return {
        '--pp-bg': background,
        '--pp-border-color': isColor(style.borderColor) ? style.borderColor : null,
        '--pp-border-width': px(number(style, 'borderWidth')),
        '--pp-radius': px(number(style, 'borderRadius')),
        // A clear panel casts no box shadow; a visible image on it casts
        // one that follows the image's own shape (alpha) instead.
        '--pp-shadow': !shadowOn || clearPanel ? 'none' : null,
        '--pp-image-shadow': shadowOn && clearPanel && imageVisible ? `drop-shadow(${STANDARD_SHADOW})` : null,
        // A clear panel doesn't frost what's behind it either.
        '--pp-backdrop': clearPanel ? 'none' : null,
        '--pp-padding': px(number(style, 'padding')),
        '--pp-margin': px(number(style, 'margin')),
        ...images,
    };
}

function imageVars(style, image) {
    const source = style.backgroundImageVariable ? image : style.backgroundImage;
    const url = cssUrl(source);
    if (!url) {
        return { '--pp-bg-image': null, '--pp-bg-image-size': null, '--pp-bg-image-repeat': null, '--pp-bg-image-opacity': null };
    }
    const [size, repeat] = IMAGE_MODE_CSS[style.backgroundImageMode] ?? IMAGE_MODE_CSS.cover;
    const opacity = number(style, 'backgroundImageOpacity');
    return {
        '--pp-bg-image': url,
        '--pp-bg-image-size': size,
        '--pp-bg-image-repeat': repeat,
        '--pp-bg-image-opacity': opacity === null ? null : String(opacity / 100),
    };
}

export function applyPanelStyle(el, style, image = undefined) {
    for (const [prop, value] of Object.entries(panelStyleVars(style, image))) {
        if (value === null) el.style.removeProperty(prop);
        else el.style.setProperty(prop, value);
    }
}
