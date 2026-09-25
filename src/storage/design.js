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
import { normalizeAnchorId } from '../panels/anchors.js';
import { CLOCK_IMAGE_KEYS, clockImageSource } from '../elements/clock.js';

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
        ...anchorFields(source),
    };
}

// Layout anchoring (src/panels/anchors.js): part of placement, like x/y.
// Records from the earlier snap-zone version ('snap' mode, old ids) map to
// the nearest anchor.
function anchorFields(source) {
    const target = normalizeAnchorId(source.anchorTarget);
    const anchored = source.anchorMode === 'anchored' || (source.anchorMode === 'snap' && !!target);
    return { anchorMode: anchored ? 'anchored' : 'free', anchorTarget: target };
}

// A design with every variable binding removed - elements' bindings, an
// analog clock's image variables and the panel's background image
// variable - which is what a panel template may hold.
export function stripBindings(design) {
    const { backgroundImageVariable: _binding, ...style } = design.style ?? {};
    return {
        ...design,
        style,
        widgets: design.widgets.map((w) => ('binding' in w ? { ...w, binding: null, ...stripClockImages(w) } : w)),
    };
}

function stripClockImages(element) {
    if (!element.clock || typeof element.clock !== 'object') return {};
    const clock = { ...element.clock };
    for (const key of CLOCK_IMAGE_KEYS) if (clockImageSource(clock[key])?.variable) delete clock[key];
    return { clock };
}
