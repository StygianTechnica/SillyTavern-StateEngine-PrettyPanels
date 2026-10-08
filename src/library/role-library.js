// Layout roles: State Engine roles Pretty Panels defines, in its own
// namespace ("prettyPanels__scene.title"). A layout carries a set of roles
// (layout.roles: public names); the definitions live once, in the store's
// role registry (store.roles: { [publicName]: { type, label, description } }),
// because a namespace never has two roles with the same name - two layouts
// wanting "scene.title" SHARE that one role. A role leaves the registry
// when the last layout carrying it removes it.
//
// Roles are global in State Engine (every chat sees them); which variable
// fulfils one is chosen per chat. src/chat/role-sync.js sends the registry
// to State Engine whenever it changes. Nothing here talks to State Engine.

import { getStore, save, emitLibraryChange, clone } from '../storage/store.js';
import { ROLE_PUBLIC_NAME, layoutRoleId } from '../elements/element-model.js';

// State Engine's role types.
export const ROLE_TYPES = ['text', 'number', 'boolean', 'date', 'image', 'list', 'any'];
const MAX_PUBLIC_NAME_LENGTH = 64;

const changeListeners = new Set();

// The registry changed (a role added, renamed, retyped or removed) - what
// State Engine must be told.
function emitRolesChange(change = {}) {
    save();
    emitLibraryChange();
    for (const listener of changeListeners) listener(change);
}

export function onLayoutRolesChange(listener) {
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
}

export function isValidRoleName(name) {
    return typeof name === 'string' && name.length <= MAX_PUBLIC_NAME_LENGTH && ROLE_PUBLIC_NAME.test(name);
}

function nameError(name) {
    return isValidRoleName(name) ? null : 'Use lowercase words separated by dots, e.g. "scene.title" (letters, digits and _, max 64).';
}

// Every role in the registry, for State Engine: [{ publicName, type, label, description }].
export function registrySpecs() {
    return Object.entries(getStore().roles)
        .map(([publicName, def]) => ({ publicName, type: def.type, label: def.label ?? '', description: def.description ?? '' }))
        .sort((a, b) => a.publicName.localeCompare(b.publicName));
}

// The layouts (names) carrying role `publicName`.
export function layoutsUsingRole(publicName) {
    return Object.values(getStore().layouts).filter((l) => l.roles.includes(publicName)).map((l) => l.name);
}

// Layout `layoutId`'s roles: [{ publicName, id, type, label, description, sharedWith: [layout names] }].
export function listLayoutRoles(layoutId) {
    const store = getStore();
    const layout = store.layouts[layoutId];
    if (!layout) return [];
    return layout.roles
        .filter((name) => store.roles[name])
        .map((publicName) => ({
            publicName,
            id: layoutRoleId(publicName),
            ...clone(store.roles[publicName]),
            sharedWith: layoutsUsingRole(publicName).filter((n) => n !== layout.name),
        }))
        .sort((a, b) => a.publicName.localeCompare(b.publicName));
}

// Adds role `publicName` to a layout. A role the registry already has (another
// layout's) is SHARED - its type stays (the result says so). Returns
// { ok: true, shared, type } or { ok: false, error }.
export function addLayoutRole(layoutId, { publicName, type = 'text' }) {
    const store = getStore();
    const layout = store.layouts[layoutId];
    if (!layout) return { ok: false, error: 'No such layout.' };
    const error = nameError(publicName);
    if (error) return { ok: false, error };
    if (layout.roles.includes(publicName)) return { ok: false, error: `This layout already has the role "${publicName}".` };
    const existing = store.roles[publicName];
    if (!existing) {
        if (!ROLE_TYPES.includes(type)) return { ok: false, error: `Unknown type "${type}".` };
        store.roles[publicName] = { type, label: '', description: '' };
    }
    layout.roles = [...layout.roles, publicName];
    emitRolesChange();
    return { ok: true, shared: !!existing, type: store.roles[publicName].type };
}

// Removes role `publicName` from a layout; when no other layout carries it,
// it leaves the registry (and State Engine deletes it, with its assignments).
// Returns true if the layout had it.
export function removeLayoutRole(layoutId, publicName) {
    const store = getStore();
    const layout = store.layouts[layoutId];
    if (!layout || !layout.roles.includes(publicName)) return false;
    layout.roles = layout.roles.filter((n) => n !== publicName);
    if (layoutsUsingRole(publicName).length === 0) delete store.roles[publicName];
    emitRolesChange();
    return true;
}

// Renames role `from` to `to` everywhere: the registry, every layout that
// carries it, and every element bound to it. The change carries
// { renamed: { from, to } } so role-sync.js renames it in State Engine
// (keeping every chat's assignment) before sending the registry. Returns
// { ok: true } or { ok: false, error }.
export function renameLayoutRole(from, to) {
    const store = getStore();
    if (!store.roles[from]) return { ok: false, error: `No role "${from}".` };
    const error = nameError(to);
    if (error) return { ok: false, error };
    if (from === to) return { ok: true };
    if (store.roles[to]) return { ok: false, error: `A role named "${to}" already exists.` };
    store.roles[to] = store.roles[from];
    delete store.roles[from];
    const fromId = layoutRoleId(from);
    const toId = layoutRoleId(to);
    for (const layout of Object.values(store.layouts)) {
        layout.roles = layout.roles.map((n) => (n === from ? to : n));
        for (const panel of Object.values(layout.panels)) {
            for (const widget of panel.widgets ?? []) {
                if (widget?.binding?.role === fromId) widget.binding = { role: toId };
            }
        }
    }
    emitRolesChange({ renamed: { from: fromId, to } });
    return { ok: true };
}

// Changes a role's type (for every layout sharing it).
export function setLayoutRoleType(publicName, type) {
    const store = getStore();
    if (!store.roles[publicName] || !ROLE_TYPES.includes(type) || store.roles[publicName].type === type) return false;
    store.roles[publicName] = { ...store.roles[publicName], type };
    emitRolesChange();
    return true;
}

// For a layout export: the layout's role definitions.
export function exportLayoutRoles(layout) {
    const store = getStore();
    return layout.roles.filter((n) => store.roles[n]).map((publicName) => ({ publicName, ...clone(store.roles[publicName]) }));
}

// For a layout import: adds `roles` ([{ publicName, type, ... }]) to the
// registry - a name it already has keeps its own definition (shared) - and
// returns the valid public names, for the imported layout's roles. Returns
// { names, conflicts: [names whose imported type differed] }.
export function importLayoutRoles(roles) {
    const store = getStore();
    const names = [];
    const conflicts = [];
    for (const role of Array.isArray(roles) ? roles : []) {
        const publicName = typeof role?.publicName === 'string' ? role.publicName.trim() : '';
        if (!isValidRoleName(publicName) || names.includes(publicName)) continue;
        const type = ROLE_TYPES.includes(role.type) ? role.type : 'any';
        if (store.roles[publicName]) {
            if (store.roles[publicName].type !== type) conflicts.push(publicName);
        } else {
            store.roles[publicName] = {
                type,
                label: typeof role.label === 'string' ? role.label.slice(0, 100) : '',
                description: typeof role.description === 'string' ? role.description.slice(0, 500) : '',
            };
        }
        names.push(publicName);
    }
    return { names, conflicts };
}

// Lets an importer announce registry additions once it has stored the layout.
export function announceRolesChange() {
    emitRolesChange();
}

// Drops registry roles no layout carries any more (after a layout was
// deleted). Returns true if any were dropped (and announces it).
export function pruneUnusedRoles() {
    const store = getStore();
    const used = new Set(Object.values(store.layouts).flatMap((l) => l.roles));
    const unused = Object.keys(store.roles).filter((name) => !used.has(name));
    for (const name of unused) delete store.roles[name];
    if (unused.length) emitRolesChange();
    return unused.length > 0;
}
