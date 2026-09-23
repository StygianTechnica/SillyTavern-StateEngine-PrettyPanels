// Panel Library: reusable panel templates. A template is a design asset
// (see src/storage/design.js) - inserting one creates an independent
// instance, and editing either side never affects the other. Nothing in
// here reads or writes the active layout.

import { getStore, save, generateId, uniqueName, emitLibraryChange } from '../storage/store.js';
import { pickDesign } from '../storage/design.js';
import { KIND, makePayload } from './format.js';

function templateNames(store) {
    return Object.values(store.templates).map((t) => t.name);
}

function summary(template) {
    return { id: template.id, name: template.name, width: template.width, height: template.height };
}

export function listTemplates() {
    return Object.values(getStore().templates)
        .filter((t) => t && typeof t.id === 'string')
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .map(summary);
}

// A full copy of the template's design, safe to hand to an instance.
export function getTemplate(id) {
    const template = getStore().templates[id];
    return template ? { id: template.id, name: template.name, ...pickDesign(template) } : null;
}

// Creates a template from any design source (a panel instance or
// imported data). Returns its summary.
export function createTemplate(name, source) {
    const store = getStore();
    const now = Date.now();
    const template = {
        id: generateId('ppt'),
        name: uniqueName(name || 'Panel Template', templateNames(store)),
        createdAt: now,
        updatedAt: now,
        ...pickDesign(source),
    };
    store.templates[template.id] = template;
    save();
    emitLibraryChange();
    return summary(template);
}

// Replaces a template's design, keeping its ID, name and creation time.
export function overwriteTemplate(id, source) {
    const store = getStore();
    const current = store.templates[id];
    if (!current) return null;
    store.templates[id] = {
        id,
        name: current.name,
        createdAt: current.createdAt,
        updatedAt: Date.now(),
        ...pickDesign(source),
    };
    save();
    emitLibraryChange();
    return summary(store.templates[id]);
}

export function renameTemplate(id, name) {
    const store = getStore();
    const template = store.templates[id];
    if (!template || !name || template.name === name) return false;
    template.name = uniqueName(name, templateNames(store).filter((n) => n !== template.name));
    save();
    emitLibraryChange();
    return true;
}

export function deleteTemplate(id) {
    const store = getStore();
    if (!store.templates[id]) return false;
    delete store.templates[id];
    save();
    emitLibraryChange();
    return true;
}

// Export payload for any design source - a stored template or a live
// panel instance straight from its properties pane.
export function templatePayload(name, source) {
    return makePayload(KIND.PANEL_TEMPLATE, { name, ...pickDesign(source) });
}

export function exportTemplate(id) {
    const template = getStore().templates[id];
    return template ? templatePayload(template.name, template) : null;
}

// `data` is the already-validated payload data (see format.js
// readPayload). Never touches the active layout.
export function importTemplate(data) {
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Panel';
    return createTemplate(name, data);
}
