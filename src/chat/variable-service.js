// Live State Engine variable data for display:
//   - the CATALOG: every preset in every namespace with its variables
//     (for the variable picker and the element Binding field), and
//   - current VALUES for the variable names the active layout shows, and
//   - resolved IMAGES for the image variables panels use as backgrounds.
// Plain cache + listeners; src/chat/chat-session.js decides when to
// refresh (chat changes, State Engine's variables-changed event).
//
// Pretty Panels' own variables (extensionSettings.prettyPanelsVariables -
// theme asset images, src/storage/pp-variables.js) join the catalog as a
// "Pretty Panels" group and are answered here directly: they belong to no
// chat, so State Engine is never asked about them.
//
// The current chat's State Engine ROLES join it as a "Roles" group, each as
// a ref "role:<name>" (element-model.js ROLE_REF_PREFIX), so the picker, the
// Binding field and drag-and-drop offer them like variables. A role ref
// reads the variable the chat assigned to the role; with none assigned it
// has no value (the element shows blank).

import { EXTENSION_ID } from '../constants.js';
import { listAllVariables } from '../api/list-all-variables.js';
import { getVariableValues } from '../api/get-variable-values.js';
import { getVariableImage } from '../api/get-variable-image.js';
import { listRoles } from '../api/list-roles.js';
import { notify } from '../ui/dialogs.js';
import { listPPVariables, getPPVariable, ppVariableLabel, onPPVariablesChange } from '../storage/pp-variables.js';
import { isRoleRef, roleOfRef, roleRef } from '../elements/element-model.js';

// The catalog group holding Pretty Panels' own variables. Always "active"
// (there is no preset to activate for it).
export const PP_PRESET_ID = '__pretty_panels__';
// The catalog group holding the chat's roles.
export const ROLES_PRESET_ID = '__roles__';

// The chat's roles (State Engine listRoles entries), by name.
let roles = new Map();

function roleDefinition(role) {
    const target = role.variable ? `assigned to ${role.variable}` : 'not assigned in this chat';
    return {
        name: roleRef(role.name), type: role.type, label: role.label || role.name, role: role.name,
        description: `Role "${role.name}" (${role.type}) - ${target}${role.problem ? ` (${role.problem})` : ''}`,
    };
}

function rolesPreset() {
    const variables = [...roles.values()].map(roleDefinition).sort((a, b) => a.label.localeCompare(b.label));
    return variables.length ? [{ id: ROLES_PRESET_ID, name: 'Roles', namespace: 'roles', active: true, variables }] : [];
}

// The chat's role entry for a role name or ref, or null:
// { name, type, variable, valid, problem, requestedBy, ... }.
export function getRole(nameOrRef) {
    return roles.get(isRoleRef(nameOrRef) ? roleOfRef(nameOrRef) : nameOrRef) ?? null;
}

// The variable a ref reads: the ref itself, or a role's assigned variable
// (null if the role has none in this chat).
export function targetOf(ref) {
    if (!isRoleRef(ref)) return ref;
    return getRole(ref)?.variable ?? null;
}

// Re-reads the chat's roles. Never throws (an older State Engine without
// the Role API simply has no roles).
async function loadRoles(chatId) {
    if (!chatId) return new Map();
    try {
        return new Map(((await listRoles(EXTENSION_ID, chatId)) ?? []).map((role) => [role.name, role]));
    } catch (err) {
        console.warn('[PrettyPanels] could not read State Engine roles (update State Engine for role support)', err);
        return new Map();
    }
}

function ppDefinition(record) {
    return { name: record.name, type: 'image', label: ppVariableLabel(record.name), description: `Pretty Panels image variable (v${record.version})`, prettyPanels: true };
}

function ppPreset() {
    const variables = listPPVariables().map(ppDefinition).sort((a, b) => a.label.localeCompare(b.label));
    return variables.length ? [{ id: PP_PRESET_ID, name: 'Pretty Panels', namespace: 'prettyPanels', active: true, variables }] : [];
}

// Emitted by State Engine on SillyTavern's eventSource whenever variable
// values are saved (State Engine API Reference, "Variable Value API").
export const VARIABLES_CHANGED_EVENT = 'state_engine_variables_changed';

let values = new Map();
let watched = [];
let images = new Map();
let watchedImages = [];
let catalog = [];
let engineCatalog = [];
let refreshToken = 0;
const valueListeners = new Set();
const catalogListeners = new Set();
let warned = false;

// One warning per page load if State Engine is too old to have the
// Variable Value API - panels still work, elements just show no values.
function warnUnavailable(err) {
    console.warn('[PrettyPanels] State Engine variable reads failed', err);
    if (warned) return;
    warned = true;
    notify('warning', 'Pretty Panels could not read State Engine variables. Variable elements need a State Engine version with the Variable Value API.');
}

export function currentChatId() {
    try {
        const context = SillyTavern.getContext();
        const id = typeof context.getCurrentChatId === 'function' ? context.getCurrentChatId() : context.chatId;
        return id || null;
    } catch {
        return null;
    }
}

// { value, def } for a watched name in the current chat, or undefined.
// A Pretty Panels variable always has its value (its file's path).
// A role ref answers with its assigned variable's value (undefined when the
// role has none in this chat).
export function getValue(name) {
    const target = targetOf(name);
    if (!target) return undefined;
    const own = getPPVariable(target);
    if (own) return { value: own.value, def: ppDefinition(own) };
    return values.get(target);
}

// The image an image variable (or a role assigned one) is showing in the
// current chat (a display-safe source), or null.
export function getImage(name) {
    const target = targetOf(name);
    if (!target) return null;
    const own = getPPVariable(target);
    if (own) return own.value;
    return images.get(target) ?? null;
}

// Sets which names to keep values (and, for `imageNames`, resolved
// images) for, then refreshes them.
export function watchNames(names, imageNames = []) {
    watched = [...new Set(names)];
    watchedImages = [...new Set(imageNames)];
    return refreshValues();
}

export async function refreshValues() {
    const token = ++refreshToken;
    const chatId = currentChatId();
    const next = new Map();
    const nextImages = new Map();
    // Roles first: an assignment may have changed (State Engine reports role
    // changes with the same variables-changed event as value writes).
    const nextRoles = await loadRoles(chatId);
    if (token !== refreshToken) return;
    const resolve = (refs) => [...new Set(refs
        .map((ref) => (isRoleRef(ref) ? nextRoles.get(roleOfRef(ref))?.variable : ref))
        .filter(Boolean))];
    // Pretty Panels' own variables are answered locally (getValue/getImage).
    const engineNames = resolve(watched).filter((name) => !getPPVariable(name));
    const imageNames = resolve(watchedImages);
    if (chatId && engineNames.length > 0) {
        try {
            const read = await getVariableValues(EXTENSION_ID, chatId, engineNames);
            for (const name of engineNames) next.set(name, read?.[name]);
        } catch (err) {
            warnUnavailable(err);
        }
    }
    if (chatId) {
        for (const name of imageNames.filter((n) => !getPPVariable(n))) {
            try {
                nextImages.set(name, await getVariableImage(EXTENSION_ID, chatId, name));
            } catch (err) {
                warnUnavailable(err);
                break;
            }
        }
    }
    // A newer refresh (e.g. after a chat switch) already started - drop this one.
    if (token !== refreshToken) return;
    const rolesChanged = JSON.stringify([...nextRoles]) !== JSON.stringify([...roles]);
    roles = nextRoles;
    values = next;
    images = nextImages;
    // The picker's Roles group follows the chat's roles.
    if (rolesChanged) publishCatalog();
    for (const listener of valueListeners) listener();
}

export function onValuesChange(listener) {
    valueListeners.add(listener);
    return () => valueListeners.delete(listener);
}

// Re-reads the catalog (with `active` flags for the current chat).
export async function loadCatalog() {
    try {
        engineCatalog = (await listAllVariables(EXTENSION_ID, currentChatId())) ?? [];
    } catch (err) {
        warnUnavailable(err);
        engineCatalog = [];
    }
    return publishCatalog();
}

// State Engine's presets plus the Roles and Pretty Panels groups.
function publishCatalog() {
    catalog = [...rolesPreset(), ...ppPreset(), ...engineCatalog];
    for (const listener of catalogListeners) listener(catalog);
    return catalog;
}

// A new, replaced or deleted Pretty Panels variable: the picker lists it
// (or stops) and panels showing it redraw at once.
onPPVariablesChange(() => {
    publishCatalog();
    for (const listener of valueListeners) listener();
});

// Whether anything (an open properties pane) is showing the catalog.
export function isCatalogWatched() {
    return catalogListeners.size > 0;
}

// Called with the new catalog after every loadCatalog() - e.g. after
// presets were activated, so "inactive" markers stay current.
export function onCatalogChange(listener) {
    catalogListeners.add(listener);
    return () => catalogListeners.delete(listener);
}

export function getCatalog() {
    return catalog;
}

// The catalog entry (preset + display def) for a qualified name, or null.
export function findVariable(name) {
    for (const preset of catalog) {
        const def = preset.variables.find((v) => v.name === name);
        if (def) return { preset, def };
    }
    return null;
}
