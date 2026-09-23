// A panel's DESIGN: everything a template or layout carries between
// chats - geometry, styling, widget composition and background layers.
// pickDesign() is the whitelist: whatever else a record holds (IDs, lock
// state, and especially chat-scoped variable bindings, visibility rules
// and theme overrides) is dropped, so it can never leak into the Panel
// Library, a layout export, or an import.

import { clone } from './store.js';

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
        widgets: list(source.widgets),
        backgrounds: list(source.backgrounds),
    };
}
