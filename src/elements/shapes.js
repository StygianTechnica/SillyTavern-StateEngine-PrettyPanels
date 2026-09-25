// Shape elements: plain coloured rectangles and ellipses with no variable
// behind them - backdrops that keep text readable over a panel's
// background image, dividers, frames. Shape Properties are stored in
// element.shape (saved with the layout, carried by templates). Every
// property is optional - unset uses the panel theme's shape defaults, then
// SHAPE_DEFAULTS (colours: the panel theme's).
//
//   kind          'rectangle' | 'ellipse'
//   fillColor     CSS color
//   fillOpacity   %, 0-100
//   borderColor   CSS color
//   borderWidth   px, 0-20 (0 = no border)
//   cornerRadius  px, 0-200 (rectangles only)
//
// Shapes are always drawn behind the panel's other elements (panel.js).

import { isColor } from '../panels/panel-style.js';

export const SHAPE_KINDS = [
    ['rectangle', 'Rectangle', 'fa-square'],
    ['ellipse', 'Ellipse', 'fa-circle'],
];

export const SHAPE_LIMITS = {
    fillOpacity: [0, 100],
    borderWidth: [0, 20],
    cornerRadius: [0, 200],
};

export const SHAPE_DEFAULTS = {
    kind: 'rectangle',
    fillOpacity: 70,
    borderWidth: 0,
    cornerRadius: 6,
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
}
