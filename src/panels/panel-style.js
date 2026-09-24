// Panel Styling: the visual properties stored in a panel instance's
// `style` object (part of its design, so saved with the layout and
// carried by templates). Every property is optional - unset means "follow
// the SillyTavern theme", exactly as panels looked before styling existed.
//
//   backgroundColor    CSS color (the pickers store #rrggbb)
//   backgroundOpacity  0-100 (%), applied to the background colour only
//   borderColor        CSS color
//   borderWidth        px, 0-20
//   borderRadius       px, 0-50
//   shadow             boolean; true (default) = standard drop shadow
//   padding            px, 0-64 - space between the panel edge and elements
//   margin             px, 0-64 - the visible panel is inset by this much
//                      inside its stored bounds (geometry is unchanged)
//
// Applied as --pp-* custom properties on the panel element; style.css
// maps them onto .pp-panel-box / .pp-panel-body.

export const PANEL_STYLE_LIMITS = {
    backgroundOpacity: [0, 100],
    borderWidth: [0, 20],
    borderRadius: [0, 50],
    padding: [0, 64],
    margin: [0, 64],
};

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
export function panelStyleVars(style = {}) {
    const bgColor = isColor(style.backgroundColor) ? style.backgroundColor : null;
    const opacity = number(style, 'backgroundOpacity');
    let background = null;
    if (bgColor || opacity !== null) {
        const base = bgColor ?? 'var(--SmartThemeBlurTintColor)';
        background = opacity === null ? base : `color-mix(in srgb, ${base} ${opacity}%, transparent)`;
    }
    const px = (v) => (v === null ? null : `${v}px`);
    return {
        '--pp-bg': background,
        '--pp-border-color': isColor(style.borderColor) ? style.borderColor : null,
        '--pp-border-width': px(number(style, 'borderWidth')),
        '--pp-radius': px(number(style, 'borderRadius')),
        '--pp-shadow': style.shadow === false ? 'none' : null,
        '--pp-padding': px(number(style, 'padding')),
        '--pp-margin': px(number(style, 'margin')),
    };
}

export function applyPanelStyle(el, style) {
    for (const [prop, value] of Object.entries(panelStyleVars(style))) {
        if (value === null) el.style.removeProperty(prop);
        else el.style.setProperty(prop, value);
    }
}
