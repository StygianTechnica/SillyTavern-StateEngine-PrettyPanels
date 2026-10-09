// Drawers (docs/PLAN - FLAGS, DRAWERS, BANNERS, ATMOSPHERE.md, phase 1):
// any panel - a layout panel or a character card template - can have a
// COMPACT AREA, a rectangle of its canvas (the coordinates its elements
// use). Collapsed, the panel shows only that area, in a box of its own;
// open, it shows the whole design over its neighbours. A Toggle element
// opens and closes it.
//
// The compact area stays where it is on screen and the rest of the design
// unfolds around it, so where the area sits in the design decides which way
// the drawer opens (area at the bottom -> it opens upward). keepOnScreen
// moves an open drawer back inside the window rather than letting it run off.
//
// Open / closed is per chat and per session: kept here in memory, back to
// closed on page refresh, never saved. This module is plain logic (no DOM).

import { MIN_ELEMENT_WIDTH, MIN_ELEMENT_HEIGHT } from '../elements/element-model.js';

// A stored compact area, or null for none:
// { x, y, width, height, keepOnScreen } - canvas px, keepOnScreen default true.
export function normalizeCompact(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const int = (value, fallback) => (Number.isFinite(value) ? Math.round(value) : fallback);
    return {
        x: Math.max(0, int(raw.x, 0)),
        y: Math.max(0, int(raw.y, 0)),
        width: Math.max(MIN_ELEMENT_WIDTH, int(raw.width, 120)),
        height: Math.max(MIN_ELEMENT_HEIGHT, int(raw.height, 48)),
        keepOnScreen: raw.keepOnScreen !== false,
    };
}

// The compact area kept inside a canvas of canvasWidth x canvasHeight.
export function fitCompact(compact, canvasWidth, canvasHeight) {
    const width = Math.min(compact.width, Math.max(MIN_ELEMENT_WIDTH, canvasWidth));
    const height = Math.min(compact.height, Math.max(MIN_ELEMENT_HEIGHT, canvasHeight));
    return {
        ...compact,
        width,
        height,
        x: Math.min(compact.x, Math.max(0, canvasWidth - width)),
        y: Math.min(compact.y, Math.max(0, canvasHeight - height)),
    };
}

// The compact area after dragging its outline in Editing Mode by (dx, dy):
// `mode` 'move' (the label tab) or a corner - 'nw' | 'ne' | 'sw' | 'se' -
// which moves that corner while the opposite one stays. Kept inside the
// canvasWidth x canvasHeight canvas and at least the minimum element size;
// `snap(value)` snaps a moved edge to the panel grid.
export function dragCompact(origin, mode, dx, dy, canvasWidth, canvasHeight, snap = (v) => v) {
    const clamp = (value, min, max) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
    if (mode === 'move') {
        return {
            ...origin,
            x: clamp(snap(origin.x + dx), 0, canvasWidth - origin.width),
            y: clamp(snap(origin.y + dy), 0, canvasHeight - origin.height),
        };
    }
    const right = origin.x + origin.width;
    const bottom = origin.y + origin.height;
    let { x, y, width, height } = origin;
    if (mode.includes('w')) {
        x = clamp(snap(origin.x + dx), 0, right - MIN_ELEMENT_WIDTH);
        width = right - x;
    } else if (mode.includes('e')) {
        width = clamp(snap(right + dx) - x, MIN_ELEMENT_WIDTH, canvasWidth - x);
    }
    if (mode.includes('n')) {
        y = clamp(snap(origin.y + dy), 0, bottom - MIN_ELEMENT_HEIGHT);
        height = bottom - y;
    } else if (mode.includes('s')) {
        height = clamp(snap(bottom + dy) - y, MIN_ELEMENT_HEIGHT, canvasHeight - y);
    }
    return { ...origin, x, y, width, height };
}

// The collapsed box on screen for a panel whose full box is `full`
// ({ x, y }), with `chrome` (the box's insets around its canvas:
// { left, top, right, bottom }): the compact area keeps its place.
export function collapsedBox(full, chrome, compact) {
    return {
        x: full.x + compact.x,
        y: full.y + compact.y,
        width: compact.width + chrome.left + chrome.right,
        height: compact.height + chrome.top + chrome.bottom,
    };
}

// The open box for a drawer whose collapsed box sits at `collapsed`
// ({ x, y }) and whose full size is width x height - the full design laid
// around the compact area - moved back inside a viewport of
// viewportWidth x viewportHeight when keepOnScreen is on.
export function openBox(collapsed, compact, width, height, viewportWidth, viewportHeight) {
    const box = { x: collapsed.x - compact.x, y: collapsed.y - compact.y, width, height };
    return compact.keepOnScreen ? keepInside(box, viewportWidth, viewportHeight) : box;
}

// `box` moved (never resized) to lie inside the viewport; a box larger than
// the viewport keeps its top-left corner on screen.
export function keepInside(box, viewportWidth, viewportHeight) {
    const fit = (value, size, room) => Math.max(0, Math.min(value, room - size));
    return { ...box, x: fit(box.x, box.width, viewportWidth), y: fit(box.y, box.height, viewportHeight) };
}

// ---- open / closed, per chat, per session ----------------------------------

const open = new Set();
const listeners = new Set();

// A drawer's key: the chat, then whatever identifies the drawer in it
// ('panel', panelId) or ('card', panelId, elementId, characterId).
export function drawerKey(chatId, ...parts) {
    return [chatId ?? '', ...parts].join('|');
}

export function isDrawerOpen(key) {
    return open.has(key);
}

export function setDrawerOpen(key, value) {
    if (value === open.has(key)) return;
    if (value) open.add(key);
    else open.delete(key);
    for (const listener of [...listeners]) listener(key, value);
}

export function toggleDrawer(key) {
    setDrawerOpen(key, !open.has(key));
}

// listener(key, isOpen) on every change.
export function onDrawerChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// Closes every open drawer (each reported to the listeners).
export function closeAllDrawers() {
    for (const key of [...open]) setDrawerOpen(key, false);
}
