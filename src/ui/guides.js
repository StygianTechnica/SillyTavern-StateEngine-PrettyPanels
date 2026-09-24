// Alignment guides: thin temporary lines drawn while a panel is dragged,
// where its edges or centre line up with another panel's (computed in
// panel-manager.js). Purely visual - they never move anything.

let layer = null;

function ensureLayer() {
    if (!layer || !layer.isConnected) {
        layer = document.createElement('div');
        layer.className = 'pp-guides';
        layer.setAttribute('aria-hidden', 'true');
        document.body.appendChild(layer);
    }
    return layer;
}

// lines: [{ axis: 'x' | 'y', at, from, to }] in viewport pixels. An 'x'
// line is vertical at x = at, from y = from to y = to.
export function showGuides(lines) {
    const root = ensureLayer();
    const seen = new Set();
    root.replaceChildren(...lines.flatMap((line) => {
        const key = `${line.axis}:${Math.round(line.at)}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const el = document.createElement('div');
        el.className = `pp-guide pp-guide-${line.axis}`;
        if (line.axis === 'x') {
            Object.assign(el.style, { left: `${Math.round(line.at)}px`, top: `${line.from - 8}px`, height: `${line.to - line.from + 16}px` });
        } else {
            Object.assign(el.style, { top: `${Math.round(line.at)}px`, left: `${line.from - 8}px`, width: `${line.to - line.from + 16}px` });
        }
        return [el];
    }));
}

export function clearGuides() {
    layer?.replaceChildren();
}
