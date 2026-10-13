// The shared Object Manager (it began as the Character Manager): State
// Engine's OBJECTS of every type - characters, locations, factions, items,
// creatures, lore, quests, scenes, events (State Engine API Reference,
// "Object API"); a dropdown in the header picks the type. The window lives
// here; every piece of data and every rule lives in State Engine - this
// module only calls its Object API (src/api/*). It opens from a
// CharacterCard click, the Pretty Panels drawer, State Engine's drawer
// ("Manage objects") and State Engine's "New ... detected for review"
// notifications (the last two through registerObjectManager(), on the type
// they are about).
//
// Confirmed <=> in the setting (State Engine's rule): a world object
// detected in a chat is unconfirmed and only in that chat until it is
// reviewed - confirmed as it is, edited and saved (which confirms it), or
// RESOLVED to an existing one (its detected name becomes that one's alias).
// There is no separate "add to setting". Story objects (quests, scenes,
// events) belong to their chat and are always confirmed.
//
// Three views:
//   This chat - the open chat's objects of the type: its unconfirmed ones
//     and its setting's, with presence; the chat's setting is chosen here.
//     Edit, confirm, resolve, merge, delete; filter to unconfirmed.
//   Settings - any setting's canonical objects of the type (default: the
//     chat's setting): create, edit, merge, delete; settings themselves are
//     created, renamed, deleted and set to auto-confirm here. Not for story
//     types.
//   Runtime fields - a setting's runtime field definitions for the type
//     (string, number or enum; prompted or not). Edited as a draft, then saved.
// The editor's fields are the setting's object preset's baseline fields
// (State Engine getObjectFields): text, long text, choices, numbers, lists,
// and references to other objects (a character's factions) - shown and
// typed as names, which State Engine matches or records; a variant does not
// override references. Editing an object edits its baseline (for a
// canonical one, in every chat on its setting) and confirms it. Each world
// object has variants and one active variant. In This chat, each object also
// shows its runtime state: prompted values read-only (the prompted update
// writes them each turn), non-prompted ones editable.

import { EXTENSION_ID } from '../constants.js';
import { listSettings } from '../api/list-settings.js';
import { createSetting } from '../api/create-setting.js';
import { updateSetting } from '../api/update-setting.js';
import { deleteSetting } from '../api/delete-setting.js';
import { getChatSetting } from '../api/get-chat-setting.js';
import { setChatSetting } from '../api/set-chat-setting.js';
import { ensureChatSetting } from '../api/ensure-chat-setting.js';
import { listObjects } from '../api/list-objects.js';
import { createObject } from '../api/create-object.js';
import { updateObject } from '../api/update-object.js';
import { mergeObjects } from '../api/merge-objects.js';
import { deleteObject } from '../api/delete-object.js';
import { confirmObject } from '../api/confirm-object.js';
import { resolveObject } from '../api/resolve-object.js';
import { addObjectVariant } from '../api/add-object-variant.js';
import { updateObjectVariant } from '../api/update-object-variant.js';
import { deleteObjectVariant } from '../api/delete-object-variant.js';
import { setObjectActiveVariant } from '../api/set-object-active-variant.js';
import { registerObjectManager } from '../api/register-object-manager.js';
import { getObjectRuntimeFields } from '../api/get-object-runtime-fields.js';
import { setObjectRuntimeFields } from '../api/set-object-runtime-fields.js';
import { setObjectRuntimeValue } from '../api/set-object-runtime-value.js';
import { CHARACTER_OBJECT_TYPE } from '../elements/object-defs.js';
import { listObjectTypes } from '../api/list-object-types.js';
import { getObjectFields } from '../api/get-object-fields.js';
import { importImageFile } from '../api/import-image-file.js';
import { VARIABLES_CHANGED_EVENT, currentChatId, refreshValues } from '../chat/variable-service.js';
import { fallbackIcon } from '../elements/character-card.js';
import { objectDisplayName } from '../elements/text-format.js';
import { confirmYesNo, promptText, notify, chooseFromList } from './dialogs.js';
import { pickImageFile } from './image-upload.js';
import { exportImageSet, importImageSet, chooseBuiltInImageSet } from './image-sets.js';

const IMAGE_FOLDER = 'characters';
// Field types the editor has an input for (images are set elsewhere).
const EDITABLE_TYPES = new Set(['string', 'number', 'boolean', 'enum', 'array', 'object']);

const state = {
    open: false,
    type: CHARACTER_OBJECT_TYPE, // the object type shown
    types: [], // State Engine's object types (listObjectTypes)
    fields: [], // the shown setting's baseline field definitions for the type
    view: 'chat', // 'chat' | 'setting' | 'runtime'
    runtimeFields: [], // the shown setting's runtime fields (This chat: the chat's setting)
    runtimeDraft: null, // the Runtime fields tab's unsaved copy: { settingId, fields }
    settingId: null, // the Settings view's setting
    filter: 'all', // 'all' | 'unconfirmed'
    search: '',
    focusId: null,
    editingId: null, // a character id, or 'new'
    settings: [],
    chatSetting: null,
    characters: [],
};
let overlay = null;
let renderToken = 0;

// The shown type's registry entry ({ id, label, plural, noun, scope, icon, ... }).
function typeInfo() {
    return state.types.find((t) => t.id === state.type) ?? { id: state.type, label: state.type, plural: `${state.type}s`, noun: state.type, scope: 'world', icon: 'fa-cube' };
}
const noun = () => typeInfo().noun;
const plural = () => typeInfo().plural.toLowerCase();
const isStoryType = () => typeInfo().scope === 'story';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
}

// API results: null means State Engine refused (its console line says why).
function refused(result, what) {
    if (result === null || result === false) {
        notify('warning', `${what} was refused by State Engine - see the browser console.`);
        return true;
    }
    return false;
}

function scopeOptions(character) {
    return state.view === 'setting' ? { settingId: character?.settingId ?? state.settingId } : {};
}

function chatIdForCalls() {
    return state.view === 'chat' ? currentChatId() : null;
}

// ------------------------------------------------------------------ data

async function load() {
    const token = ++renderToken;
    const chatId = currentChatId();
    const [settings, chatSetting] = await Promise.all([
        listSettings(EXTENSION_ID),
        chatId ? getChatSetting(EXTENSION_ID, chatId) : Promise.resolve(null),
    ]);
    if (!state.types.length) state.types = (await listObjectTypes()) ?? [];
    if (!chatId && state.view === 'chat') state.view = 'setting';
    // Story objects belong to their chat: there is no setting view of them.
    if (isStoryType() && state.view === 'setting') state.view = chatId ? 'chat' : 'runtime';
    if (!state.settingId || !settings.some((s) => s.id === state.settingId)) state.settingId = chatSetting ?? settings[0]?.id ?? 'default';
    const characters = state.view === 'runtime' ? []
        : state.view === 'chat'
            ? await listObjects(EXTENSION_ID, chatId, state.type, {})
            : await listObjects(EXTENSION_ID, null, state.type, { settingId: state.settingId });
    const fieldsSetting = state.view === 'chat' ? (chatSetting ?? 'default') : state.settingId;
    const [runtimeFields, fields] = await Promise.all([
        getObjectRuntimeFields(EXTENSION_ID, fieldsSetting, state.type),
        getObjectFields(EXTENSION_ID, fieldsSetting, state.type),
    ]);
    if (token !== renderToken) return false;
    Object.assign(state, {
        settings: settings ?? [], chatSetting, characters: characters ?? [], runtimeFields: runtimeFields ?? [],
        fields: (fields ?? []).filter((d) => d.scope === 'global' && EDITABLE_TYPES.has(d.type)),
    });
    // A fresh draft for the Runtime fields tab when it opens on a setting.
    if (state.view === 'runtime' && state.runtimeDraft?.settingId !== state.settingId) {
        state.runtimeDraft = { settingId: state.settingId, fields: draftFrom(runtimeFields) };
    }
    return true;
}

async function reload() {
    if (!state.open) return;
    if (await load()) render();
}

// ---------------------------------------------------------------- render

function settingOptions(selected) {
    return state.settings.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === selected ? ' selected' : ''}>${escapeHtml(s.name)}${s.isDefault ? ' (everything)' : ''} · ${s.counts?.[state.type] ?? 0}</option>`).join('');
}

function toolbarHtml() {
    const chatId = currentChatId();
    if (state.view === 'chat') {
        return `
            <label class="pp-cm-field" title="The setting this chat's ${escapeHtml(plural())} come from - and are added to when confirmed">
                <span>Setting</span>
                <select class="text_pole" data-cm="chatSetting">${state.chatSetting ? '' : '<option value="" selected>— not chosen yet —</option>'}${settingOptions(state.chatSetting)}</select>
            </label>
            <label class="pp-cm-field"><span>Show</span>
                <select class="text_pole" data-cm="filter">
                    <option value="all"${state.filter === 'all' ? ' selected' : ''}>All ${escapeHtml(plural())}</option>
                    <option value="unconfirmed"${state.filter === 'unconfirmed' ? ' selected' : ''}>Unconfirmed (to review)</option>
                </select>
            </label>
            <input type="search" class="text_pole pp-cm-search" data-cm="search" placeholder="Search names and aliases…" value="${escapeHtml(state.search)}" />`;
    }
    if (state.view === 'runtime') {
        return `
            <label class="pp-cm-field"><span>Setting</span>
                <select class="text_pole" data-cm="setting">${settingOptions(state.settingId)}</select>
            </label>
            <small class="pp-cm-note">Runtime fields are what each ${escapeHtml(noun())}'s state holds in a chat - written by the prompted update each turn (prompted fields) or set by hand in This chat (the others).${typeInfo().hasPresence ? ` They are cleared when a ${escapeHtml(noun())} leaves the scene.` : ''}</small>`;
    }
    const setting = state.settings.find((s) => s.id === state.settingId);
    return `
        <label class="pp-cm-field"><span>Setting</span>
            <select class="text_pole" data-cm="setting">${settingOptions(state.settingId)}</select>
        </label>
        <div class="menu_button fa-solid fa-plus" data-cm-action="newSetting" title="New setting"></div>
        <div class="menu_button fa-solid fa-pen" data-cm-action="renameSetting" title="Rename this setting"></div>
        <div class="menu_button fa-solid fa-trash-can" data-cm-action="deleteSetting" title="${setting?.isDefault ? 'The Default setting cannot be deleted' : 'Delete this setting and everything in it'}"${setting?.isDefault ? ' data-disabled="true"' : ''}></div>
        <label class="checkbox_label pp-cm-check" title="Confirm everything detected in a chat on this setting at once - so it is added to the setting without review">
            <input type="checkbox" data-cm="autoConfirm"${setting?.autoConfirm ? ' checked' : ''} /><span>Always auto-confirm</span>
        </label>
        <input type="search" class="text_pole pp-cm-search" data-cm="search" placeholder="Search names and aliases…" value="${escapeHtml(state.search)}" />
        <div class="menu_button" data-cm-action="newCharacter" title="Create a canonical ${escapeHtml(noun())} in this setting"><i class="fa-solid fa-plus"></i> New ${escapeHtml(noun())}</div>
        ${chatId ? '' : '<small class="pp-cm-note">No chat open - only settings can be browsed.</small>'}`;
}

function visibleCharacters() {
    const query = state.search.trim().toLowerCase();
    return state.characters.filter((c) => (state.view !== 'chat' || state.filter !== 'unconfirmed' || !c.confirmed)
        && (!query || [c.name, ...c.aliases].some((n) => n.toLowerCase().includes(query))));
}

function characterRow(c) {
    const variant = c.activeVariant ? c.variants.find((v) => v.id === c.activeVariant) : null;
    const chatView = state.view === 'chat';
    return `
        <div class="pp-cm-row${c.id === state.focusId ? ' pp-cm-focus' : ''}" data-id="${escapeHtml(c.id)}">
            <div class="pp-cm-portrait" data-portrait></div>
            <div class="pp-cm-main">
                <div class="pp-cm-title">
                    <span class="pp-cm-name">${escapeHtml(c.name)}</span>
                    <span class="pp-cm-badge ${c.confirmed ? 'pp-cm-confirmed' : 'pp-cm-unconfirmed'}" title="${c.confirmed
                        ? `Confirmed - ${isStoryType() ? 'it belongs to this chat' : `in the setting: every chat on it has this ${noun()}`}`
                        : (c.scope === 'chat'
                            ? `Detected, not reviewed yet - only in this chat. Confirm it (or save an edit) to add it to the setting, or resolve it to a ${noun()} you already have.`
                            : 'Not reviewed yet')}">${c.confirmed ? 'Confirmed' : 'Unconfirmed'}</span>
                    ${chatView && typeInfo().hasPresence ? `<span class="pp-cm-presence ${c.present ? 'pp-present' : 'pp-absent'}" title="${c.present ? 'In the scene' : 'Not in the scene'}"></span>` : ''}
                    ${variant ? `<span class="pp-cm-badge pp-cm-variant" title="The variant this ${escapeHtml(noun())} uses">${escapeHtml(variant.name)}</span>` : ''}
                </div>
                ${c.aliases.length ? `<div class="pp-cm-aliases">Also: ${escapeHtml(c.aliases.join(', '))}</div>` : ''}
                <div class="pp-cm-id" title="Identity key">${escapeHtml(c.id)}${chatView && c.matches ? ` · matched ${c.matches}×` : ''}</div>
                ${c.introduction_snippet ? `<div class="pp-cm-snippet" title="Introduction - the sentence it was first met in (read-only)">“${escapeHtml(c.introduction_snippet)}”</div>` : ''}
                ${chatView ? runtimeHtml(c) : ''}
            </div>
            <div class="pp-cm-actions">
                <div class="menu_button fa-solid fa-pen" data-cm-action="edit" title="Edit (saving confirms it)"></div>
                ${c.confirmed ? '' : '<div class="menu_button fa-solid fa-check" data-cm-action="confirm" title="Confirm as it is - adds it to the setting"></div>'}
                ${c.confirmed
                    ? `<div class="menu_button fa-solid fa-code-merge" data-cm-action="merge" title="Merge into another ${escapeHtml(noun())}"></div>`
                    : `<div class="menu_button fa-solid fa-user-check" data-cm-action="resolve" title="Resolve to an existing ${escapeHtml(noun())} - this detected name becomes one of its aliases"></div>`}
                <div class="menu_button fa-solid fa-trash-can" data-cm-action="delete" title="Delete"></div>
            </div>
            ${state.editingId === c.id ? editorHtml(c) : ''}
        </div>`;
}

// A reference field's ids as the names they show.
function referenceText(value) {
    return (Array.isArray(value) ? value : [value]).filter(Boolean).map((id) => objectDisplayName(id) ?? state.characters.find((c) => c.id === id)?.name ?? id).join(', ');
}

const isReference = (def) => def.type === 'object' || (def.type === 'array' && def.itemType === 'object');
const labelOf = (def) => def.label || `${def.name.charAt(0).toUpperCase()}${def.name.slice(1).replace(/_/g, ' ')}`;

// One baseline field's input, by its definition.
function fieldInput(def, values, prefix, placeholder) {
    const key = def.name;
    const raw = values?.[key];
    const ph = placeholder ? ` placeholder="${escapeHtml(placeholder)}"` : '';
    const label = escapeHtml(labelOf(def));
    const attr = `data-${prefix}="${escapeHtml(key)}"`;
    if (def.type === 'enum') {
        return `<label class="pp-cm-field"><span>${label}</span><select class="text_pole" ${attr}><option value="">—</option>${def.enumValues.map((v) => `<option value="${escapeHtml(v)}"${v === raw ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select></label>`;
    }
    if (def.type === 'boolean') {
        return `<label class="pp-cm-field"><span>${label}</span><select class="text_pole" ${attr}><option value="">—</option><option value="true"${raw === true ? ' selected' : ''}>Yes</option><option value="false"${raw === false ? ' selected' : ''}>No</option></select></label>`;
    }
    if (def.type === 'number') {
        return `<label class="pp-cm-field"><span>${label}</span><input type="number" class="text_pole" ${attr} value="${escapeHtml(raw ?? '')}"${def.min !== null && def.min !== undefined ? ` min="${def.min}"` : ''}${def.max !== null && def.max !== undefined ? ` max="${def.max}"` : ''}${ph} /></label>`;
    }
    if (isReference(def) || def.type === 'array') {
        const value = isReference(def) ? referenceText(raw) : (Array.isArray(raw) ? raw.join(', ') : '');
        const hint = isReference(def) ? `comma separated names - matched to known ${def.type === 'object' ? def.objectType : def.itemObjectType} objects, or recorded as new ones` : 'comma separated';
        return `<label class="pp-cm-field pp-cm-wide" title="${escapeHtml(hint)}"><span>${label}</span><input type="text" class="text_pole" ${attr} value="${escapeHtml(value)}"${ph || ` placeholder="${escapeHtml(hint)}"`} /></label>`;
    }
    return def.multiline
        ? `<label class="pp-cm-field pp-cm-wide"><span>${label}</span><textarea class="text_pole" rows="3" ${attr}${ph}>${escapeHtml(raw ?? '')}</textarea></label>`
        : `<label class="pp-cm-field"><span>${label}</span><input type="text" class="text_pole" ${attr} value="${escapeHtml(raw ?? '')}"${ph} /></label>`;
}

function fieldsHtml(values, prefix, placeholders = {}) {
    const description = values?.description ?? '';
    const descriptionPh = placeholders.description ? ` placeholder="${escapeHtml(placeholders.description)}"` : '';
    return `
        <label class="pp-cm-field"><span>Name</span><input type="text" class="text_pole" data-${prefix}="name" value="${escapeHtml(values?.name ?? '')}"${placeholders.name ? ` placeholder="${escapeHtml(placeholders.name)}"` : ''} /></label>
        <label class="pp-cm-field pp-cm-wide"><span>Aliases</span><input type="text" class="text_pole" data-${prefix}="aliases" value="${escapeHtml((values?.aliases ?? []).join(', '))}" placeholder="${escapeHtml(placeholders.aliases ?? 'comma separated: the stranger, Captain')}" /></label>
        <div class="pp-cm-field pp-cm-wide"><span>Image</span>
            <div class="pp-cm-image-row">
                <input type="text" class="text_pole" data-${prefix}="image" value="${escapeHtml(values?.image ?? '')}" placeholder="${escapeHtml(placeholders.image ?? 'URL or user/images/... path')}" />
                <div class="menu_button fa-solid fa-upload" data-cm-upload="${prefix}" title="Upload an image"></div>
            </div>
        </div>
        <label class="pp-cm-field pp-cm-wide"><span>Description</span><textarea class="text_pole" rows="3" data-${prefix}="description"${descriptionPh}>${escapeHtml(description)}</textarea></label>
        ${state.fields.filter((def) => prefix !== 'v' || !isReference(def)).map((def) => fieldInput(def, values, prefix, placeholders[def.name])).join('')}`;
}

function editorHtml(c) {
    const base = c?.base ?? {};
    const variants = c?.variants ?? [];
    return `
        <div class="pp-cm-editor" data-editor>
            <div class="pp-cm-grid">${fieldsHtml(base, 'f')}</div>
            ${c ? `
            <div class="pp-cm-variants">
                <div class="pp-cm-subhead">Variants <small>- alternate versions; the chosen one is what every chat on the setting uses. Blank fields keep the base.</small></div>
                <label class="pp-cm-field"><span>Uses</span>
                    <select class="text_pole" data-cm="activeVariant">
                        <option value=""${c.activeVariant ? '' : ' selected'}>Base</option>
                        ${variants.map((v) => `<option value="${escapeHtml(v.id)}"${v.id === c.activeVariant ? ' selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
                    </select>
                </label>
                ${variants.map((v) => `
                    <details class="pp-cm-variant" data-variant="${escapeHtml(v.id)}">
                        <summary>${escapeHtml(v.name)}</summary>
                        <div class="pp-cm-grid">
                            <label class="pp-cm-field"><span>Variant name</span><input type="text" class="text_pole" data-v="__name" value="${escapeHtml(v.name)}" /></label>
                            ${fieldsHtml(v.overrides, 'v', { name: base.name, aliases: (base.aliases ?? []).join(', '), image: base.image ?? '' })}
                        </div>
                        <div class="pp-cm-buttons">
                            <div class="menu_button" data-cm-action="saveVariant">Save variant</div>
                            <div class="menu_button" data-cm-action="deleteVariant">Delete variant</div>
                        </div>
                    </details>`).join('')}
                <div class="menu_button" data-cm-action="addVariant"><i class="fa-solid fa-plus"></i> Add variant</div>
            </div>` : ''}
            <div class="pp-cm-buttons">
                <div class="menu_button" data-cm-action="save" title="${c && !isStoryType() ? `Saving confirms the ${escapeHtml(noun())} - it is then in the setting` : ''}"><i class="fa-solid fa-floppy-disk"></i> ${c ? (isStoryType() ? 'Save' : 'Save (confirms)') : 'Create'}</div>
                <div class="menu_button" data-cm-action="cancel">Cancel</div>
            </div>
        </div>`;
}

// ------------------------------------------------------------ runtime state

// Built-in and the setting's own runtime fields alike live in runtime.values.
function runtimeValueOf(c, field) {
    return c.runtime?.values?.[field.name];
}

// A character's runtime state in This chat: prompted values read-only,
// non-prompted ones as inputs.
function runtimeHtml(c) {
    if (!c.runtime) return '';
    const cells = state.runtimeFields.map((field) => {
        const value = runtimeValueOf(c, field);
        let control;
        if (field.prompted) {
            control = `<span class="pp-cm-runtime-value${value === null || value === undefined ? ' pp-cm-runtime-empty' : ''}" title="Written by the prompted update each turn">${value === null || value === undefined ? '—' : escapeHtml(value)}</span>`;
        } else if (field.type === 'enum') {
            control = `<select class="text_pole" data-cm="runtimeValue" data-field="${escapeHtml(field.name)}"><option value="">—</option>${field.values.map((v) => `<option value="${escapeHtml(v)}"${v === value ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('')}</select>`;
        } else {
            control = `<input type="${field.type === 'number' ? 'number' : 'text'}" class="text_pole" data-cm="runtimeValue" data-field="${escapeHtml(field.name)}" value="${escapeHtml(value ?? '')}"${field.min !== null && field.min !== undefined ? ` min="${field.min}"` : ''}${field.max !== null && field.max !== undefined ? ` max="${field.max}"` : ''} />`;
        }
        return `<label class="pp-cm-runtime-cell${field.prompted ? '' : ' pp-cm-runtime-manual'}" title="${escapeHtml(field.description || field.name)}${field.prompted ? '' : ' (set by hand)'}"><span>${escapeHtml(field.name)}</span>${control}</label>`;
    }).join('');
    return `<div class="pp-cm-runtime"><span class="pp-cm-runtime-head">Runtime${c.runtime.present ? '' : ' (not in the scene - cleared)'}</span>${cells}</div>`;
}

// The Runtime fields tab's editable copy: enum values as one comma list,
// and an enum's images (State Engine spec 1.46) as { [value]: reference }.
function draftFrom(fields) {
    return fields.map((f) => ({
        name: f.name, type: f.type, prompted: f.prompted, description: f.description ?? '', builtIn: f.builtIn === true,
        values: (f.values ?? []).join(', '), images: { ...(f.images ?? {}) }, min: f.min ?? '', max: f.max ?? '',
    }));
}

function draftValues(f) {
    return f.values.split(',').map((v) => v.trim()).filter(Boolean);
}

function draftToFields(draft) {
    return draft.map((f) => ({
        name: f.name.trim(), type: f.type, prompted: f.prompted, description: f.description,
        ...(f.type === 'enum' ? { values: draftValues(f), images: f.images ?? {} } : {}),
        ...(f.type === 'number' ? { min: f.min === '' ? null : Number(f.min), max: f.max === '' ? null : Number(f.max) } : {}),
    }));
}

// An enum's images: one URL box, upload button and preview per value. A
// card template shows the image in place of the word ("Mood (icon)").
function enumImagesHtml(f) {
    const values = draftValues(f);
    if (!values.length) return '';
    const cells = values.map((value) => `
        <div class="pp-cm-rf-image" title="Shown in place of &quot;${escapeHtml(value)}&quot; by a card template's icon element">
            <span class="pp-cm-rf-image-preview" data-rf-preview="${escapeHtml(f.images?.[value] ?? '')}"></span>
            <span class="pp-cm-rf-image-value">${escapeHtml(value)}</span>
            <div class="pp-cm-image-row">
                <input type="text" class="text_pole" data-rf-image="${escapeHtml(value)}" value="${escapeHtml(f.images?.[value] ?? '')}" placeholder="URL or user/images/... path" />
                <div class="menu_button fa-solid fa-upload" data-cm-upload="rf" title="Upload an image"></div>
            </div>
        </div>`).join('');
    const setButtons = `
        <div class="pp-cm-rf-image-sets">
            <div class="menu_button" data-cm-action="builtInImageSet" title="Fill these images from a set that comes with Pretty Panels"><i class="fa-solid fa-icons"></i> Built-in sets…</div>
            <div class="menu_button" data-cm-action="importImageSet" title="Fill these images from an image set file"><i class="fa-solid fa-file-import"></i> Import set…</div>
            <div class="menu_button" data-cm-action="exportImageSet" title="Save these images as an image set file (the images are inside it), to import into another field or setting"><i class="fa-solid fa-file-export"></i> Export set</div>
        </div>`;
    return `<details class="pp-cm-rf-images pp-cm-rf-full"${Object.keys(f.images ?? {}).length ? ' open' : ''}><summary>Images (optional - an icon per value)</summary>${setButtons}<div class="pp-cm-rf-image-grid">${cells}</div></details>`;
}

function runtimeEditorHtml() {
    const draft = state.runtimeDraft?.fields ?? [];
    const rows = draft.map((f, i) => `
        <div class="pp-cm-rf-row" data-index="${i}">
            <label class="pp-cm-field"><span>Name</span><input type="text" class="text_pole" data-rf="name" value="${escapeHtml(f.name)}"${f.builtIn ? ' readonly title="A built-in field - it cannot be renamed or removed"' : ' placeholder="e.g. amorousness"'} /></label>
            <label class="pp-cm-field"><span>Type</span><select class="text_pole" data-rf="type">${['string', 'number', 'enum'].map((t) => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`).join('')}</select></label>
            ${f.type === 'enum' ? `<label class="pp-cm-field pp-cm-rf-wide"><span>Values</span><input type="text" class="text_pole" data-rf="values" value="${escapeHtml(f.values)}" placeholder="comma separated: Low, Medium, High" /></label>` : ''}
            ${f.type === 'number' ? `<label class="pp-cm-field"><span>Min</span><input type="number" class="text_pole" data-rf="min" value="${escapeHtml(f.min)}" /></label><label class="pp-cm-field"><span>Max</span><input type="number" class="text_pole" data-rf="max" value="${escapeHtml(f.max)}" /></label>` : ''}
            <label class="pp-cm-field pp-cm-rf-wide"><span>Description (what the model is asked for)</span><input type="text" class="text_pole" data-rf="description" value="${escapeHtml(f.description)}" /></label>
            <label class="checkbox_label pp-cm-check" title="Prompted: the prompted update writes it each turn. Off: you set it by hand in This chat."><input type="checkbox" data-rf="prompted"${f.prompted ? ' checked' : ''} /><span>Prompted</span></label>
            ${f.builtIn ? '<span class="pp-cm-badge" title="Built-in">built-in</span>' : '<div class="menu_button fa-solid fa-trash-can" data-cm-action="removeRuntimeField" title="Remove this field"></div>'}
            ${f.type === 'enum' ? enumImagesHtml(f) : ''}
        </div>`).join('');
    return `
        <div class="pp-cm-rf">
            ${rows}
            <div class="pp-cm-buttons">
                <div class="menu_button" data-cm-action="addRuntimeField"><i class="fa-solid fa-plus"></i> Add field</div>
                <div class="menu_button" data-cm-action="saveRuntimeFields"><i class="fa-solid fa-floppy-disk"></i> Save fields</div>
                <div class="menu_button" data-cm-action="discardRuntimeFields">Discard changes</div>
            </div>
        </div>`;
}

function render() {
    if (!overlay) return;
    const chatId = currentChatId();
    const typeSelect = overlay.querySelector('[data-cm="type"]');
    typeSelect.innerHTML = (state.types.length ? state.types : [typeInfo()])
        .map((t) => `<option value="${escapeHtml(t.id)}"${t.id === state.type ? ' selected' : ''}>${escapeHtml(t.plural)}</option>`).join('');
    overlay.querySelector('[data-cm="typeIcon"]').className = `fa-solid ${typeInfo().icon ?? 'fa-cube'}`;
    overlay.querySelector('[data-cm="tabs"]').innerHTML = `
        <div class="menu_button pp-cm-tab${state.view === 'chat' ? ' pp-cm-tab-active' : ''}" data-cm-view="chat"${chatId ? '' : ' data-disabled="true" title="Open a chat"'}>This chat</div>
        <div class="menu_button pp-cm-tab${state.view === 'setting' ? ' pp-cm-tab-active' : ''}" data-cm-view="setting"${isStoryType() ? ` data-disabled="true" title="${escapeHtml(typeInfo().plural)} belong to their chat, not to a setting"` : ''}>Settings</div>
        <div class="menu_button pp-cm-tab${state.view === 'runtime' ? ' pp-cm-tab-active' : ''}" data-cm-view="runtime">Runtime fields</div>`;
    overlay.querySelector('[data-cm="toolbar"]').innerHTML = toolbarHtml();
    if (state.view === 'runtime') {
        const list = overlay.querySelector('[data-cm="list"]');
        list.innerHTML = runtimeEditorHtml();
        for (const slot of list.querySelectorAll('[data-rf-preview]')) showPreview(slot, slot.dataset.rfPreview);
        return;
    }
    const shown = visibleCharacters();
    const list = overlay.querySelector('[data-cm="list"]');
    const creating = state.editingId === 'new' ? `<div class="pp-cm-row pp-cm-new"><div class="pp-cm-main"><b>New ${escapeHtml(noun())} in ${escapeHtml(state.settings.find((s) => s.id === state.settingId)?.name ?? '')}</b></div>${editorHtml(null)}</div>` : '';
    list.innerHTML = creating + (shown.length ? shown.map(characterRow).join('')
        : `<div class="pp-cm-empty">${state.view === 'chat' && state.filter === 'unconfirmed'
            ? `Nothing to review - no unconfirmed ${escapeHtml(plural())}.`
            : `No ${escapeHtml(plural())} yet. ${escapeHtml(typeInfo().plural)} a prompted ${escapeHtml(noun())} variable meets are added here${isStoryType() ? '' : ' (unconfirmed, until you review them); you can also create them in a setting'}.`}</div>`);
    for (const row of list.querySelectorAll('.pp-cm-row[data-id]')) {
        const character = state.characters.find((c) => c.id === row.dataset.id);
        const slot = row.querySelector('[data-portrait]');
        if (character?.image) {
            const img = document.createElement('img');
            img.src = character.image;
            img.alt = '';
            img.addEventListener('error', () => img.replaceWith(fallbackIcon(character)), { once: true });
            slot.append(img);
        } else {
            slot.append(fallbackIcon(character));
        }
    }
    if (state.focusId) list.querySelector(`.pp-cm-row[data-id="${CSS.escape(state.focusId)}"]`)?.scrollIntoView({ block: 'nearest' });
}

// --------------------------------------------------------------- actions

function readFields(root, prefix) {
    const get = (key) => root.querySelector(`[data-${prefix}="${key}"]`)?.value ?? '';
    const out = {
        name: get('name').trim(),
        aliases: get('aliases').split(',').map((a) => a.trim()).filter(Boolean),
        image: get('image').trim() || null,
    };
    out.description = get('description');
    for (const def of state.fields) {
        const el = root.querySelector(`[data-${prefix}="${CSS.escape(def.name)}"]`);
        if (!el) continue;
        const value = el.value ?? '';
        const list = () => value.split(',').map((n) => n.trim()).filter(Boolean);
        if (def.type === 'object') out[def.name] = value.trim() ? list().slice(0, 1) : '';
        else if (def.type === 'array') out[def.name] = list();
        else if (def.type === 'number') out[def.name] = value === '' ? null : Number(value);
        else if (def.type === 'boolean') out[def.name] = value === '' ? null : value === 'true';
        else out[def.name] = value;
    }
    return out;
}

// A variant's overrides: only the fields given (blank keeps the base).
function readOverrides(root) {
    const all = readFields(root, 'v');
    const out = {};
    if (all.name) out.name = all.name;
    if (all.aliases.length) out.aliases = all.aliases;
    if (all.image) out.image = all.image;
    if (all.description.trim()) out.description = all.description;
    for (const def of state.fields) {
        if (isReference(def) || !(def.name in all)) continue;
        const value = all[def.name];
        const blank = value === null || value === '' || (Array.isArray(value) && value.length === 0);
        if (!blank) out[def.name] = value;
    }
    return out;
}

async function act(action, row, target) {
    const id = row?.dataset.id;
    const character = state.characters.find((c) => c.id === id);
    const chatId = chatIdForCalls();
    const options = scopeOptions(character);
    switch (action) {
        case 'edit':
            state.editingId = state.editingId === id ? null : id;
            render();
            return;
        case 'cancel':
            state.editingId = null;
            render();
            return;
        case 'save': {
            const fields = readFields(row.querySelector('[data-editor]'), 'f');
            if (!fields.name) {
                notify('warning', `A ${noun()} needs a name.`);
                return;
            }
            const result = state.editingId === 'new'
                ? await createObject(EXTENSION_ID, state.settingId, state.type, fields)
                : await updateObject(EXTENSION_ID, chatId, id, fields, options);
            if (refused(result, `Saving the ${noun()}`)) return;
            state.editingId = null;
            state.focusId = result.id;
            break;
        }
        case 'confirm':
            if (refused(await confirmObject(EXTENSION_ID, chatId, id, options), 'Confirming')) return;
            break;
        case 'resolve': {
            // Confirmed characters first - the ones it most likely is.
            const others = state.characters.filter((c) => c.id !== id).sort((a, b) => (b.confirmed - a.confirmed) || a.name.localeCompare(b.name));
            const targetId = await chooseFromList({
                title: `"${character.name}" is really…`,
                items: others.map((c) => ({ value: c.id, label: c.name, detail: [c.aliases.join(', '), c.confirmed ? '' : 'unconfirmed'].filter(Boolean).join(' · ') })),
                emptyText: `There is no other ${noun()} to resolve it to - confirm or edit this one instead.`,
            });
            if (!targetId) return;
            const into = others.find((c) => c.id === targetId);
            if (!await confirmYesNo(`Resolve "${character.name}" to "${into.name}"? "${character.name}" becomes one of ${into.name}'s aliases, every variable showing it shows ${into.name}, and ${into.name} is confirmed.`)) return;
            if (refused(await resolveObject(EXTENSION_ID, chatId, id, targetId, options), 'Resolving')) return;
            notify('success', `"${character.name}" is now an alias of ${into.name}.`);
            state.focusId = targetId;
            break;
        }
        case 'merge': {
            const others = state.characters.filter((c) => c.id !== id);
            const targetId = await chooseFromList({
                title: `Merge "${character.name}" into…`,
                items: others.map((c) => ({ value: c.id, label: c.name, detail: [c.aliases.join(', '), c.confirmed ? '' : 'unconfirmed'].filter(Boolean).join(' · ') })),
                emptyText: `There is no other ${noun()} to merge into.`,
            });
            if (!targetId) return;
            const into = others.find((c) => c.id === targetId);
            if (!await confirmYesNo(`Merge "${character.name}" into "${into.name}"? "${character.name}" becomes one of ${into.name}'s aliases, every variable showing it shows ${into.name}, and "${character.name}" is deleted.`)) return;
            if (refused(await mergeObjects(EXTENSION_ID, chatId, id, targetId, options), 'The merge')) return;
            state.focusId = targetId;
            break;
        }
        case 'delete': {
            const where = character.scope === 'setting' ? ` It is removed from the setting - every chat on it loses this ${noun()}.` : '';
            if (!await confirmYesNo(`Delete "${character.name}"?${where} Variables showing it are cleared.`)) return;
            if (refused(await deleteObject(EXTENSION_ID, chatId, id, options), 'Deleting')) return;
            break;
        }
        case 'addVariant': {
            const name = await promptText('Name for the new variant (e.g. "Older", "Alternate timeline"):', '');
            if (!name) return;
            if (refused(await addObjectVariant(EXTENSION_ID, chatId, id, { name, overrides: {} }, options), 'Adding the variant')) return;
            break;
        }
        case 'saveVariant': {
            const box = target.closest('[data-variant]');
            const name = box.querySelector('[data-v="__name"]').value.trim();
            if (refused(await updateObjectVariant(EXTENSION_ID, chatId, id, box.dataset.variant, { name, overrides: readOverrides(box) }, options), 'Saving the variant')) return;
            break;
        }
        case 'deleteVariant': {
            const box = target.closest('[data-variant]');
            if (!await confirmYesNo('Delete this variant?')) return;
            if (refused(await deleteObjectVariant(EXTENSION_ID, chatId, id, box.dataset.variant, options), 'Deleting the variant')) return;
            break;
        }
        case 'addRuntimeField':
            state.runtimeDraft.fields.push({ name: '', type: 'string', prompted: true, description: '', builtIn: false, values: '', min: '', max: '' });
            render();
            return;
        case 'removeRuntimeField':
            state.runtimeDraft.fields.splice(Number(target.closest('[data-index]').dataset.index), 1);
            render();
            return;
        case 'exportImageSet':
        case 'importImageSet':
        case 'builtInImageSet': {
            const index = Number(target.closest('[data-index]').dataset.index);
            const field = state.runtimeDraft?.fields[index];
            if (!field) return;
            const current = { name: field.name.trim(), values: draftValues(field), images: field.images ?? {} };
            if (action === 'exportImageSet') {
                await exportImageSet(current);
                return;
            }
            const result = action === 'importImageSet'
                ? await importImageSet(current, { folder: IMAGE_FOLDER })
                : await chooseBuiltInImageSet(current, { folder: IMAGE_FOLDER });
            // The draft may have been discarded or switched to another setting meanwhile.
            if (!result || state.runtimeDraft?.fields[index] !== field) return;
            field.values = result.values.join(', ');
            field.images = result.images;
            render();
            return;
        }
        case 'discardRuntimeFields':
            state.runtimeDraft = null;
            break;
        case 'saveRuntimeFields': {
            const saved = await setObjectRuntimeFields(EXTENSION_ID, state.runtimeDraft.settingId, state.type, draftToFields(state.runtimeDraft.fields));
            if (refused(saved, 'Saving the runtime fields')) return;
            state.runtimeDraft = { settingId: state.runtimeDraft.settingId, fields: draftFrom(saved) };
            notify('success', 'Runtime fields saved.');
            break;
        }
        case 'newCharacter':
            state.editingId = 'new';
            render();
            return;
        case 'newSetting': {
            const name = await promptText('Name for the new setting (a story, a world):', '');
            if (!name) return;
            const created = await createSetting(EXTENSION_ID, { name });
            if (refused(created, 'Creating the setting')) return;
            state.settingId = created.id;
            break;
        }
        case 'renameSetting': {
            const setting = state.settings.find((s) => s.id === state.settingId);
            const name = await promptText('Rename the setting:', setting?.name ?? '');
            if (!name) return;
            if (refused(await updateSetting(EXTENSION_ID, state.settingId, { name }), 'Renaming the setting')) return;
            break;
        }
        case 'deleteSetting': {
            const setting = state.settings.find((s) => s.id === state.settingId);
            if (!setting || setting.isDefault) return;
            if (!await confirmYesNo(`Delete the setting "${setting.name}" and everything in it - ${setting.objectCount} object(s), ${setting.counts?.[CHARACTER_OBJECT_TYPE] ?? 0} of them character(s)? Chats using it will be asked for a setting again.`)) return;
            if (refused(await deleteSetting(EXTENSION_ID, setting.id), 'Deleting the setting')) return;
            state.settingId = null;
            break;
        }
        default:
            return;
    }
    await refreshValues();
    await reload();
}

async function onChange(e) {
    const key = e.target.dataset.cm;
    const chatId = currentChatId();
    if (key === 'type') {
        state.type = e.target.value;
        state.editingId = null;
        state.runtimeDraft = null;
        state.focusId = null;
        await reload();
    } else if (key === 'filter') {
        state.filter = e.target.value;
        render();
    } else if (key === 'setting') {
        state.settingId = e.target.value;
        state.editingId = null;
        state.runtimeDraft = null;
        await reload();
    } else if (key === 'runtimeValue') {
        const row = e.target.closest('.pp-cm-row');
        const value = e.target.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : (e.target.value || null);
        if (refused(await setObjectRuntimeValue(EXTENSION_ID, chatId, row.dataset.id, e.target.dataset.field, value), 'Setting the value')) return;
        await refreshValues();
        await reload();
    } else if (e.target.dataset.rf) {
        // A Runtime fields draft edit; a type change redraws (its options differ).
        const field = state.runtimeDraft.fields[Number(e.target.closest('[data-index]').dataset.index)];
        field[e.target.dataset.rf] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        // The values decide which image boxes there are.
        if (e.target.dataset.rf === 'type' || e.target.dataset.rf === 'values') render();
    } else if (key === 'chatSetting' && chatId && e.target.value) {
        if (refused(await setChatSetting(EXTENSION_ID, chatId, e.target.value), 'Choosing the setting')) return;
        await refreshValues();
        await reload();
    } else if (key === 'autoConfirm') {
        if (refused(await updateSetting(EXTENSION_ID, state.settingId, { autoConfirm: e.target.checked }), 'Changing auto-confirm')) return;
        await reload();
    } else if (key === 'activeVariant') {
        const row = e.target.closest('.pp-cm-row');
        const character = state.characters.find((c) => c.id === row?.dataset.id);
        if (refused(await setObjectActiveVariant(EXTENSION_ID, chatIdForCalls(), row.dataset.id, e.target.value || null, scopeOptions(character)), 'Choosing the variant')) return;
        await refreshValues();
        await reload();
    }
}

// An enum image's preview (src set as a property, never as markup).
function showPreview(slot, reference) {
    slot.replaceChildren();
    if (!reference) return;
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener('error', () => img.remove(), { once: true });
    img.src = reference;
    slot.append(img);
}

// An enum image box edited (typed, pasted, uploaded): into the draft, and its preview.
function onEnumImageEdit(input) {
    const field = state.runtimeDraft?.fields[Number(input.closest('[data-index]').dataset.index)];
    if (!field) return;
    field.images = { ...(field.images ?? {}) };
    const reference = input.value.trim();
    if (reference) field.images[input.dataset.rfImage] = reference;
    else delete field.images[input.dataset.rfImage];
    showPreview(input.closest('.pp-cm-rf-image').querySelector('[data-rf-preview]'), reference);
}

async function onUpload(button) {
    const file = await pickImageFile();
    if (!file) return;
    try {
        const path = await importImageFile(EXTENSION_ID, file, { folder: IMAGE_FOLDER });
        const field = button.closest('.pp-cm-image-row').querySelector('input');
        field.value = path;
        if (field.dataset.rfImage !== undefined) onEnumImageEdit(field);
        notify('info', 'Image uploaded - Save to keep it.');
    } catch (err) {
        notify('error', err?.message ?? 'The image could not be uploaded.');
    }
}

function build() {
    overlay = document.createElement('div');
    overlay.className = 'pp-cm-overlay';
    overlay.innerHTML = `
        <div class="pp-cm-window" role="dialog" aria-label="Object Manager">
            <div class="pp-cm-header">
                <label class="pp-cm-type" title="Which objects to show"><i class="fa-solid fa-users" data-cm="typeIcon"></i>
                    <select class="text_pole" data-cm="type"></select>
                </label>
                <div class="pp-cm-tabs" data-cm="tabs"></div>
                <div class="menu_button fa-solid fa-xmark" data-cm-close title="Close"></div>
            </div>
            <div class="pp-cm-toolbar" data-cm="toolbar"></div>
            <div class="pp-cm-list" data-cm="list"></div>
        </div>`;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-cm-close]')) {
            closeObjectManager();
            return;
        }
        const view = e.target.closest('[data-cm-view]');
        if (view && view.dataset.disabled !== 'true') {
            state.view = view.dataset.cmView;
            state.editingId = null;
            void reload();
            return;
        }
        const upload = e.target.closest('[data-cm-upload]');
        if (upload) {
            void onUpload(upload);
            return;
        }
        const button = e.target.closest('[data-cm-action]');
        if (!button || button.dataset.disabled === 'true') return;
        void act(button.dataset.cmAction, button.closest('.pp-cm-row'), button);
    });
    overlay.addEventListener('change', (e) => void onChange(e));
    overlay.addEventListener('input', (e) => {
        if (e.target.dataset.rfImage !== undefined) {
            onEnumImageEdit(e.target);
            return;
        }
        if (e.target.dataset.rf && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') {
            const field = state.runtimeDraft?.fields[Number(e.target.closest('[data-index]').dataset.index)];
            if (field) field[e.target.dataset.rf] = e.target.value;
            return;
        }
        if (e.target.dataset.cm === 'search') {
            state.search = e.target.value;
            const caret = e.target.selectionStart;
            render();
            const field = overlay.querySelector('[data-cm="search"]');
            field.focus();
            field.setSelectionRange(caret, caret);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (state.open && e.key === 'Escape' && !e.target.closest?.('.pp-cm-editor')) closeObjectManager();
    });
    document.body.append(overlay);
}

// Opens the manager. options: { characterId?, view?: 'chat' | 'setting',
// settingId?, filter?: 'unconfirmed' }, or State Engine's object manager
// shape { type?, objectId?, view?, settingId?, filter? }.
export async function openObjectManager(options = {}) {
    if (!overlay) build();
    const chatId = currentChatId();
    if (!state.types.length) state.types = (await listObjectTypes()) ?? [];
    const known = (type) => typeof type === 'string' && (state.types.length === 0 || state.types.some((t) => t.id === type));
    state.type = known(options.type) ? options.type : CHARACTER_OBJECT_TYPE;
    state.view = options.view ?? (chatId ? 'chat' : 'setting');
    state.runtimeDraft = null;
    state.filter = options.filter ?? 'all';
    state.focusId = options.characterId ?? options.objectId ?? null;
    state.editingId = null;
    state.search = '';
    if (options.settingId) state.settingId = options.settingId;
    state.open = true;
    overlay.hidden = false;
    // A chat without a setting is asked now (State Engine's question).
    if (chatId && state.view === 'chat') await ensureChatSetting(EXTENSION_ID, chatId);
    await reload();
}

export function closeObjectManager() {
    state.open = false;
    if (overlay) overlay.hidden = true;
}

// Registers this window with State Engine as its object manager (its
// drawer button and the "new ... detected" notifications open it) and
// keeps it current while open.
export async function initObjectManager() {
    try {
        await registerObjectManager(EXTENSION_ID, (options) => void openObjectManager(options ?? {}));
    } catch (err) {
        console.warn('[PrettyPanels] could not register the Object Manager with State Engine (update State Engine for object support)', err);
    }
    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(VARIABLES_CHANGED_EVENT, () => {
        // An edit in progress is not redrawn under the user.
        if (state.open && !state.editingId) void reload();
    });
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
        if (state.open) void reload();
    });
}
