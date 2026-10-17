// Cut-off text shows itself on hover: anywhere in Pretty Panels' own UI
// (panels, the properties pane, the drawer, modals) where a label, a name
// or a field's value is clipped - an ellipsis, a line clamp, a narrow
// select - the mouse-over tooltip is its full text. One listener for the
// whole page; elements with a tooltip of their own keep it.

const OWN = '[class*="pp-"]';
const MARK = 'ppAutoTitle';

// The text an element shows: a field's value, a select's chosen option, or
// its own text.
function shownText(el) {
    if (el instanceof HTMLSelectElement) return el.selectedOptions?.[0]?.textContent ?? '';
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value ?? '';
    return el.textContent ?? '';
}

// Whether the element's content is clipped (wider or taller than it shows).
// A scrolling list or panel is not "cut" - it scrolls - and neither is an
// element holding many others (a card, a row of controls).
function isCut(el) {
    if (el.childElementCount > 3) return false;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) return false;
    if (el instanceof HTMLSelectElement) {
        const text = shownText(el);
        return text.length > 0 && el.clientWidth > 0 && el.scrollWidth > el.clientWidth - 24;
    }
    return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

// Sets (or clears) the full-text tooltip on the hovered element, or the
// nearest of its parents that is clipped.
function onOver(e) {
    let el = e.target instanceof Element ? e.target : null;
    if (!el?.closest(OWN)) return;
    for (let depth = 0; el && depth < 3; depth += 1, el = el.parentElement) {
        if (el.title && !el.dataset[MARK]) return; // a tooltip of its own
        const text = shownText(el).replace(/\s+/g, ' ').trim();
        if (!text || text.length > 2000) continue;
        if (isCut(el)) {
            if (el.title !== text) el.title = text;
            el.dataset[MARK] = '1';
            return;
        }
        if (el.dataset[MARK]) {
            el.removeAttribute('title');
            delete el.dataset[MARK];
        }
    }
}

let installed = false;

export function installOverflowTooltips() {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    document.addEventListener('pointerover', onOver, { passive: true });
}
