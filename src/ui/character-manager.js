// The shared Character Manager (State Engine characters, requirements spec
// 1.42). The window lives here; every piece of data and every rule lives in
// State Engine - this module only calls its Character API (src/api/*). It is
// the one place characters are edited. It opens from a CharacterCard click,
// the Pretty Panels drawer, State Engine's drawer ("Manage characters") and
// State Engine's "New characters detected for review" notification (the
// last two through registerCharacterManager()).
//
// Confirmed <=> in the setting (State Engine's rule): a character detected
// in a chat is unconfirmed and only in that chat until it is reviewed -
// confirmed as it is, edited and saved (which confirms it), or RESOLVED to
// an existing character (its detected name becomes that character's alias).
// There is no separate "add to setting".
//
// Two views:
//   This chat - the open chat's characters: its unconfirmed ones and its
//     setting's, with presence; the chat's setting is chosen here. Edit,
//     confirm, resolve, merge, delete; filter to unconfirmed.
//   Settings - any setting's canonical characters (default: the chat's
//     setting): create, edit, merge, delete; settings themselves are created,
//     renamed, deleted and set to auto-confirm here.
//   Runtime fields - a setting's runtime field definitions (spec 1.43): the
//     built-in thought, mood and intent, and the user's own (string, number
//     or enum; prompted or not). Edited as a draft, then saved.
// Editing a character edits its baseline (for a canonical one, in every chat
// on its setting) and confirms it. Each character has variants (alternate
// versions overriding baseline fields) and one active variant. In This chat,
// each character also shows its runtime state: prompted values read-only
// (the prompted update writes them each turn), non-prompted ones editable.

import { EXTENSION_ID } from '../constants.js';
import { listCharacterSettings } from '../api/list-character-settings.js';
import { createCharacterSetting } from '../api/create-character-setting.js';
import { updateCharacterSetting } from '../api/update-character-setting.js';
import { deleteCharacterSetting } from '../api/delete-character-setting.js';
import { getChatCharacterSetting } from '../api/get-chat-character-setting.js';
import { setChatCharacterSetting } from '../api/set-chat-character-setting.js';
import { ensureChatCharacterSetting } from '../api/ensure-chat-character-setting.js';
import { listCharacters } from '../api/list-characters.js';
import { createCharacter } from '../api/create-character.js';
import { updateCharacter } from '../api/update-character.js';
import { mergeCharacters } from '../api/merge-characters.js';
import { deleteCharacter } from '../api/delete-character.js';
import { confirmCharacter } from '../api/confirm-character.js';
import { resolveCharacter } from '../api/resolve-character.js';
import { addCharacterVariant } from '../api/add-character-variant.js';
import { updateCharacterVariant } from '../api/update-character-variant.js';
import { deleteCharacterVariant } from '../api/delete-character-variant.js';
import { setCharacterActiveVariant } from '../api/set-character-active-variant.js';
import { registerCharacterManager } from '../api/register-character-manager.js';
import { getCharacterRuntimeFields } from '../api/get-character-runtime-fields.js';
import { setCharacterRuntimeFields } from '../api/set-character-runtime-fields.js';
import { setCharacterRuntimeValue } from '../api/set-character-runtime-value.js';
import { importImageFile } from '../api/import-image-file.js';
import { VARIABLES_CHANGED_EVENT, currentChatId, refreshValues } from '../chat/variable-service.js';
import { fallbackIcon } from '../elements/character-card.js';
import { confirmYesNo, promptText, notify, chooseFromList } from './dialogs.js';
import { pickImageFile } from './image-upload.js';

// Baseline text fields beyond name/aliases/image.
const TEXT_FIELDS = [
    ['faction', 'Faction', 'input'],
    ['role', 'Role', 'input'],
    ['biography', 'Biography', 'textarea'],
    ['personality', 'Personality', 'textarea'],
];
const IMAGE_FOLDER = 'characters';

const state = {
    open: false,
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
        listCharacterSettings(EXTENSION_ID),
        chatId ? getChatCharacterSetting(EXTENSION_ID, chatId) : Promise.resolve(null),
    ]);
    if (!chatId && state.view === 'chat') state.view = 'setting';
    if (!state.settingId || !settings.some((s) => s.id === state.settingId)) state.settingId = chatSetting ?? settings[0]?.id ?? 'default';
    const characters = state.view === 'runtime' ? []
        : state.view === 'chat'
            ? await listCharacters(EXTENSION_ID, chatId, {})
            : await listCharacters(EXTENSION_ID, null, { settingId: state.settingId });
    const fieldsSetting = state.view === 'chat' ? (chatSetting ?? 'default') : state.settingId;
    const runtimeFields = (await getCharacterRuntimeFields(EXTENSION_ID, fieldsSetting)) ?? [];
    if (token !== renderToken) return false;
    Object.assign(state, { settings: settings ?? [], chatSetting, characters: characters ?? [], runtimeFields });
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
    return state.settings.map((s) => `<option value="${escapeHtml(s.id)}"${s.id === selected ? ' selected' : ''}>${escapeHtml(s.name)}${s.isDefault ? ' (everything)' : ''} · ${s.characterCount}</option>`).join('');
}

function toolbarHtml() {
    const chatId = currentChatId();
    if (state.view === 'chat') {
        return `
            <label class="pp-cm-field" title="The setting this chat's characters come from - and are added to when confirmed">
                <span>Setting</span>
                <select class="text_pole" data-cm="chatSetting">${state.chatSetting ? '' : '<option value="" selected>— not chosen yet —</option>'}${settingOptions(state.chatSetting)}</select>
            </label>
            <label class="pp-cm-field"><span>Show</span>
                <select class="text_pole" data-cm="filter">
                    <option value="all"${state.filter === 'all' ? ' selected' : ''}>All characters</option>
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
            <small class="pp-cm-note">Runtime fields are what each character's state holds in a chat - written by the prompted update each turn (prompted fields) or set by hand in This chat (the others). They are cleared when a character leaves the scene.</small>`;
    }
    const setting = state.settings.find((s) => s.id === state.settingId);
    return `
        <label class="pp-cm-field"><span>Setting</span>
            <select class="text_pole" data-cm="setting">${settingOptions(state.settingId)}</select>
        </label>
        <div class="menu_button fa-solid fa-plus" data-cm-action="newSetting" title="New setting"></div>
        <div class="menu_button fa-solid fa-pen" data-cm-action="renameSetting" title="Rename this setting"></div>
        <div class="menu_button fa-solid fa-trash-can" data-cm-action="deleteSetting" title="${setting?.isDefault ? 'The Default setting cannot be deleted' : 'Delete this setting and its characters'}"${setting?.isDefault ? ' data-disabled="true"' : ''}></div>
        <label class="checkbox_label pp-cm-check" title="Confirm every character detected in a chat on this setting at once - so it is added to the setting without review">
            <input type="checkbox" data-cm="autoConfirm"${setting?.autoConfirm ? ' checked' : ''} /><span>Always auto-confirm</span>
        </label>
        <input type="search" class="text_pole pp-cm-search" data-cm="search" placeholder="Search names and aliases…" value="${escapeHtml(state.search)}" />
        <div class="menu_button" data-cm-action="newCharacter" title="Create a canonical character in this setting"><i class="fa-solid fa-user-plus"></i> New character</div>
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
                        ? 'Confirmed - in the setting: every chat on it has this character'
                        : (c.scope === 'chat'
                            ? 'Detected, not reviewed yet - only in this chat. Confirm it (or save an edit) to add it to the setting, or resolve it to a character you already have.'
                            : 'Not reviewed yet')}">${c.confirmed ? 'Confirmed' : 'Unconfirmed'}</span>
                    ${chatView ? `<span class="pp-cm-presence ${c.present ? 'pp-present' : 'pp-absent'}" title="${c.present ? 'In the scene' : 'Not in the scene'}"></span>` : ''}
                    ${variant ? `<span class="pp-cm-badge pp-cm-variant" title="The variant this character uses">${escapeHtml(variant.name)}</span>` : ''}
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
                    ? '<div class="menu_button fa-solid fa-code-merge" data-cm-action="merge" title="Merge into another character"></div>'
                    : '<div class="menu_button fa-solid fa-user-check" data-cm-action="resolve" title="Resolve to an existing character - this detected name becomes one of their aliases"></div>'}
                <div class="menu_button fa-solid fa-trash-can" data-cm-action="delete" title="Delete"></div>
            </div>
            ${state.editingId === c.id ? editorHtml(c) : ''}
        </div>`;
}

function fieldsHtml(values, prefix, placeholders = {}) {
    const input = (key, label, kind) => {
        const value = values?.[key] ?? '';
        const ph = placeholders[key] ? ` placeholder="${escapeHtml(placeholders[key])}"` : '';
        return kind === 'textarea'
            ? `<label class="pp-cm-field pp-cm-wide"><span>${label}</span><textarea class="text_pole" rows="3" data-${prefix}="${key}"${ph}>${escapeHtml(value)}</textarea></label>`
            : `<label class="pp-cm-field"><span>${label}</span><input type="text" class="text_pole" data-${prefix}="${key}" value="${escapeHtml(value)}"${ph} /></label>`;
    };
    return `
        ${input('name', 'Name', 'input')}
        <label class="pp-cm-field pp-cm-wide"><span>Aliases</span><input type="text" class="text_pole" data-${prefix}="aliases" value="${escapeHtml((values?.aliases ?? []).join(', '))}" placeholder="${escapeHtml(placeholders.aliases ?? 'comma separated: the stranger, Captain')}" /></label>
        <div class="pp-cm-field pp-cm-wide"><span>Image</span>
            <div class="pp-cm-image-row">
                <input type="text" class="text_pole" data-${prefix}="image" value="${escapeHtml(values?.image ?? '')}" placeholder="${escapeHtml(placeholders.image ?? 'URL or user/images/... path')}" />
                <div class="menu_button fa-solid fa-upload" data-cm-upload="${prefix}" title="Upload an image"></div>
            </div>
        </div>
        ${TEXT_FIELDS.map(([key, label, kind]) => input(key, label, kind)).join('')}`;
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
                <div class="menu_button" data-cm-action="save" title="${c ? 'Saving confirms the character - it is then in the setting' : ''}"><i class="fa-solid fa-floppy-disk"></i> ${c ? 'Save (confirms)' : 'Create'}</div>
                <div class="menu_button" data-cm-action="cancel">Cancel</div>
            </div>
        </div>`;
}

// ------------------------------------------------------------ runtime state

function runtimeValueOf(c, field) {
    return field.builtIn ? c.runtime?.[field.name] : c.runtime?.custom?.[field.name];
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
    return `<details class="pp-cm-rf-images pp-cm-rf-full"${Object.keys(f.images ?? {}).length ? ' open' : ''}><summary>Images (optional - an icon per value)</summary><div class="pp-cm-rf-image-grid">${cells}</div></details>`;
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
    overlay.querySelector('[data-cm="tabs"]').innerHTML = `
        <div class="menu_button pp-cm-tab${state.view === 'chat' ? ' pp-cm-tab-active' : ''}" data-cm-view="chat"${chatId ? '' : ' data-disabled="true" title="Open a chat"'}>This chat</div>
        <div class="menu_button pp-cm-tab${state.view === 'setting' ? ' pp-cm-tab-active' : ''}" data-cm-view="setting">Settings</div>
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
    const creating = state.editingId === 'new' ? `<div class="pp-cm-row pp-cm-new"><div class="pp-cm-main"><b>New character in ${escapeHtml(state.settings.find((s) => s.id === state.settingId)?.name ?? '')}</b></div>${editorHtml(null)}</div>` : '';
    list.innerHTML = creating + (shown.length ? shown.map(characterRow).join('')
        : `<div class="pp-cm-empty">${state.view === 'chat' && state.filter === 'unconfirmed' ? 'Nothing to review - no unconfirmed characters.' : 'No characters yet. Characters a prompted character variable meets are added here (unconfirmed, until you review them); you can also create them in a setting.'}</div>`);
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
    for (const [key] of TEXT_FIELDS) out[key] = get(key);
    return out;
}

// A variant's overrides: only the fields given (blank keeps the base).
function readOverrides(root) {
    const all = readFields(root, 'v');
    const out = {};
    if (all.name) out.name = all.name;
    if (all.aliases.length) out.aliases = all.aliases;
    if (all.image) out.image = all.image;
    for (const [key] of TEXT_FIELDS) if (all[key].trim()) out[key] = all[key];
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
                notify('warning', 'A character needs a name.');
                return;
            }
            const result = state.editingId === 'new'
                ? await createCharacter(EXTENSION_ID, state.settingId, fields)
                : await updateCharacter(EXTENSION_ID, chatId, id, fields, options);
            if (refused(result, 'Saving the character')) return;
            state.editingId = null;
            state.focusId = result.id;
            break;
        }
        case 'confirm':
            if (refused(await confirmCharacter(EXTENSION_ID, chatId, id, options), 'Confirming')) return;
            break;
        case 'resolve': {
            // Confirmed characters first - the ones it most likely is.
            const others = state.characters.filter((c) => c.id !== id).sort((a, b) => (b.confirmed - a.confirmed) || a.name.localeCompare(b.name));
            const targetId = await chooseFromList({
                title: `"${character.name}" is really…`,
                items: others.map((c) => ({ value: c.id, label: c.name, detail: [c.aliases.join(', '), c.confirmed ? '' : 'unconfirmed'].filter(Boolean).join(' · ') })),
                emptyText: 'There is no other character to resolve it to - confirm or edit this one instead.',
            });
            if (!targetId) return;
            const into = others.find((c) => c.id === targetId);
            if (!await confirmYesNo(`Resolve "${character.name}" to "${into.name}"? "${character.name}" becomes one of ${into.name}'s aliases, every variable showing it shows ${into.name}, and ${into.name} is confirmed.`)) return;
            if (refused(await resolveCharacter(EXTENSION_ID, chatId, id, targetId, options), 'Resolving')) return;
            notify('success', `"${character.name}" is now an alias of ${into.name}.`);
            state.focusId = targetId;
            break;
        }
        case 'merge': {
            const others = state.characters.filter((c) => c.id !== id);
            const targetId = await chooseFromList({
                title: `Merge "${character.name}" into…`,
                items: others.map((c) => ({ value: c.id, label: c.name, detail: [c.aliases.join(', '), c.confirmed ? '' : 'unconfirmed'].filter(Boolean).join(' · ') })),
                emptyText: 'There is no other character to merge into.',
            });
            if (!targetId) return;
            const into = others.find((c) => c.id === targetId);
            if (!await confirmYesNo(`Merge "${character.name}" into "${into.name}"? "${character.name}" becomes one of ${into.name}'s aliases, every variable showing it shows ${into.name}, and "${character.name}" is deleted.`)) return;
            if (refused(await mergeCharacters(EXTENSION_ID, chatId, id, targetId, options), 'The merge')) return;
            state.focusId = targetId;
            break;
        }
        case 'delete': {
            const where = character.scope === 'setting' ? ' It is removed from the setting - every chat on it loses this character.' : '';
            if (!await confirmYesNo(`Delete "${character.name}"?${where} Variables showing it are cleared.`)) return;
            if (refused(await deleteCharacter(EXTENSION_ID, chatId, id, options), 'Deleting')) return;
            break;
        }
        case 'addVariant': {
            const name = await promptText('Name for the new variant (e.g. "Older", "Alternate timeline"):', '');
            if (!name) return;
            if (refused(await addCharacterVariant(EXTENSION_ID, chatId, id, { name, overrides: {} }, options), 'Adding the variant')) return;
            break;
        }
        case 'saveVariant': {
            const box = target.closest('[data-variant]');
            const name = box.querySelector('[data-v="__name"]').value.trim();
            if (refused(await updateCharacterVariant(EXTENSION_ID, chatId, id, box.dataset.variant, { name, overrides: readOverrides(box) }, options), 'Saving the variant')) return;
            break;
        }
        case 'deleteVariant': {
            const box = target.closest('[data-variant]');
            if (!await confirmYesNo('Delete this variant?')) return;
            if (refused(await deleteCharacterVariant(EXTENSION_ID, chatId, id, box.dataset.variant, options), 'Deleting the variant')) return;
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
        case 'discardRuntimeFields':
            state.runtimeDraft = null;
            break;
        case 'saveRuntimeFields': {
            const saved = await setCharacterRuntimeFields(EXTENSION_ID, state.runtimeDraft.settingId, draftToFields(state.runtimeDraft.fields));
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
            const created = await createCharacterSetting(EXTENSION_ID, { name });
            if (refused(created, 'Creating the setting')) return;
            state.settingId = created.id;
            break;
        }
        case 'renameSetting': {
            const setting = state.settings.find((s) => s.id === state.settingId);
            const name = await promptText('Rename the setting:', setting?.name ?? '');
            if (!name) return;
            if (refused(await updateCharacterSetting(EXTENSION_ID, state.settingId, { name }), 'Renaming the setting')) return;
            break;
        }
        case 'deleteSetting': {
            const setting = state.settings.find((s) => s.id === state.settingId);
            if (!setting || setting.isDefault) return;
            if (!await confirmYesNo(`Delete the setting "${setting.name}" and its ${setting.characterCount} character(s)? Chats using it will be asked for a setting again.`)) return;
            if (refused(await deleteCharacterSetting(EXTENSION_ID, setting.id), 'Deleting the setting')) return;
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
    if (key === 'filter') {
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
        if (refused(await setCharacterRuntimeValue(EXTENSION_ID, chatId, row.dataset.id, e.target.dataset.field, value), 'Setting the value')) return;
        await refreshValues();
        await reload();
    } else if (e.target.dataset.rf) {
        // A Runtime fields draft edit; a type change redraws (its options differ).
        const field = state.runtimeDraft.fields[Number(e.target.closest('[data-index]').dataset.index)];
        field[e.target.dataset.rf] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        // The values decide which image boxes there are.
        if (e.target.dataset.rf === 'type' || e.target.dataset.rf === 'values') render();
    } else if (key === 'chatSetting' && chatId && e.target.value) {
        if (refused(await setChatCharacterSetting(EXTENSION_ID, chatId, e.target.value), 'Choosing the setting')) return;
        await refreshValues();
        await reload();
    } else if (key === 'autoConfirm') {
        if (refused(await updateCharacterSetting(EXTENSION_ID, state.settingId, { autoConfirm: e.target.checked }), 'Changing auto-confirm')) return;
        await reload();
    } else if (key === 'activeVariant') {
        const row = e.target.closest('.pp-cm-row');
        const character = state.characters.find((c) => c.id === row?.dataset.id);
        if (refused(await setCharacterActiveVariant(EXTENSION_ID, chatIdForCalls(), row.dataset.id, e.target.value || null, scopeOptions(character)), 'Choosing the variant')) return;
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
        <div class="pp-cm-window" role="dialog" aria-label="Character Manager">
            <div class="pp-cm-header">
                <b><i class="fa-solid fa-users"></i> Characters</b>
                <div class="pp-cm-tabs" data-cm="tabs"></div>
                <div class="menu_button fa-solid fa-xmark" data-cm-close title="Close"></div>
            </div>
            <div class="pp-cm-toolbar" data-cm="toolbar"></div>
            <div class="pp-cm-list" data-cm="list"></div>
        </div>`;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('[data-cm-close]')) {
            closeCharacterManager();
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
        if (state.open && e.key === 'Escape' && !e.target.closest?.('.pp-cm-editor')) closeCharacterManager();
    });
    document.body.append(overlay);
}

// Opens the manager. options: { characterId?, view?: 'chat' | 'setting',
// settingId?, filter?: 'unconfirmed' } (State Engine passes the same shape).
export async function openCharacterManager(options = {}) {
    if (!overlay) build();
    const chatId = currentChatId();
    state.view = options.view ?? (chatId ? 'chat' : 'setting');
    state.runtimeDraft = null;
    state.filter = options.filter ?? 'all';
    state.focusId = options.characterId ?? null;
    state.editingId = null;
    state.search = '';
    if (options.settingId) state.settingId = options.settingId;
    state.open = true;
    overlay.hidden = false;
    // A chat without a setting is asked now (State Engine's question).
    if (chatId && state.view === 'chat') await ensureChatCharacterSetting(EXTENSION_ID, chatId);
    await reload();
}

export function closeCharacterManager() {
    state.open = false;
    if (overlay) overlay.hidden = true;
}

// Registers this window with State Engine (its drawer button and the
// "new characters" notification open it) and keeps it current while open.
export async function initCharacterManager() {
    try {
        await registerCharacterManager(EXTENSION_ID, (options) => void openCharacterManager(options ?? {}));
    } catch (err) {
        console.warn('[PrettyPanels] could not register the Character Manager with State Engine (update State Engine for character support)', err);
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
