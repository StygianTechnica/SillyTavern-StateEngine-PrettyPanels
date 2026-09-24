// Soft (magnetic) snap-to-grid, shared by panels (layout grid, origin at
// the viewport's top-left) and elements (panel grid, origin at the panel
// body's top-left).
//
// Never forced: a value only moves when it is already close to a grid
// line. Within `radius` of a line it lands exactly on it; within the next
// `radius` it is pulled part of the way, easing off to nothing - so
// alignment feels like a gentle lean, and moving a few pixels further
// always escapes it.

function radiusFor(grid) {
    return Math.min(6, Math.max(1.5, grid * 0.2));
}

export function softSnap(value, grid) {
    if (!(grid > 1)) return value;
    const line = Math.round(value / grid) * grid;
    const distance = Math.abs(value - line);
    const radius = radiusFor(grid);
    if (distance <= radius) return line;
    if (distance >= radius * 2) return value;
    const pull = 1 - (distance - radius) / radius;
    return Math.round(value + (line - value) * pull * 0.5);
}

// Snaps a span [start, start + size] by whichever edge is pulled harder,
// keeping its size - so a panel's right/bottom edge aligns as readily as
// its left/top. Returns the new start.
export function softSnapSpan(start, size, grid) {
    const byStart = softSnap(start, grid);
    const byEnd = softSnap(start + size, grid) - size;
    const moveStart = Math.abs(byStart - start);
    const moveEnd = Math.abs(byEnd - start);
    if (moveStart === 0 && moveEnd === 0) return start;
    if (moveStart === 0) return byEnd;
    if (moveEnd === 0) return byStart;
    // Both edges are near a line: prefer whichever is nearer to exact.
    const exactStart = byStart % grid === 0;
    const exactEnd = (byEnd + size) % grid === 0;
    if (exactStart !== exactEnd) return exactStart ? byStart : byEnd;
    return moveStart <= moveEnd ? byStart : byEnd;
}
