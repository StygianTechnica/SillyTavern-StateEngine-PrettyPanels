// The "Layout Roles" section of the Pretty Panels drawer (markup in
// settings.html), for the layout on screen:
//
//   - its layout roles (role-library.js, namespace "prettyPanels"): public
//     name (the id on hover), type, rename, remove, and - for the open chat -
//     which variable fulfils it;
//   - roles of other namespaces its elements are bound to: the same, minus
//     what only their owner may change (type, name);
//   - a form to add a role to the layout (a name another layout already uses
//     is shared - one role, its type kept).
//
// Choosing the variable is the chat's role assignment in State Engine
// (assignRole); the dropdown only ever offers the chat's existing variables
// that fit (getRoleCandidates). Nothing shows without a layout on screen,
// which needs an open chat.

import { EXTENSION_ID } from '../constants.js';
import { assignRole } from '../api/assign-role.js';
import { getRoleCandidates } from '../api/get-role-candidates.js';
import { getActiveLayoutId } from '../library/layout-library.js';
import {
    ROLE_TYPES, listLayoutRoles, addLayoutRole, removeLayoutRole, renameLayoutRole, setLayoutRoleType,
} from '../library/role-library.js';
import { onLibraryChange } from '../storage/store.js';
import { getBoundRoleIds, onBindingsChange } from '../panels/panel-manager.js';
import { getSessionState, onSessionChange } from '../chat/chat-session.js';
import { getRole, onRolesChange, refreshRoles } from '../chat/variable-service.js';
import { parseRoleId, rolePublicName } from '../elements/element-model.js';
import { confirmYesNo, promptText, notify } from './dialogs.js';

let renderToken = 0;

function statusIcon(role) {
    const icon = document.createElement('i');
    if (!role || !role.exists) {
        icon.className = 'fa-solid fa-triangle-exclamation pp-role-status pp-role-status-problem';
        icon.title = 'Not defined in State Engine yet';
    } else if (role.valid) {
        icon.className = 'fa-solid fa-check pp-role-status pp-role-status-ok';
        icon.title = `Assigned: ${role.variable}`;
    } else if (role.problem) {
        icon.className = 'fa-solid fa-triangle-exclamation pp-role-status pp-role-status-problem';
        icon.title = role.problem;
    } else {
        icon.className = 'fa-solid fa-circle-exclamation pp-role-status pp-role-status-missing';
        icon.title = 'Not assigned in this chat';
    }
    return icon;
}

// One row. `layoutRole` is set for this layout's own roles (editable).
function buildRow(id, layoutRole, chatId) {
    const role = getRole(id);
    const row = document.createElement('div');
    row.className = 'pp-layout-role-row';
    row.dataset.id = id;

    const name = document.createElement('span');
    name.className = 'pp-layout-role-name';
    name.textContent = rolePublicName(id);
    const shared = layoutRole?.sharedWith?.length ? `\nShared with: ${layoutRole.sharedWith.join(', ')}` : '';
    name.title = `${id}${layoutRole ? '' : `\nFrom namespace "${parseRoleId(id)?.namespace ?? '?'}" - bound by this layout's elements`}${shared}`;
    if (layoutRole?.sharedWith?.length) name.classList.add('pp-layout-role-shared');

    const type = document.createElement('select');
    type.className = 'text_pole pp-layout-role-type';
    type.replaceChildren(...ROLE_TYPES.map((t) => new Option(t, t)));
    type.value = layoutRole?.type ?? role?.type ?? 'any';
    type.disabled = !layoutRole;
    type.title = layoutRole ? 'What kind of variable can fulfil it' : `Defined by namespace "${parseRoleId(id)?.namespace ?? '?'}"`;

    const variable = document.createElement('select');
    variable.className = 'text_pole pp-layout-role-variable';
    variable.title = `This chat's variable for ${id}`;
    variable.replaceChildren(new Option('— not assigned —', ''));
    variable.disabled = !chatId || !role?.exists;
    if (role?.variable) {
        variable.add(new Option(role.variable, role.variable));
        variable.value = role.variable;
    }

    row.append(statusIcon(role), name, type, variable);
    if (layoutRole) {
        row.insertAdjacentHTML('beforeend', `
            <div class="menu_button fa-solid fa-pen" data-role-action="rename" title="Rename this role"></div>
            <div class="menu_button fa-solid fa-xmark" data-role-action="remove" title="Remove this role from the layout"></div>
        `);
    }
    return row;
}

// Fills each row's variable dropdown with the chat's fitting variables.
async function fillCandidates(list, chatId, token) {
    for (const row of list.querySelectorAll('.pp-layout-role-row')) {
        const select = row.querySelector('.pp-layout-role-variable');
        if (select.disabled) continue;
        let candidates = [];
        try {
            candidates = (await getRoleCandidates(EXTENSION_ID, chatId, row.dataset.id)) ?? [];
        } catch (err) {
            console.warn('[PrettyPanels] could not list variables for a role', err);
        }
        if (token !== renderToken) return;
        const current = select.value;
        select.replaceChildren(new Option('— not assigned —', ''), ...candidates.map((c) => {
            const option = new Option(`${c.label} (${c.type})`, c.name);
            option.title = c.name;
            return option;
        }));
        // An assignment that no longer fits stays visible (and selected).
        if (current && !candidates.some((c) => c.name === current)) select.add(new Option(`${current} (unusable)`, current), 1);
        select.value = current;
    }
}

function render() {
    const section = document.getElementById('pp_layout_roles');
    const list = document.getElementById('pp_layout_roles_list');
    if (!section || !list) return;
    const token = ++renderToken;
    const { chatId, layoutId } = getSessionState();
    const create = section.querySelector('.pp-layout-roles-create');
    create.hidden = !layoutId;
    if (!layoutId) {
        const empty = document.createElement('div');
        empty.className = 'pp-template-empty';
        empty.textContent = chatId ? 'Select a layout for this chat to see its roles.' : 'Open a chat and select a layout to see its roles.';
        list.replaceChildren(empty);
        return;
    }
    const own = listLayoutRoles(layoutId);
    const ownIds = new Set(own.map((r) => r.id));
    const others = getBoundRoleIds().filter((id) => !ownIds.has(id));
    const rows = [...own.map((r) => buildRow(r.id, r, chatId)), ...others.map((id) => buildRow(id, null, chatId))];
    if (rows.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pp-template-empty';
        empty.textContent = 'This layout has no roles yet. Add one below, then bind elements to it from a panel\'s Roles palette.';
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(...rows);
    void fillCandidates(list, chatId, token);
}

async function onListChange(e) {
    const row = e.target.closest('.pp-layout-role-row');
    if (!row) return;
    const id = row.dataset.id;
    const publicName = rolePublicName(id);
    if (e.target.classList.contains('pp-layout-role-type')) {
        const role = listLayoutRoles(getActiveLayoutId()).find((r) => r.id === id);
        if (role?.sharedWith.length && !await confirmYesNo(`"${publicName}" is shared with ${role.sharedWith.join(', ')}. Change its type for every layout?`)) {
            render();
            return;
        }
        setLayoutRoleType(publicName, e.target.value);
    } else if (e.target.classList.contains('pp-layout-role-variable')) {
        const { chatId } = getSessionState();
        try {
            const result = await assignRole(EXTENSION_ID, chatId, id, e.target.value || null);
            if (result === null) notify('warning', 'State Engine refused that variable for this role (see the browser console).');
        } catch (err) {
            console.warn('[PrettyPanels] could not assign the role', err);
            notify('warning', 'Pretty Panels could not assign the role in State Engine.');
        }
        await refreshRoles();
    }
}

async function onListClick(e) {
    const button = e.target.closest('[data-role-action]');
    const row = button?.closest('.pp-layout-role-row');
    if (!row) return;
    const layoutId = getActiveLayoutId();
    const role = listLayoutRoles(layoutId).find((r) => r.id === row.dataset.id);
    if (!role) return;
    if (button.dataset.roleAction === 'rename') {
        const to = await promptText(`Rename the role "${role.publicName}":`, role.publicName);
        if (!to || to === role.publicName) return;
        if (role.sharedWith.length && !await confirmYesNo(`"${role.publicName}" is shared with ${role.sharedWith.join(', ')}. Rename it for every layout?`)) return;
        const result = renameLayoutRole(role.publicName, to.trim());
        if (!result.ok) notify('warning', result.error);
    } else if (button.dataset.roleAction === 'remove') {
        const note = role.sharedWith.length
            ? `It stays in ${role.sharedWith.join(', ')}.`
            : 'No other layout uses it, so it is deleted from State Engine, with every chat\'s variable for it.';
        if (!await confirmYesNo(`Remove the role "${role.publicName}" from this layout? ${note}`)) return;
        removeLayoutRole(layoutId, role.publicName);
    }
}

function onAdd() {
    const nameField = document.getElementById('pp_layout_role_name');
    const publicName = nameField.value.trim();
    if (!publicName) return;
    const result = addLayoutRole(getActiveLayoutId(), { publicName, type: document.getElementById('pp_layout_role_type').value });
    if (!result.ok) {
        notify('warning', result.error);
        return;
    }
    nameField.value = '';
    if (result.shared) notify('info', `"${publicName}" is already a role in another layout - this layout now shares it (type: ${result.type}).`);
}

export function initLayoutRolesDrawer() {
    const list = document.getElementById('pp_layout_roles_list');
    if (!list) return;
    const type = document.getElementById('pp_layout_role_type');
    type.replaceChildren(...ROLE_TYPES.map((t) => new Option(t, t)));
    type.value = 'text';
    list.addEventListener('change', (e) => void onListChange(e));
    list.addEventListener('click', (e) => void onListClick(e));
    document.getElementById('pp_layout_role_add').addEventListener('click', onAdd);
    document.getElementById('pp_layout_role_name').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') onAdd();
    });
    onSessionChange(render);
    onLibraryChange(render);
    onRolesChange(render);
    // An element bound to (or unbound from) another namespace's role.
    onBindingsChange(() => render());
    render();
}
