// Character Templates: panels drawn once per character inside a Character
// element (src/elements/character-tiles.js) - a portrait card, a mood
// badge, a whole status sheet. A character template is a panel DESIGN
// (src/storage/design.js: size, styling, theme and variant, elements) of a
// different class: it is never part of a layout, has no position or anchor,
// and is edited in the temporary template editor (src/panels/
// template-editor.js) with the ordinary panel tools.
//
// A template has an OBJECT TYPE: '' for any object (only the fields every
// object has), or one State Engine type - 'character', 'location', 'item'...
// - whose own fields the palette then offers (character-fields.js
// objectFieldList). A Character element offers the templates for the type
// it shows, and those for any object. Templates made before types existed
// were character templates, and stay so.
//
// Unlike Panel Library templates, a character template KEEPS its bindings:
// its elements show the card's character's fields ({ char: "name" },
// character-fields.js) and may also show variables and roles. `roles` lists
// the Pretty Panels roles (public names) its elements use, so they stay in
// the role registry and travel with an export.

import { NAMESPACE } from '../constants.js';
import { getStore, save, generateId, uniqueName, emitLibraryChange, clone } from '../storage/store.js';
import { pickDesign, MIN_CARD_WIDTH, MIN_CARD_HEIGHT } from '../storage/design.js';
import { KIND, makePayload } from './format.js';
import { createVariableElement, isVariableElement, bindingRef, parseRoleId, isCharRef } from '../elements/element-model.js';
import { clockImageVariables } from '../elements/clock.js';
import { importLayoutRoles, announceRolesChange } from './role-library.js';
import { defaultThemeChoice } from '../themes/theme-store.js';

export const DEFAULT_CARD_WIDTH = 160;
export const DEFAULT_CARD_HEIGHT = 200;

const changeListeners = new Set();

// Any change to a template (its design too): Character elements redraw.
function emitChange() {
    save();
    emitLibraryChange();
    for (const listener of changeListeners) listener();
}

export function onCharacterTemplatesChange(listener) {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
}

// What a character template holds: the design without placement.
function templateDesign(source) {
    const { x: _x, y: _y, anchorMode: _mode, anchorTarget: _target, ...design } = pickDesign(source, { width: MIN_CARD_WIDTH, height: MIN_CARD_HEIGHT });
    return { ...design, roles: rolesOf(design.widgets) };
}

// The Pretty Panels roles (public names) a template's elements are bound to.
function rolesOf(widgets) {
    const names = new Set();
    for (const widget of widgets) {
        const role = parseRoleId(widget?.binding?.role);
        if (role && role.namespace === NAMESPACE) names.add(role.publicName);
    }
    return [...names].sort();
}

function names(store) {
    return Object.values(store.characterTemplates).map((t) => t.name);
}

// A template's object type: '' (any object) or a type id. Missing (made
// before types): 'character'.
const TYPE_ID = /^[a-z][a-z0-9_]{0,39}$/;
export function templateObjectType(template) {
    const type = template?.objectType;
    if (type === undefined || type === null) return 'character';
    return typeof type === 'string' && (type === '' || TYPE_ID.test(type)) ? type : '';
}

// Whether a template suits an element showing objects of `objectType`
// (null: unknown - every template does).
export function templateFits(template, objectType) {
    const own = templateObjectType(template);
    return !objectType || own === '' || own === objectType;
}

function summary(template) {
    return { id: template.id, name: template.name, width: template.width, height: template.height, objectType: templateObjectType(template) };
}

export function listCharacterTemplates() {
    return Object.values(getStore().characterTemplates)
        .filter((t) => t && typeof t.id === 'string')
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
        .map(summary);
}

// A full copy of a template: { id, name, width, height, style, widgets, ... }.
export function getCharacterTemplate(id) {
    const template = id ? getStore().characterTemplates[id] : null;
    return template ? { id: template.id, name: template.name, objectType: templateObjectType(template), ...templateDesign(template) } : null;
}

// A new template's starting point: the character's portrait above its name.
function starterDesign() {
    return {
        width: DEFAULT_CARD_WIDTH,
        height: DEFAULT_CARD_HEIGHT,
        ...defaultThemeChoice(),
        widgets: [
            createVariableElement({ x: 8, y: 8, width: DEFAULT_CARD_WIDTH - 32, height: 128, binding: { char: 'image' }, showLabel: false, opacity: 1, fit: 'cover', clipShape: 'rectangle', borderRadius: 8, zIndex: 1 }),
            createVariableElement({ x: 8, y: 144, width: DEFAULT_CARD_WIDTH - 32, height: 28, binding: { char: 'name' }, showLabel: false }),
        ],
    };
}

// Creates a template from `source` (a design), or the starter card, for
// `objectType` ('' any object; default: the source's, else any object).
// Returns its summary.
export function createCharacterTemplate(name, source = null, objectType = undefined) {
    const store = getStore();
    const now = Date.now();
    const type = templateObjectType({ objectType: objectType ?? (source ? templateObjectType(source) : '') });
    const template = {
        id: generateId('ppc'),
        name: uniqueName(name || 'Card', names(store)),
        objectType: type,
        createdAt: now,
        updatedAt: now,
        ...templateDesign(source ?? starterDesign()),
    };
    store.characterTemplates[template.id] = template;
    emitChange();
    return summary(template);
}

// Merges design fields (width, height, style, widgets, themeId, ...) into a
// template. Returns the full template, or null.
export function updateCharacterTemplate(id, patch) {
    const store = getStore();
    const current = store.characterTemplates[id];
    if (!current) return null;
    const { id: _id, name: _name, createdAt: _created, objectType: _type, ...rest } = patch;
    store.characterTemplates[id] = {
        id,
        name: current.name,
        objectType: templateObjectType(current),
        createdAt: current.createdAt,
        updatedAt: Date.now(),
        ...templateDesign({ ...current, ...rest }),
    };
    emitChange();
    return getCharacterTemplate(id);
}

// Sets which objects a template is for ('' any object).
export function setTemplateObjectType(id, objectType) {
    const template = getStore().characterTemplates[id];
    const type = templateObjectType({ objectType: objectType ?? '' });
    if (!template || templateObjectType(template) === type) return false;
    template.objectType = type;
    template.updatedAt = Date.now();
    emitChange();
    return true;
}

export function renameCharacterTemplate(id, name) {
    const store = getStore();
    const template = store.characterTemplates[id];
    if (!template || !name || template.name === name) return false;
    template.name = uniqueName(name, names(store).filter((n) => n !== template.name));
    emitChange();
    return true;
}

export function duplicateCharacterTemplate(id) {
    const template = getCharacterTemplate(id);
    return template ? createCharacterTemplate(template.name, clone(template)) : null;
}

export function deleteCharacterTemplate(id) {
    const store = getStore();
    if (!store.characterTemplates[id]) return false;
    delete store.characterTemplates[id];
    emitChange();
    return true;
}

// The variable and role refs a template's elements show (character fields
// excluded - they come from each card's character), and its image
// variables (a background, clock images): what a layout using it must
// watch.
export function templateBindings(id) {
    const template = getCharacterTemplate(id);
    if (!template) return { refs: [], images: [] };
    const refs = new Set();
    const images = new Set();
    for (const widget of template.widgets) {
        const ref = isVariableElement(widget) ? bindingRef(widget.binding) : null;
        if (ref && !isCharRef(ref)) refs.add(ref);
        if (widget.visibleWhen?.flag && !isCharRef(widget.visibleWhen.flag)) refs.add(widget.visibleWhen.flag);
        for (const name of clockImageVariables(widget)) images.add(name);
    }
    const background = template.style?.backgroundImageVariable;
    if (typeof background === 'string' && background) images.add(background);
    for (const name of images) refs.add(name);
    return { refs: [...refs], images: [...images] };
}

// Every Pretty Panels role any character template uses (public names).
export function characterTemplateRoles() {
    return [...new Set(Object.values(getStore().characterTemplates).flatMap((t) => (Array.isArray(t?.roles) ? t.roles : [])))];
}

// Export payload: the design WITH its bindings, plus the definitions of the
// Pretty Panels roles it uses.
export function exportCharacterTemplate(id) {
    const template = getCharacterTemplate(id);
    if (!template) return null;
    const registry = getStore().roles;
    const roles = template.roles.filter((n) => registry[n]).map((publicName) => ({ publicName, ...clone(registry[publicName]) }));
    const { id: _id, ...data } = template;
    return makePayload(KIND.CHARACTER_TEMPLATE, { ...data, roleDefinitions: roles });
}

// `data` is the validated payload data (format.js readPayload). Its roles
// join the registry (a name already there keeps its own definition).
// Returns { summary, conflicts }.
export function importCharacterTemplate(data) {
    const { conflicts } = importLayoutRoles(data.roleDefinitions);
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported Character Card';
    const saved = createCharacterTemplate(name, data, templateObjectType(data));
    announceRolesChange();
    return { summary: saved, conflicts };
}
