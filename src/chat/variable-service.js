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
// State Engine ROLES (global; each chat assigns them a variable) are kept
// here too, for the role palette and the Binding field's Role mode. An
// element bound to a role uses the ref "role:<role id>" (element-model.js
// ROLE_REF_PREFIX); it reads the variable the current chat assigned to the
// role, and with none assigned it has no value (the element shows blank).

import { EXTENSION_ID } from '../constants.js';
import { listAllVariables } from '../api/list-all-variables.js';
import { getVariableValues } from '../api/get-variable-values.js';
import { getVariableImage } from '../api/get-variable-image.js';
import { listRoles } from '../api/list-roles.js';
import { listObjects } from '../api/list-objects.js';
import { listObjectTypes } from '../api/list-object-types.js';
import { notify } from '../ui/dialogs.js';
import { listPPVariables, getPPVariable, ppVariableLabel, onPPVariablesChange } from '../storage/pp-variables.js';
import { isRoleRef, roleOfRef, roleRef, isCharRef, charFieldOfRef } from '../elements/element-model.js';
import { getChatSetting } from '../api/get-chat-setting.js';
import { getObjectRuntimeFields } from '../api/get-object-runtime-fields.js';
import { setObjectNamer } from '../elements/text-format.js';
import { objectTypeOf } from '../elements/object-defs.js';
import { characterFieldList, characterFieldDef, objectsFieldValue, objectFieldList } from '../elements/character-fields.js';
import { getObjectFields } from '../api/get-object-fields.js';
import { CHARACTER_OBJECT_TYPE } from '../elements/object-defs.js';
import { archivistApi, withArchivistInsights, withAuthoredRelations } from './archivist-link.js';

// The catalog group holding Pretty Panels' own variables. Always "active"
// (there is no preset to activate for it).
export const PP_PRESET_ID = '__pretty_panels__';

// Every State Engine role (they are global), as seen from the current chat -
// its assignment and validity there: listRoles entries
// { id, namespace, publicName, type, label, description, exists,
//   requestedBy, variable, valid, problem }, by id.
let roles = new Map();
const roleListeners = new Set();

// Every role, sorted by public name then namespace (so roles sharing a
// public name sit together).
export function getRoleList() {
    return [...roles.values()];
}

// Called with the role list whenever it changes.
export function onRolesChange(listener) {
    roleListeners.add(listener);
    return () => roleListeners.delete(listener);
}

// The role entry for a role id or "role:<id>" ref, or null.
export function getRole(idOrRef) {
    return roles.get(isRoleRef(idOrRef) ? roleOfRef(idOrRef) : idOrRef) ?? null;
}

// A role as a display definition (the shape a variable's has), for
// labelling and formatting an element bound to it while it has no value.
function roleDefinition(role) {
    return { name: roleRef(role.id), type: role.type, label: role.label || role.publicName, role: role.id, namespace: role.namespace };
}

// The variable a ref reads: the ref itself, or a role's assigned variable
// (null if the role has none in this chat).
export function targetOf(ref) {
    const field = objectFieldRef(ref);
    if (field) {
        const base = targetOf(field.base);
        return base ? `${base}${OBJECT_FIELD_MARK}${field.field}` : null;
    }
    if (!isRoleRef(ref)) return ref;
    return getRole(ref)?.variable ?? null;
}

// "<variable or role ref>#<field>": a field of the object(s) that variable
// holds - "se__scene_location#has_image", "role:se__scene.location#confirmed",
// "pp__cast#present" - read like a card field (character-fields.js), as a
// flag for showing panels and elements only when there is something to show.
const OBJECT_FIELD_MARK = '#';
function objectFieldRef(ref) {
    if (typeof ref !== 'string') return null;
    const at = ref.lastIndexOf(OBJECT_FIELD_MARK);
    if (at <= 0) return null;
    const field = ref.slice(at + 1);
    return /^(?:[a-z_]+|(?:custom|archivist)\.[a-z][a-z0-9_]{0,39})$/.test(field) ? { base: ref.slice(0, at), field } : null;
}

// The variable (or role) ref a ref reads: itself, or a field ref's variable.
function baseRef(ref) {
    return objectFieldRef(ref)?.base ?? ref;
}

// Re-reads every role as seen from `chatId` (no chat: no assignments).
// Never throws (an older State Engine without the Role API has no roles).
async function loadRoles(chatId) {
    try {
        return new Map(((await listRoles(EXTENSION_ID, chatId || null)) ?? []).map((role) => [role.id, role]));
    } catch (err) {
        console.warn('[PrettyPanels] could not read State Engine roles (update State Engine for role support)', err);
        return new Map();
    }
}

// The open chat's characters - State Engine objects of type character, its
// own and its setting's (listObjects) - by id: what a character variable's
// ids show as. With Archivist installed, each carries what Archivist
// compiled about it as `archivist` (src/chat/archivist-link.js).
let characters = new Map();

// Any other object a card shows (a location, a faction...) comes from the
// objects the shown variables hold (otherObjects, below).
export function getCharacter(id) {
    return characters.get(id) ?? otherObjects.get(id) ?? null;
}

export function getCharacterList() {
    return [...characters.values()];
}

// The character fields a template can bind (the Character palette):
// identity, then the character runtime fields of the open chat's setting
// (Default without a chat). Never throws.
export async function loadCharacterFieldList() {
    try {
        const chatId = currentChatId();
        const settingId = (chatId ? await getChatSetting(EXTENSION_ID, chatId) : null) ?? 'default';
        return characterFieldList((await getObjectRuntimeFields(EXTENSION_ID, settingId, CHARACTER_OBJECT_TYPE)) ?? [], { archivist: !!archivistApi() });
    } catch (err) {
        console.warn('[PrettyPanels] could not read character runtime fields (update State Engine)', err);
        return characterFieldList([], { archivist: !!archivistApi() });
    }
}

// The fields a card template for `objectType` can bind ('' any object):
// see character-fields.js objectFieldList. Never throws.
// -> { type: { id, label, hasPresence } | null, fields: [...] }
export async function loadTemplateFieldList(objectType) {
    const archivist = !!archivistApi();
    let type = null;
    try {
        type = objectType ? ((await listObjectTypes()) ?? []).find((t) => t.id === objectType) ?? { id: objectType, label: objectType, hasPresence: false } : null;
        if (!type) return { type, fields: objectFieldList(null) };
        const chatId = currentChatId();
        const settingId = (chatId ? await getChatSetting(EXTENSION_ID, chatId) : null) ?? 'default';
        const [fields, runtimeFields] = await Promise.all([
            getObjectFields(EXTENSION_ID, settingId, type.id).catch(() => []),
            getObjectRuntimeFields(EXTENSION_ID, settingId, type.id).catch(() => []),
        ]);
        return { type, fields: objectFieldList(type, { fields: fields ?? [], runtimeFields: runtimeFields ?? [], archivist }) };
    } catch (err) {
        console.warn(`[PrettyPanels] could not read the ${objectType || 'object'} fields (update State Engine)`, err);
        return { type, fields: type?.id === CHARACTER_OBJECT_TYPE ? characterFieldList([], { archivist }) : objectFieldList(type) };
    }
}

// The open chat's objects of `objectType` ('' or null: its characters), for
// a template editor's preview. Never throws.
export async function listPreviewObjects(objectType) {
    if (!objectType || objectType === CHARACTER_OBJECT_TYPE) return getCharacterList();
    const chatId = currentChatId();
    if (!chatId) return [];
    try {
        return (await listObjects(EXTENSION_ID, chatId, objectType)) ?? [];
    } catch (err) {
        console.warn(`[PrettyPanels] could not read State Engine ${objectType} objects`, err);
        return [];
    }
}

// The object types State Engine knows: [{ id, label, plural, hasPresence }].
export async function listCardObjectTypes() {
    try {
        return ((await listObjectTypes()) ?? []).map((t) => ({ id: t.id, label: t.label, plural: t.plural, hasPresence: !!t.hasPresence }));
    } catch {
        return [{ id: CHARACTER_OBJECT_TYPE, label: 'Character', plural: 'Characters', hasPresence: true }];
    }
}

// The other objects (locations, factions...) the shown object variables
// hold, and the characters' own fields and runtime state refer to (a
// character's factions),
// by id - read after the values, for the types they hold; what a text
// element or a card field shows for them is the name (text-format.js
// setObjectNamer).
let otherObjects = new Map();
setObjectNamer((id) => otherObjects.get(id)?.name ?? characters.get(id)?.name ?? null);

const OBJECT_ID = /^([a-z]{3})_[\w-]+$/;

async function loadOtherObjects(chatId, read, characterList) {
    const types = new Set();
    for (const entry of read.values()) {
        const type = objectTypeOf(entry?.def);
        if (type && type !== CHARACTER_OBJECT_TYPE) types.add(type);
    }
    // Object types are named by their id prefix ("fac_..."): the prefixes
    // the characters refer to, as State Engine's registry names them.
    const prefixes = new Set();
    for (const character of characterList.values()) {
        // Baseline fields, runtime state and starting values (a character's factions).
        const held = [...Object.values(character?.base ?? {}), ...Object.values(character?.runtime?.values ?? {}), ...Object.values(character?.startValues ?? {})];
        for (const value of held) {
            for (const v of (Array.isArray(value) ? value : [value])) {
                const prefix = typeof v === 'string' ? OBJECT_ID.exec(v)?.[1] : null;
                if (prefix) prefixes.add(prefix);
            }
        }
    }
    if (prefixes.size) {
        for (const t of (await listObjectTypes()) ?? []) if (prefixes.has(t.idPrefix) && t.id !== CHARACTER_OBJECT_TYPE) types.add(t.id);
    }
    const objects = new Map();
    for (const type of types) {
        try {
            for (const object of (await listObjects(EXTENSION_ID, chatId, type)) ?? []) objects.set(object.id, object);
        } catch (err) {
            console.warn(`[PrettyPanels] could not read State Engine ${type} objects`, err);
        }
    }
    return objects;
}

async function loadCharacters(chatId) {
    if (!chatId) return new Map();
    try {
        const list = new Map(((await listObjects(EXTENSION_ID, chatId, CHARACTER_OBJECT_TYPE)) ?? []).map((c) => [c.id, c]));
        return await withAuthoredRelations(await withArchivistInsights(chatId, list));
    } catch (err) {
        console.warn('[PrettyPanels] could not read State Engine characters (update State Engine for object support)', err);
        return new Map();
    }
}

// Re-reads the roles now (the role palette, the drawer's Layout Roles).
export async function refreshRoles() {
    const next = await loadRoles(currentChatId());
    if (JSON.stringify([...next]) === JSON.stringify([...roles])) return roles;
    roles = next;
    for (const listener of roleListeners) listener(getRoleList());
    for (const listener of valueListeners) listener();
    return roles;
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
// Refs read for the flag watcher (src/chat/flag-watch.js) on top of the
// layout's own, so a flag is followed even when no element shows it.
let watcherRefs = [];
// The chat the current values were read for (they can briefly lag a chat
// switch while the next refresh runs), and the refs that refresh read.
let valuesChat = null;
let readRefs = new Set();
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
    const field = objectFieldRef(name);
    if (field) {
        const held = getValue(field.base);
        if (held === undefined) return undefined;
        const ids = held.value;
        const objects = Array.isArray(ids) ? ids.map(getCharacter) : (typeof ids === 'string' && ids ? getCharacter(ids) : null);
        const value = objectsFieldValue(objects, field.field);
        return { value, def: { name, type: typeof value === 'boolean' ? 'boolean' : 'string', label: `${field.base} ${field.field}` } };
    }
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

// The chat the current values belong to.
export function valuesChatId() {
    return valuesChat;
}

// Whether the last completed refresh read `ref` (a ref watched since then
// has no value yet - it is not "missing").
export function wasRead(ref) {
    return readRefs.has(ref);
}

// Sets the refs the flag watcher needs read, then refreshes.
export function setWatcherRefs(refs) {
    watcherRefs = [...new Set(refs)];
    return refreshValues();
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
    const refsRead = new Set([...watched, ...watcherRefs]);
    const next = new Map();
    const nextImages = new Map();
    // Roles first: an assignment may have changed (State Engine reports role
    // changes with the same variables-changed event as value writes).
    const nextRoles = await loadRoles(chatId);
    const nextCharacters = await loadCharacters(chatId);
    if (token !== refreshToken) return;
    const resolve = (refs) => [...new Set(refs
        .map(baseRef)
        .map((ref) => (isRoleRef(ref) ? nextRoles.get(roleOfRef(ref))?.variable : ref))
        .filter(Boolean))];
    // Pretty Panels' own variables are answered locally (getValue/getImage).
    const engineNames = resolve([...watched, ...watcherRefs]).filter((name) => !getPPVariable(name));
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
    const nextObjects = chatId ? await loadOtherObjects(chatId, next, nextCharacters) : new Map();
    // A newer refresh (e.g. after a chat switch) already started - drop this one.
    if (token !== refreshToken) return;
    const rolesChanged = JSON.stringify([...nextRoles]) !== JSON.stringify([...roles]);
    roles = nextRoles;
    characters = nextCharacters;
    otherObjects = nextObjects;
    values = next;
    valuesChat = chatId;
    readRefs = refsRead;
    images = nextImages;
    if (rolesChanged) for (const listener of roleListeners) listener(getRoleList());
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

// State Engine's presets plus the Pretty Panels group.
function publishCatalog() {
    catalog = [...ppPreset(), ...engineCatalog];
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
// A role ref answers with the role as a display definition.
export function findVariable(name) {
    // A character field (character templates): its display definition.
    if (isCharRef(name)) return { preset: { id: '__character__', name: 'Character', namespace: '', active: true }, def: characterFieldDef(charFieldOfRef(name)) };
    if (isRoleRef(name)) {
        const role = getRole(name);
        return role ? { preset: { id: '__roles__', name: 'Roles', namespace: role.namespace, active: true }, def: roleDefinition(role) } : null;
    }
    for (const preset of catalog) {
        const def = preset.variables.find((v) => v.name === name);
        if (def) return { preset, def };
    }
    return null;
}
