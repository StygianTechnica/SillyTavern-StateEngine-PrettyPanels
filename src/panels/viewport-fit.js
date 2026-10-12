// Keeping panels in the window as it changes size - plain functions, so
// they can be tested on their own.
//
// A FREE panel is shown wholly inside the window: when the window gets
// smaller than where the panel was placed, it moves in (its stored place
// is kept, so it returns when the window grows again). A panel placed
// flush against the right or bottom edge remembers that (stickRight /
// stickBottom, set by panel-manager.js whenever its geometry is written)
// and stays against that edge at any window size - so a panel parked in
// the corner of a maximized window is still in the corner of a smaller
// one, instead of half off the screen.
//
// The MARGIN columns (anchors.js, panels docked at the left or right
// screen edge) give way before the chat does: while the chat column would
// be narrower than MIN_CHAT_WIDTH, the columns shrink - their panels
// scaled down together - to at most MIN_COLUMN_SCALE of their size. Past
// that, the chat narrows as before.

// A panel edge this close to the window's edge counts as flush against it.
export const EDGE_STICK = 12;

// The chat column keeps at least this width while margin columns can shrink.
export const MIN_CHAT_WIDTH = 480;

// Margin columns shrink to no less than this share of their panels' size.
export const MIN_COLUMN_SCALE = 0.5;

// The margin column's own padding, both sides (style.css .pp-anchor-column).
export const COLUMN_PADDING = 8;

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

// Which window edges a panel at `geometry` ({ x, y, width, height }) is
// flush against, in a `vw` x `vh` window: { stickRight, stickBottom }. A
// panel against both edges of an axis (as wide as the window) sticks to
// neither.
export function edgesFor({ x, y, width, height }, vw, vh) {
    return {
        stickRight: x > EDGE_STICK && vw - (x + width) <= EDGE_STICK,
        stickBottom: y > EDGE_STICK && vh - (y + height) <= EDGE_STICK,
    };
}

// Where a free panel record shows in a `vw` x `vh` window: { x, y }. Flush
// against a remembered edge, then wholly inside the window (a panel larger
// than the window keeps its top-left corner on screen).
export function fitToViewport({ x, y, width, height, stickRight = false, stickBottom = false }, vw, vh) {
    return {
        x: clamp(stickRight ? vw - width : x, 0, vw - width),
        y: clamp(stickBottom ? vh - height : y, 0, vh - height),
    };
}

// The margin columns' widths for a `vw` wide window, given the width each
// wants (its widest panel; 0 = no column): { left, right, leftScale,
// rightScale } - each column's shown width and the scale its panels are
// drawn at (1 = full size).
export function marginWidths({ left = 0, right = 0 }, vw) {
    const wanted = (left > 0 ? left + COLUMN_PADDING : 0) + (right > 0 ? right + COLUMN_PADDING : 0);
    const room = vw - MIN_CHAT_WIDTH;
    if (wanted === 0 || wanted <= room) return { left, right, leftScale: 1, rightScale: 1 };
    const padding = (left > 0 ? COLUMN_PADDING : 0) + (right > 0 ? COLUMN_PADDING : 0);
    const scale = clamp((room - padding) / (left + right), MIN_COLUMN_SCALE, 1);
    return { left: Math.round(left * scale), right: Math.round(right * scale), leftScale: left > 0 ? scale : 1, rightScale: right > 0 ? scale : 1 };
}
