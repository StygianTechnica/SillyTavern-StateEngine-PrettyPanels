// Puts a theme on screen. A panel is drawn from, in order (later wins):
//   1. theme.colors      --ppt-* colour variables, inherited by everything
//   2. theme.fonts       --ppt-*-font variables       in the panel
//   3. theme.formatting  value formats (formats.js), via themedElement()
//   4. theme.variants[panel.themeVariant]  the panel's Panel Styling base
//   5. theme.elementDefaults  element property defaults, via themedElement()
//   6. the panel's own Panel Styling and each element's own properties
// style.css reads the --ppt-* variables wherever it used to read
// SillyTavern's; a theme colour left blank still falls back to
// SillyTavern's own there.
//
// Image fields may name a theme asset (a Pretty Panels image variable,
// src/storage/pp-variables.js) instead of a URL; resolveImageRef() turns
// both into something displayable. A variant's images fill the panel's
// background, texture, accent stripe and corner glyph layers.

import { panelStyleVars, isColor, cssUrl } from '../panels/panel-style.js';
import { resolveImageRef } from '../storage/pp-variables.js';
import { fontRegistry } from '../fonts/font-registry.js';
import { resolveTheme, getTheme } from './theme-store.js';
import { variantNameFor } from './theme-schema.js';

const SHADOW_CSS = {
    none: 'none',
    soft: '0 1px 3px rgba(0, 0, 0, 0.3)',
    standard: '0 2px 6px rgba(0, 0, 0, 0.4)',
    strong: '0 6px 18px rgba(0, 0, 0, 0.55)',
    glow: '0 0 12px var(--ppt-glow, var(--SmartThemeQuoteColor)), 0 0 2px var(--ppt-glow, var(--SmartThemeQuoteColor))',
};

const SHAPE_RADIUS = { square: '0px', pill: '9999px', ellipse: '50%' };

// { theme, variantName, variant } for a panel record (or any
// { themeId, themeVariant }): its own choice, else the first theme and
// that theme's default variant.
export function resolvePanelTheme(record) {
    const theme = resolveTheme(record?.themeId);
    const variantName = variantNameFor(theme, record?.themeVariant);
    return { theme, variantName, variant: theme.variants[variantName] };
}

function fontCss(id) {
    if (!id || id === 'inherit') return null;
    const family = fontRegistry.cssFamily(id);
    return family === 'inherit' ? null : family;
}

// The theme's colours and fonts (and the variant's accent) as CSS
// custom properties. null = unset.
export function themeVars(theme, variant) {
    const color = (value) => (isColor(value) ? value : null);
    const { colors, fonts } = theme;
    return {
        '--ppt-primary': color(colors.primary),
        '--ppt-secondary': color(colors.secondary),
        '--ppt-accent': color(variant?.accent) ?? color(colors.accent),
        '--ppt-background': color(colors.background),
        '--ppt-text': color(colors.text),
        '--ppt-border': color(colors.border),
        '--ppt-glow': color(colors.glow),
        '--ppt-title-font': fontCss(fonts.titleFont),
        '--ppt-label-font': fontCss(fonts.labelFont),
        '--ppt-value-font': fontCss(fonts.valueFont),
        '--ppt-accent-font': fontCss(fonts.accentFont),
    };
}

// The variant as Panel Styling, with the panel's own Panel Styling on top
// (a set panel value always wins).
export function themedPanelStyle(variant, style = {}) {
    const base = {
        backgroundColor: variant.background || undefined,
        panelOpacity: variant.opacity === 100 ? undefined : variant.opacity,
        borderColor: variant.borderColor || undefined,
        borderWidth: variant.borderWidth,
        borderRadius: variant.borderRadius,
        padding: variant.padding,
        margin: variant.margin,
        backgroundImage: variant.backgroundImage || undefined,
    };
    const own = Object.fromEntries(Object.entries(style ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    const merged = { ...base, ...own };
    // A theme asset name becomes its image's URL.
    if (merged.backgroundImage) merged.backgroundImage = resolveImageRef(merged.backgroundImage) ?? undefined;
    return merged;
}

// Every CSS variable a themed panel needs. `image` is the resolved
// background image variable, as for panelStyleVars().
export function themedPanelVars(theme, variant, style = {}, image = undefined) {
    const vars = { ...panelStyleVars(themedPanelStyle(variant, style), image), ...themeVars(theme, variant) };
    // The variant's shape rounds the corners, unless the panel sets its own.
    if (!Number.isFinite(style?.borderRadius) && SHAPE_RADIUS[variant.shape]) vars['--pp-radius'] = SHAPE_RADIUS[variant.shape];
    // "Drop shadow" off (or a clear panel) still wins; otherwise the variant's.
    if (vars['--pp-shadow'] === null) vars['--pp-shadow'] = SHADOW_CSS[variant.shadow] ?? null;
    vars['--pp-bg-blend'] = variant.backgroundBlend && variant.backgroundBlend !== 'normal' ? variant.backgroundBlend : null;
    // Decoration layers: a tiled texture, an accent stripe along one edge
    // and a glyph in each corner.
    const layerUrl = (ref) => cssUrl(resolveImageRef(ref));
    const texture = layerUrl(variant.textureImage);
    vars['--pp-texture-image'] = texture;
    vars['--pp-texture-blend'] = texture && variant.textureBlend !== 'normal' ? variant.textureBlend : null;
    vars['--pp-texture-opacity'] = texture && variant.textureOpacity !== 100 ? String(variant.textureOpacity / 100) : null;
    const accent = layerUrl(variant.accentImage);
    vars['--pp-accent-image'] = accent;
    vars['--pp-accent-size'] = accent ? `${variant.accentSize}px` : null;
    const corner = layerUrl(variant.cornerImage);
    vars['--pp-corner-image'] = corner;
    vars['--pp-corner-size'] = corner ? `${variant.cornerSize}px` : null;
    return vars;
}

// Which decoration layers show, as data attributes on the panel element
// (style.css places the accent stripe by edge).
export function applyDecorations(el, variant) {
    const accent = resolveImageRef(variant.accentImage);
    if (accent) el.dataset.ppAccent = variant.accentPosition;
    else delete el.dataset.ppAccent;
    if (resolveImageRef(variant.cornerImage)) el.dataset.ppCorners = '';
    else delete el.dataset.ppCorners;
}

export function applyVars(el, vars) {
    for (const [prop, value] of Object.entries(vars)) {
        if (value === null || value === undefined) el.style.removeProperty(prop);
        else el.style.setProperty(prop, value);
    }
}

// Styles a panel element (.pp-panel) from its record's theme, variant and
// Panel Styling. Returns the resolved { theme, variantName, variant }.
export function applyPanelTheme(el, record, image = undefined) {
    const resolved = resolvePanelTheme(record);
    applyVars(el, themedPanelVars(resolved.theme, resolved.variant, record?.style ?? {}, image));
    applyDecorations(el, resolved.variant);
    el.dataset.themeId = resolved.theme.id;
    el.dataset.themeVariant = resolved.variantName;
    return resolved;
}

// ---- Elements ---------------------------------------------------------------

function unsetRemoved(object) {
    return Object.fromEntries(Object.entries(object ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}

const IMAGE_KEYS = ['opacity', 'fit', 'clipShape', 'borderRadius', 'borderWidth', 'borderColor'];

// An element with the theme's element defaults filled in wherever the
// element leaves a property unset. The stored element is never changed.
export function themedElement(element, theme) {
    const defaults = theme?.elementDefaults;
    if (!defaults) return element;
    const out = { ...element };
    if (element.type === 'text' || element.type === 'free-text') out.style = { ...unsetRemoved(defaults.text), ...unsetRemoved(element.style) };
    if (element.type === 'shape') out.shape = { ...unsetRemoved(defaults.shapes), ...unsetRemoved(element.shape) };
    if (['bar-horizontal', 'bar-vertical', 'gauge-circle', 'gauge-semicircle', 'composite-bar'].includes(element.type)) {
        out.widget = { ...unsetRemoved(defaults.gauges), ...unsetRemoved(element.widget) };
    }
    if (element.type === 'text') {
        for (const key of IMAGE_KEYS) if (out[key] === undefined && defaults.images?.[key] !== undefined && defaults.images[key] !== '') out[key] = defaults.images[key];
    }
    return out;
}

// The clock defaults for an analog clock: those of the theme its Clock
// Properties name (element.clock.themeStyle), else its panel's theme's.
export function clockDefaultsFor(element, theme) {
    const chosen = element?.clock?.themeStyle ? getTheme(element.clock.themeStyle) : null;
    return unsetRemoved((chosen ?? theme)?.elementDefaults?.clock);
}
