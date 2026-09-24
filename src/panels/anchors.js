// Screen-level drag anchors: places in SillyTavern's own interface a panel
// can snap to - under the top bar, against a screen edge, at the top or
// bottom of the chat, beside an open sidebar or next to the input bar.
// Every zone is measured live from SillyTavern's DOM, so an anchored panel
// follows the interface when it changes (window size, sidebar opened or
// closed, chat column width, theme, zoom).
//
// A panel stores (panel-registry.js / design.js):
//   anchorMode    'free' | 'snap' - how eagerly it snaps while dragged
//   anchorTarget  null | an ANCHORS id
//   anchorOffset  px along the anchor edge where it was dropped (e.g. how
//                 far along the top bar), so it stays at that spot
//
// Two kinds of anchor:
//   edge    the panel's side sits on a line (`side` of the panel touches
//           `line`), sliding freely along `span`
//   point   a fixed corner position (the input margin)
// An anchor whose SillyTavern element isn't on screen (a closed sidebar)
// is unavailable: it isn't offered, and a panel anchored to it shows at
// its last stored position until it comes back.

export const ANCHOR_MODES = [
    ['free', 'Free'],
    ['snap', 'Snap'],
];

export const ANCHORS = [
    ['top-bar', 'Top bar'],
    ['bottom-bar', 'Bottom bar'],
    ['left-margin', 'Left margin'],
    ['right-margin', 'Right margin'],
    ['chat-header', 'Chat header'],
    ['chat-footer', 'Chat footer'],
    ['sidebar-margin', 'Sidebar margin'],
    ['input-margin', 'Input margin'],
];
const ANCHOR_IDS = new Set(ANCHORS.map(([id]) => id));

export function isAnchorId(id) {
    return ANCHOR_IDS.has(id);
}

export function anchorLabel(id) {
    return ANCHORS.find(([aid]) => aid === id)?.[1] ?? id;
}

// Gap between a snapped panel and the thing it snaps to, px.
const GAP = 4;
// Thickness of a highlighted zone, px.
const ZONE = 24;
// How close (px) a dragged panel's edge must come to snap, per mode.
const SNAP_DISTANCE = { free: 24, snap: 96 };

const TOP_BAR_SELECTORS = ['#top-settings-holder', '#top-bar'];

function visibleRect(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
}

// The bottom of SillyTavern's top bar (0 when there is none).
export function topBarBottom() {
    let top = 0;
    for (const selector of TOP_BAR_SELECTORS) {
        const rect = visibleRect(selector);
        // Only a bar actually along the top edge counts.
        if (rect && rect.top <= 1 && rect.bottom < window.innerHeight / 2) top = Math.max(top, Math.ceil(rect.bottom));
    }
    return top;
}

// The open sidebar (SillyTavern's left or right drawer panel), if any.
function openSidebar() {
    for (const selector of ['#right-nav-panel', '#left-nav-panel']) {
        const rect = visibleRect(selector);
        if (!rect) continue;
        const onRight = rect.left + rect.width / 2 > window.innerWidth / 2;
        return { rect, onRight };
    }
    return null;
}

// Every anchor available right now, with its geometry. `zone` is the
// strip drawn while dragging - along the line the panel snaps to.
export function measureAnchors() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = topBarBottom();
    const sheld = visibleRect('#sheld');
    const chat = visibleRect('#chat');
    const form = visibleRect('#form_sheld');
    const anchors = [];
    const edge = (id, side, line, span, zone) => anchors.push({ id, label: anchorLabel(id), kind: 'edge', side, line, span, zone });

    edge('top-bar', 'top', top + GAP, [0, vw], { x: 0, y: top, width: vw, height: ZONE });
    edge('bottom-bar', 'bottom', vh - GAP, [0, vw], { x: 0, y: vh - ZONE, width: vw, height: ZONE });
    edge('left-margin', 'left', GAP, [top, vh], { x: 0, y: top, width: ZONE, height: vh - top });
    edge('right-margin', 'right', vw - GAP, [top, vh], { x: vw - ZONE, y: top, width: ZONE, height: vh - top });

    if (sheld && chat) {
        edge('chat-header', 'top', chat.top + GAP, [sheld.left, sheld.right], { x: sheld.left, y: chat.top, width: sheld.width, height: ZONE });
    }
    if (sheld && form) {
        edge('chat-footer', 'bottom', form.top - GAP, [sheld.left, sheld.right], { x: sheld.left, y: form.top - ZONE, width: sheld.width, height: ZONE });
    }
    const sidebar = openSidebar();
    if (sidebar) {
        const { rect, onRight } = sidebar;
        if (onRight) edge('sidebar-margin', 'right', rect.left - GAP, [rect.top, rect.bottom], { x: rect.left - ZONE, y: rect.top, width: ZONE, height: rect.height });
        else edge('sidebar-margin', 'left', rect.right + GAP, [rect.top, rect.bottom], { x: rect.right, y: rect.top, width: ZONE, height: rect.height });
    }
    if (form) {
        // Beside the input bar, bottoms aligned: right of it if there is
        // room, else left of it.
        const roomRight = vw - form.right;
        const onRight = roomRight >= form.left;
        const width = Math.max(ZONE, Math.min(160, onRight ? roomRight : form.left));
        anchors.push({
            id: 'input-margin',
            label: anchorLabel('input-margin'),
            kind: 'point',
            onRight,
            point: { x: onRight ? form.right + GAP : form.left - GAP, y: form.bottom },
            zone: { x: onRight ? form.right : form.left - width, y: form.top, width, height: form.height },
        });
    }
    return anchors;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

const HORIZONTAL = new Set(['top', 'bottom']);

// Where a panel of `geom` size sits on `anchor`, `offset` px along it.
export function placeOnAnchor(anchor, geom, offset = 0) {
    const { width: w, height: h } = geom;
    if (anchor.kind === 'point') {
        return { x: Math.round(anchor.onRight ? anchor.point.x : anchor.point.x - w), y: Math.round(anchor.point.y - h) };
    }
    const [from, to] = anchor.span;
    if (HORIZONTAL.has(anchor.side)) {
        return {
            x: Math.round(clamp(from + offset, from, to - w)),
            y: Math.round(anchor.side === 'top' ? anchor.line : anchor.line - h),
        };
    }
    return {
        x: Math.round(anchor.side === 'left' ? anchor.line : anchor.line - w),
        y: Math.round(clamp(from + offset, from, to - h)),
    };
}

// The offset along `anchor` for a panel at `geom` (what placeOnAnchor
// needs to put it back there).
export function offsetOnAnchor(anchor, geom) {
    if (anchor.kind === 'point') return 0;
    return Math.round(HORIZONTAL.has(anchor.side) ? geom.x - anchor.span[0] : geom.y - anchor.span[0]);
}

// How far `geom` is from snapping to `anchor` (Infinity if it isn't
// alongside it at all).
function distanceTo(anchor, geom) {
    const { x, y, width: w, height: h } = geom;
    if (anchor.kind === 'point') {
        const cornerX = anchor.onRight ? x : x + w;
        return Math.hypot(cornerX - anchor.point.x, y + h - anchor.point.y);
    }
    const [from, to] = anchor.span;
    if (HORIZONTAL.has(anchor.side)) {
        if (x + w < from || x > to) return Infinity;
        return Math.abs((anchor.side === 'top' ? y : y + h) - anchor.line);
    }
    if (y + h < from || y > to) return Infinity;
    return Math.abs((anchor.side === 'left' ? x : x + w) - anchor.line);
}

// The anchor a panel dragged to `geom` would snap to, or null. `anchors`:
// from measureAnchors() (measured once per drag).
export function nearestAnchor(anchors, geom, mode = 'free') {
    const limit = SNAP_DISTANCE[mode] ?? SNAP_DISTANCE.free;
    let best = null;
    let bestDistance = limit;
    for (const anchor of anchors) {
        const d = distanceTo(anchor, geom);
        if (d <= bestDistance) {
            best = anchor;
            bestDistance = d;
        }
    }
    return best;
}

// Position for a record anchored to `record.anchorTarget`, or null when
// it isn't anchored or that anchor is unavailable right now.
export function resolveAnchoredPosition(record) {
    if (!isAnchorId(record?.anchorTarget)) return null;
    const anchor = measureAnchors().find((a) => a.id === record.anchorTarget);
    return anchor ? placeOnAnchor(anchor, record, record.anchorOffset ?? 0) : null;
}

// ---- Drag overlay: every zone outlined, the one that would be used
// highlighted. Only exists while a panel is being dragged.

let overlay = null;

export function showAnchorOverlay(anchors, activeId) {
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'pp-anchor-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
        overlay.replaceChildren(...anchors.map((anchor) => {
            const zone = document.createElement('div');
            zone.className = 'pp-anchor-zone';
            zone.dataset.anchor = anchor.id;
            zone.classList.toggle('pp-anchor-vertical', anchor.zone.height > anchor.zone.width * 2);
            Object.assign(zone.style, {
                left: `${anchor.zone.x}px`,
                top: `${anchor.zone.y}px`,
                width: `${anchor.zone.width}px`,
                height: `${anchor.zone.height}px`,
            });
            const label = document.createElement('span');
            label.textContent = anchor.label;
            zone.appendChild(label);
            return zone;
        }));
    }
    for (const zone of overlay.children) zone.classList.toggle('pp-anchor-active', zone.dataset.anchor === activeId);
}

export function hideAnchorOverlay() {
    overlay?.remove();
    overlay = null;
}

// Calls `onChange` (at most once per frame) whenever something anchors
// depend on may have moved: the window, SillyTavern's top bar, chat
// column, input bar or sidebars changing size, or a sidebar opening or
// closing.
export function watchAnchorLayout(onChange) {
    let queued = false;
    const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            onChange();
        });
    };
    window.addEventListener('resize', schedule);
    const selectors = [...TOP_BAR_SELECTORS, '#sheld', '#chat', '#form_sheld', '#left-nav-panel', '#right-nav-panel'];
    const elements = selectors.map((s) => document.querySelector(s)).filter(Boolean);
    if (typeof ResizeObserver !== 'undefined') {
        const resize = new ResizeObserver(schedule);
        for (const el of elements) resize.observe(el);
    }
    if (typeof MutationObserver !== 'undefined') {
        const mutation = new MutationObserver(schedule);
        for (const el of elements) mutation.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    }
}
