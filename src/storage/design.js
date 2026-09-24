// A panel's DESIGN: geometry, styling, widget composition (elements) and
// background layers. pickDesign() is the whitelist: whatever else a
// record holds (IDs, lock state, visibility rules, theme overrides) is
// dropped, so it can never leak into the Panel Library, a layout export,
// or an import.
//
// Element variable bindings ARE part of a layout's design (a chat
// chooses a layout for what it displays) but never part of a panel
// template's: the Panel Library runs every design through
// stripBindings().

import { clone } from './store.js';
import { normalizeWidgets } from '../elements/element-model.js';

export const DEFAULT_PANEL_WIDTH = 280;
export const DEFAULT_PANEL_HEIGHT = 180;
export const MIN_PANEL_WIDTH = 80;
export const MIN_PANEL_HEIGHT = 48;

function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
}

function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? clone(value) : {};
}

function list(value) {
    return Array.isArray(value) ? clone(value) : [];
}

export function pickDesign(source = {}) {
    return {
        x: finite(source.x, 0),
        y: finite(source.y, 0),
        width: Math.max(MIN_PANEL_WIDTH, finite(source.width, DEFAULT_PANEL_WIDTH)),
        height: Math.max(MIN_PANEL_HEIGHT, finite(source.height, DEFAULT_PANEL_HEIGHT)),
        style: plainObject(source.style),
        widgets: normalizeWidgets(list(source.widgets)),
        backgrounds: list(source.backgrounds),
    };
}

// A design with every variable binding removed - elements' bindings and
// the panel's background image variable - which is what a panel template
// may hold.
export function stripBindings(design) {
    const { backgroundImageVariable: _binding, ...style } = design.style ?? {};
    return {
        ...design,
        style,
        widgets: design.widgets.map((w) => ('binding' in w ? { ...w, binding: null } : w)),
    };
}
