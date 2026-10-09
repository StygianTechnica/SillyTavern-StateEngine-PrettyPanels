// Shape elements: plain coloured rectangles, ellipses and lines with no
// variable behind them - backdrops that keep text readable over a panel's
// background image, dividers, frames. Shape Properties are stored in
// element.shape (saved with the layout, carried by templates). Every
// property is optional - unset uses the panel theme's shape defaults, then
// SHAPE_DEFAULTS (colours: the panel theme's).
//
//   kind          'rectangle' | 'ellipse' | 'line'
//   fillColor     CSS color
//   fillOpacity   %, 0-100
//   borderColor   CSS color
//   borderWidth   px, 0-20 (0 = no border)
//   cornerRadius  px, 0-200 (rectangles only)
// A line (a rule or divider) is drawn through the middle of its element,
// so the element keeps a size that is easy to grab while the line is thin:
//   direction     'horizontal' | 'vertical'
//   lineColor     CSS color (default: the theme's border colour)
//   lineOpacity   %, 0-100
//   lineWidth     px, 1-20 (thickness)
//   lineStyle     'solid' | 'dashed' | 'dotted'
//   fadeEnds      true: the line fades out towards both ends
//
// Shapes are always drawn behind the panel's other elements (panel.js).

import { isColor } from '../panels/panel-style.js';

export const SHAPE_KINDS = [
    ['rectangle', 'Rectangle', 'fa-square'],
    ['ellipse', 'Ellipse', 'fa-circle'],
    ['line', 'Line', 'fa-minus'],
];

export const LINE_DIRECTIONS = [
    ['horizontal', 'Horizontal'],
    ['vertical', 'Vertical'],
];

export const LINE_STYLES = [
    ['solid', 'Solid'],
    ['dashed', 'Dashed'],
    ['dotted', 'Dotted'],
];

// A new line element's size: a long, short box to grab.
export const LINE_DEFAULT_SIZE = [240, 16];

export const SHAPE_LIMITS = {
    fillOpacity: [0, 100],
    borderWidth: [0, 20],
    cornerRadius: [0, 200],
    lineWidth: [1, 20],
    lineOpacity: [0, 100],
};

export const SHAPE_DEFAULTS = {
    kind: 'rectangle',
    fillOpacity: 70,
    borderWidth: 0,
    cornerRadius: 6,
    lineWidth: 1,
    lineOpacity: 100,
};

function limited(value, key) {
    const [min, max] = SHAPE_LIMITS[key];
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : SHAPE_DEFAULTS[key];
}

// Draws a shape element into `container`'s .pp-shape.
export function renderShape(container, element) {
    const shape = element.shape ?? {};
    const set = (prop, v) => (v === null ? container.style.removeProperty(prop) : container.style.setProperty(prop, v));
    const kind = SHAPE_KINDS.some(([id]) => id === shape.kind) ? shape.kind : SHAPE_DEFAULTS.kind;
    const fill = isColor(shape.fillColor) ? shape.fillColor : 'var(--ppt-background, var(--SmartThemeBlurTintColor))';
    set('--pp-shape-fill', `color-mix(in srgb, ${fill} ${limited(shape.fillOpacity, 'fillOpacity')}%, transparent)`);
    set('--pp-shape-border-color', isColor(shape.borderColor) ? shape.borderColor : null);
    set('--pp-shape-border-width', `${limited(shape.borderWidth, 'borderWidth')}px`);
    set('--pp-shape-radius', kind === 'ellipse' ? '50%' : `${limited(shape.cornerRadius, 'cornerRadius')}px`);
    container.dataset.shape = kind;
    const line = kind === 'line';
    const vertical = line && shape.direction === 'vertical';
    container.classList.toggle('pp-shape-vertical', vertical);
    container.classList.toggle('pp-shape-fade', line && shape.fadeEnds === true);
    const lineColor = isColor(shape.lineColor) ? shape.lineColor : 'var(--ppt-border, var(--SmartThemeBorderColor))';
    set('--pp-line-color', line ? `color-mix(in srgb, ${lineColor} ${limited(shape.lineOpacity, 'lineOpacity')}%, transparent)` : null);
    set('--pp-line-width', line ? `${limited(shape.lineWidth, 'lineWidth')}px` : null);
    set('--pp-line-style', line && LINE_STYLES.some(([id]) => id === shape.lineStyle) ? shape.lineStyle : null);
}
