// Glue between the font system and file import/export: exports get a
// `fonts` section (FontExportAssembler), imports have their embedded
// fonts re-sanitized and element font ids remapped before the layout or
// template is added. Used by the Layout/Panel Library drawer and the
// panel properties' Export button.

import { assembleFonts, importEmbeddedFonts } from '../fonts/font-export.js';
import { fontIdsInWidgets, remapWidgetFonts } from '../fonts/font-registry.js';
import { notify } from './dialogs.js';

function payloadWidgets(data) {
    if (Array.isArray(data?.panels)) return data.panels.flatMap((p) => (Array.isArray(p?.widgets) ? p.widgets : []));
    return Array.isArray(data?.widgets) ? data.widgets : [];
}

// Adds data.fonts to an export payload (layout or panel template) when
// its elements use any non-system font. Resolves the payload, or null
// (after telling the user) if a font could not be embedded.
export async function attachFonts(payload) {
    try {
        const fonts = await assembleFonts(fontIdsInWidgets(payloadWidgets(payload.data)));
        if (fonts) payload.data.fonts = fonts;
        return payload;
    } catch (err) {
        notify('error', `Export cancelled: ${err.message}`);
        return null;
    }
}

// Re-sanitizes an imported file's embedded fonts and points its elements
// at the resulting font ids. Throws (with a user-safe message) if any
// embedded font is rejected - nothing is imported then.
export async function receiveFonts(data) {
    if (!data?.fonts) return data;
    const count = Array.isArray(data.fonts.faces) ? data.fonts.faces.length : 0;
    if (count) notify('info', `Checking ${count} embedded font(s)…`);
    const remap = await importEmbeddedFonts(data.fonts);
    const { fonts: _embedded, ...rest } = data;
    if (Array.isArray(rest.panels)) {
        rest.panels = rest.panels.map((p) => (p && typeof p === 'object' ? { ...p, widgets: remapWidgetFonts(p.widgets, remap) } : p));
    } else if (Array.isArray(rest.widgets)) {
        rest.widgets = remapWidgetFonts(rest.widgets, remap);
    }
    return rest;
}
