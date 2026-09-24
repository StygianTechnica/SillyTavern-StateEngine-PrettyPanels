// SillyTavern layout anchors: places INSIDE SillyTavern's own layout a
// panel can be attached to. An anchored ("docked") panel is not a floating
// overlay - its element is moved into SillyTavern's DOM at the anchor, it
// occupies real space, and SillyTavern reflows around it:
//
//   anchor_top_of_chat     in #sheld, before #chat        chat gets shorter
//   anchor_bottom_of_chat  in #sheld, before #form_sheld  chat gets shorter
//   anchor_above_input     in #form_sheld, before #send_form
//   anchor_below_input     in #form_sheld, after #send_form
//   anchor_sidebar_margin  in the right sidebar (#right-nav-panel), above
//                          its scrolling list - shown while it is open
//   anchor_left_margin     a column at the left / right screen edge, below
//   anchor_right_margin    the top bar; the chat column (#sheld) and the
//                          sidebars move over and narrow to make room
//
// Each anchor has a host element (.pp-anchor-host) created on first use;
// panels docked to the same anchor stack in it. Hosts inside the chat
// column stretch a panel to the column's width (its height is kept);
// margin columns are as wide as their widest panel.
//
// A panel stores (design.js):
//   anchorMode    'free' | 'anchored'
//   anchorTarget  null | an ANCHORS id (used when anchorMode is 'anchored')

export const ANCHOR_MODES = [
    ['free', 'Free'],
    ['anchored', 'Anchored'],
];

export const ANCHORS = [
    ['anchor_top_of_chat', 'Top of chat'],
    ['anchor_bottom_of_chat', 'Bottom of chat'],
    ['anchor_above_input', 'Above input'],
    ['anchor_below_input', 'Below input'],
    ['anchor_left_margin', 'Left margin'],
    ['anchor_right_margin', 'Right margin'],
    ['anchor_sidebar_margin', 'Sidebar'],
];
const ANCHOR_IDS = new Set(ANCHORS.map(([id]) => id));

// Ids used by the earlier snap-zone version, mapped to their nearest anchor.
const LEGACY_IDS = {
    'top-bar': 'anchor_top_of_chat',
    'chat-header': 'anchor_top_of_chat',
    'chat-footer': 'anchor_bottom_of_chat',
    'input-margin': 'anchor_above_input',
    'bottom-bar': 'anchor_below_input',
    'left-margin': 'anchor_left_margin',
    'right-margin': 'anchor_right_margin',
    'sidebar-margin': 'anchor_sidebar_margin',
};

export function isAnchorId(id) {
    return ANCHOR_IDS.has(id);
}

// A stored anchorTarget (current or legacy id) as a current id, or null.
export function normalizeAnchorId(id) {
    return ANCHOR_IDS.has(id) ? id : (LEGACY_IDS[id] ?? null);
}

export function anchorLabel(id) {
    return ANCHORS.find(([aid]) => aid === id)?.[1] ?? id;
}

const MARGIN_SIDES = { anchor_left_margin: 'left', anchor_right_margin: 'right' };

export function isMarginAnchor(id) {
    return id in MARGIN_SIDES;
}

// Where each non-margin host goes: inside `parent`, before the first
// match of `before` (or at the end when there is none / `before` is null).
const HOST_PLACES = {
    anchor_top_of_chat: { parent: '#sheld', before: '#chat' },
    anchor_bottom_of_chat: { parent: '#sheld', before: '#form_sheld' },
    anchor_above_input: { parent: '#form_sheld', before: '#send_form' },
    anchor_below_input: { parent: '#form_sheld', before: null },
    anchor_sidebar_margin: { parent: '#right-nav-panel', before: ':scope > .scrollableInner' },
};

const hosts = new Map();

// The host element for an anchor, created and (re)inserted as needed.
// null when SillyTavern's element for it doesn't exist.
export function anchorHost(id) {
    let host = hosts.get(id);
    if (!host) {
        host = document.createElement('div');
        host.className = 'pp-anchor-host';
        host.dataset.anchor = id;
        hosts.set(id, host);
    }
    if (isMarginAnchor(id)) {
        host.classList.add('pp-anchor-column', `pp-anchor-column-${MARGIN_SIDES[id]}`);
        if (host.parentElement !== document.body) document.body.appendChild(host);
        return host;
    }
    const place = HOST_PLACES[id];
    const parent = document.querySelector(place.parent);
    if (!parent) {
        host.remove();
        return null;
    }
    const before = place.before ? parent.querySelector(place.before) : null;
    if (host.parentElement !== parent || (before && host.nextElementSibling !== before)) {
        parent.insertBefore(host, before);
    }
    return host;
}

// Sizes the margin columns to their panels and moves SillyTavern's chat
// column and sidebars out of their way (CSS variables read by style.css,
// "Layout anchors"). Call after panels were docked or undocked.
export function updateMarginLayout() {
    const root = document.documentElement;
    let any = false;
    for (const [id, side] of Object.entries(MARGIN_SIDES)) {
        const host = hosts.get(id);
        const panels = host ? [...host.children].filter((el) => el.classList.contains('pp-panel')) : [];
        const width = panels.reduce((max, el) => Math.max(max, parseFloat(el.style.width) || 0), 0);
        if (host) host.style.width = `${width}px`;
        // The column's own padding (style.css .pp-anchor-column) included.
        root.style.setProperty(`--pp-anchor-${side}`, `${width > 0 ? width + 8 : 0}px`);
        if (width > 0) any = true;
    }
    document.body.classList.toggle('pp-anchor-margins', any);
}

function visibleRect(selector) {
    const el = document.querySelector(selector);
    if (!el) return null;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
}

const TOP_BAR_SELECTORS = ['#top-settings-holder', '#top-bar'];

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

// Drop targets while dragging: [{ id, label, rect }], most specific first
// (the first one containing the pointer wins).
const EDGE_STRIP = 40;
const CHAT_STRIP = 64;

export function measureDropZones() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const top = topBarBottom();
    const sheld = visibleRect('#sheld');
    const chat = visibleRect('#chat');
    const form = visibleRect('#form_sheld');
    const sidebar = visibleRect('#right-nav-panel');
    const leftDrawer = visibleRect('#left-nav-panel');
    const zones = [];
    const zone = (id, x, y, width, height) => {
        if (width > 0 && height > 0) zones.push({ id, label: anchorLabel(id), rect: { x, y, width, height } });
    };
    const rect = (r) => [r.left, r.top, r.width, r.height];

    // Screen edges: always reachable, even with a sidebar open over the margin.
    zone('anchor_left_margin', 0, top, EDGE_STRIP, vh - top);
    zone('anchor_right_margin', vw - EDGE_STRIP, top, EDGE_STRIP, vh - top);
    if (sidebar) zone('anchor_sidebar_margin', ...rect(sidebar));
    if (form) {
        zone('anchor_above_input', form.left, form.top, form.width, form.height / 2);
        zone('anchor_below_input', form.left, form.top + form.height / 2, form.width, form.height / 2);
    }
    if (chat) {
        zone('anchor_top_of_chat', chat.left, chat.top, chat.width, Math.min(CHAT_STRIP, chat.height / 3));
        zone('anchor_bottom_of_chat', chat.left, chat.bottom - Math.min(CHAT_STRIP, chat.height / 3), chat.width, Math.min(CHAT_STRIP, chat.height / 3));
    }
    // The whole margin, where no sidebar covers it.
    if (sheld) {
        if (!leftDrawer) zone('anchor_left_margin', EDGE_STRIP, top, sheld.left - EDGE_STRIP, vh - top);
        if (!sidebar) zone('anchor_right_margin', sheld.right, top, vw - EDGE_STRIP - sheld.right, vh - top);
    }
    return zones;
}

export function zoneAt(zones, x, y) {
    return zones.find(({ rect }) => x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) ?? null;
}

// ---- Drag overlay: every drop target outlined, the one under the
// pointer highlighted. Only exists while a panel is being dragged.

let overlay = null;

export function showAnchorOverlay(zones, activeId) {
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'pp-anchor-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        document.body.appendChild(overlay);
        overlay.replaceChildren(...zones.map(({ id, label, rect }) => {
            const el = document.createElement('div');
            el.className = 'pp-anchor-zone';
            el.dataset.anchor = id;
            el.classList.toggle('pp-anchor-vertical', rect.height > rect.width * 2 && rect.width < 80);
            Object.assign(el.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            const text = document.createElement('span');
            text.textContent = label;
            el.appendChild(text);
            return el;
        }));
    }
    for (const el of overlay.children) el.classList.toggle('pp-anchor-active', el.dataset.anchor === activeId);
}

export function hideAnchorOverlay() {
    overlay?.remove();
    overlay = null;
}
