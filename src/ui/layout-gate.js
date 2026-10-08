// What Pretty Panels shows on screen about the chat's layout, beside the
// panels themselves (src/chat/chat-session.js decides; this only draws):
//
//   - A chat is open and has no layout: the screen stays empty except for
//     a small card, "Select a layout to use for this chat.", with the
//     layouts to pick from.
//   - The shown layout needs State Engine roles this chat has not assigned
//     (or assigned to an unusable variable): a warning naming them and
//     where to assign them. The layout is still drawn - those elements show
//     blank. The warning can be dismissed; it returns when the set of
//     missing roles changes.
//
// Nothing shows while Pretty Panels is disabled.

import { listLayouts } from '../library/layout-library.js';
import { onLibraryChange } from '../storage/store.js';
import { getState, onStateChange } from '../panels/panel-manager.js';
import { chooseLayout, getSessionState, onSessionChange } from '../chat/chat-session.js';

let promptEl = null;
let warningEl = null;
// The missing-roles set the user dismissed (joined names), if any.
let dismissedMissing = null;

function buildPrompt() {
    const el = document.createElement('div');
    el.className = 'pp-layout-prompt';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Pretty Panels layout');
    el.innerHTML = `
        <div class="pp-layout-prompt-title"><i class="fa-solid fa-table-columns"></i> Pretty Panels</div>
        <div class="pp-layout-prompt-text">Select a layout to use for this chat.</div>
        <div class="pp-layout-prompt-row">
            <select class="text_pole pp-layout-prompt-select" aria-label="Layout"></select>
            <div class="menu_button pp-layout-prompt-use">Use</div>
        </div>
    `;
    el.querySelector('.pp-layout-prompt-use').addEventListener('click', () => {
        const id = el.querySelector('.pp-layout-prompt-select').value;
        if (id) void chooseLayout(id);
    });
    document.body.appendChild(el);
    return el;
}

function buildWarning() {
    const el = document.createElement('div');
    el.className = 'pp-role-warning';
    el.setAttribute('role', 'status');
    el.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div class="pp-role-warning-text">
            <div class="pp-role-warning-title"></div>
            <div class="pp-role-warning-roles"></div>
        </div>
        <div class="pp-role-warning-close fa-solid fa-xmark" title="Hide until this changes"></div>
    `;
    el.querySelector('.pp-role-warning-close').addEventListener('click', () => {
        dismissedMissing = getSessionState().missingRoles.join('|');
        render();
    });
    document.body.appendChild(el);
    return el;
}

function renderPrompt(show) {
    if (!show) {
        if (promptEl) promptEl.hidden = true;
        return;
    }
    promptEl ??= buildPrompt();
    const select = promptEl.querySelector('.pp-layout-prompt-select');
    const current = select.value;
    select.replaceChildren(...listLayouts().map((layout) => new Option(layout.name, layout.id)));
    if ([...select.options].some((o) => o.value === current)) select.value = current;
    promptEl.hidden = false;
}

function renderWarning(missing, failed) {
    const key = missing.join('|');
    const show = (missing.length > 0 || failed) && key !== dismissedMissing;
    if (!show) {
        if (warningEl) warningEl.hidden = true;
        return;
    }
    warningEl ??= buildWarning();
    warningEl.querySelector('.pp-role-warning-title').textContent = missing.length > 0
        ? 'Required roles are not assigned. Open State Engine → Roles Panel to assign them.'
        : 'Pretty Panels could not check this layout\'s roles - update State Engine for role support.';
    const roles = warningEl.querySelector('.pp-role-warning-roles');
    roles.replaceChildren(...missing.map((name) => {
        const code = document.createElement('code');
        code.textContent = name;
        return code;
    }));
    roles.hidden = missing.length === 0;
    warningEl.hidden = false;
}

function render() {
    const { enabled } = getState();
    const { chatId, layoutId, missingRoles, roleCheckFailed } = getSessionState();
    renderPrompt(enabled && !!chatId && !layoutId);
    renderWarning(enabled && layoutId ? missingRoles : [], enabled && !!layoutId && roleCheckFailed);
}

export function initLayoutGate() {
    onSessionChange((state) => {
        // A different set of missing roles is news: show it again.
        if (state.missingRoles.join('|') !== dismissedMissing) dismissedMissing = null;
        render();
    });
    onStateChange(render);
    onLibraryChange(render);
    render();
}
