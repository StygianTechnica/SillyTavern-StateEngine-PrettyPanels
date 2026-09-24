// FontPreviewRenderer: draws sample text in a font, with weight, style
// and variable-axis settings, into a DOM element. DOM (not canvas) because
// canvas cannot set arbitrary variation axes (MONO, CASL, wdth...), and the
// preview must look exactly like the panel will.

import { fontRegistry } from './font-registry.js';

// { fontWeight, fontStyle, fontAxes } -> the CSS properties that draw them.
// Shared with Element Styling so previews and panels can never disagree.
export function fontVariationCss({ fontWeight, fontStyle, fontAxes } = {}) {
    const axes = fontAxes && typeof fontAxes === 'object'
        ? Object.entries(fontAxes).filter(([tag, v]) => /^[A-Za-z0-9]{4}$/.test(tag) && tag !== 'wght' && Number.isFinite(v))
        : [];
    return {
        fontWeight: Number.isFinite(fontWeight) ? String(Math.min(1000, Math.max(1, Math.round(fontWeight)))) : null,
        fontStyle: fontStyle === 'italic' ? 'italic' : null,
        fontVariationSettings: axes.length ? axes.map(([tag, v]) => `"${tag}" ${v}`).join(', ') : null,
    };
}

export class FontPreviewRenderer {
    // container: element to draw into (its content is replaced).
    constructor(container) {
        this.container = container;
        this.sample = document.createElement('div');
        this.sample.className = 'pp-font-preview-sample';
        container.replaceChildren(this.sample);
        this.token = 0;
    }

    // Draws `text` in font `fontId`. Resolves once the font has loaded
    // (a later render() supersedes an earlier one still loading).
    async render({ fontId, text, size = 22, fontWeight, fontStyle, fontAxes }) {
        const token = ++this.token;
        const css = fontVariationCss({ fontWeight, fontStyle, fontAxes });
        Object.assign(this.sample.style, {
            fontFamily: fontRegistry.cssFamily(fontId),
            fontSize: `${size}px`,
            fontWeight: css.fontWeight ?? '',
            fontStyle: css.fontStyle ?? '',
            fontVariationSettings: css.fontVariationSettings ?? '',
        });
        this.sample.textContent = text || 'The quick brown fox jumps over the lazy dog';
        this.container.classList.add('pp-font-preview-loading');
        await fontRegistry.loadFont(fontId);
        if (token === this.token) this.container.classList.remove('pp-font-preview-loading');
    }
}
