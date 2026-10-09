// The Layout Library, Panel Library and Character Templates sections of the Pretty Panels
// drawer (markup in settings.html). Layout actions: choose this chat's
// layout (src/chat/chat-session.js), new, duplicate, rename, delete,
// export, import - all but new and import act on the layout on screen, so
// they need one shown. Panel Library management:
// view, rename, delete, export, import - none of which touch the active
// layout or create instances. Character Templates: new, edit (the
// template editor), rename, duplicate, export, delete, import. Every list
// re-renders on any library change.

import {
    listLayouts,
    getLayout,
    getActiveLayoutId,
    createLayout,
    duplicateLayout,
    renameLayout,
    exportLayout,
    importLayout,
} from '../library/layout-library.js';
import {
    listTemplates,
    renameTemplate,
    deleteTemplate,
    exportTemplate,
    importTemplate,
} from '../library/panel-library.js';
import {
    listCharacterTemplates,
    createCharacterTemplate,
    renameCharacterTemplate,
    duplicateCharacterTemplate,
    deleteCharacterTemplate,
    exportCharacterTemplate,
    importCharacterTemplate,
} from '../library/character-template-library.js';
import { openTemplateEditor } from '../panels/template-editor.js';
import { KIND, readPayload } from '../library/format.js';
import { onLibraryChange } from '../storage/store.js';
import { removeLayout } from '../panels/panel-manager.js';
import { chooseLayout, showChatLayout, getSessionState, onSessionChange } from '../chat/chat-session.js';
import { confirmYesNo, promptText, notify } from './dialogs.js';
import { downloadJson, pickJsonFile, safeFilename } from './files.js';
import { attachFonts, receiveFonts } from './font-transfer.js';

// While no layout is shown (a chat that hasn't chosen one), the list
// starts with a selected "Select a layout" entry - so picking ANY layout
// is a change that shows it and records it for the chat.
function renderLayouts() {
    const select = document.getElementById('pp_layout_select');
    if (!select) return;
    const { layoutId } = getSessionState();
    const options = listLayouts().map((layout) => new Option(layout.name, layout.id));
    let selectedValue = layoutId;
    if (!layoutId) {
        options.unshift(new Option('— Select a layout —', ''));
        selectedValue = '';
    }
    select.replaceChildren(...options);
    select.value = selectedValue;
    // A layout is chosen FOR a chat: without one open there is nothing to choose for.
    select.disabled = !getSessionState().chatId;
    renderChatHint();
}

function renderChatHint() {
    const hint = document.getElementById('pp_layout_chat_hint');
    if (!hint) return;
    const { chatId, chosen } = getSessionState();
    if (!chatId) hint.textContent = 'Open a chat to choose its layout.';
    else if (chosen) hint.textContent = 'This chat\'s layout.';
    else hint.textContent = 'This chat hasn\'t chosen a layout, so none is shown. Pick one to use it in this chat.';
}

function renderTemplates() {
    const list = document.getElementById('pp_template_list');
    if (!list) return;
    const templates = listTemplates();
    if (templates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pp-template-empty';
        empty.textContent = 'No templates yet. Save one from a panel\'s properties.';
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(...templates.map((t) => {
        const row = document.createElement('div');
        row.className = 'pp-template-row';
        row.dataset.id = t.id;
        row.innerHTML = `
            <span class="pp-template-name"></span>
            <span class="pp-template-size"></span>
            <div class="menu_button fa-solid fa-pen" data-action="rename" title="Rename template"></div>
            <div class="menu_button fa-solid fa-file-export" data-action="export" title="Export template"></div>
            <div class="menu_button fa-solid fa-trash-can" data-action="delete" title="Delete template"></div>
        `;
        row.querySelector('.pp-template-name').textContent = t.name;
        row.querySelector('.pp-template-name').title = t.name;
        row.querySelector('.pp-template-size').textContent = `${t.width} × ${t.height}`;
        return row;
    }));
}

function renderCharacterTemplates() {
    const list = document.getElementById('pp_char_template_list');
    if (!list) return;
    const templates = listCharacterTemplates();
    if (templates.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pp-template-empty';
        empty.textContent = 'No character templates yet.';
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(...templates.map((t) => {
        const row = document.createElement('div');
        row.className = 'pp-template-row';
        row.dataset.id = t.id;
        row.innerHTML = `
            <span class="pp-template-name"></span>
            <span class="pp-template-size"></span>
            <div class="menu_button fa-solid fa-pen-ruler" data-action="edit" title="Edit in the template editor"></div>
            <div class="menu_button fa-solid fa-pen" data-action="rename" title="Rename template"></div>
            <div class="menu_button fa-solid fa-clone" data-action="duplicate" title="Duplicate template"></div>
            <div class="menu_button fa-solid fa-file-export" data-action="export" title="Export template (with its bindings and roles)"></div>
            <div class="menu_button fa-solid fa-trash-can" data-action="delete" title="Delete template"></div>
        `;
        row.querySelector('.pp-template-name').textContent = t.name;
        row.querySelector('.pp-template-name').title = t.name;
        row.querySelector('.pp-template-size').textContent = `${t.width} × ${t.height}`;
        return row;
    }));
}

function render() {
    renderLayouts();
    renderTemplates();
    renderCharacterTemplates();
}

async function importFile(kind, apply) {
    const text = await pickJsonFile();
    if (text === null) return;
    try {
        apply(await receiveFonts(readPayload(text, kind)));
    } catch (err) {
        notify('error', err.message);
    }
}

const layoutActions = {
    async new() {
        const name = await promptText('Name for the new layout:', 'New Layout');
        if (!name) return;
        const id = createLayout(name);
        // Shown (and chosen) only for an open chat.
        if (!await chooseLayout(id)) notify('success', `Created "${getLayout(id).name}". Open a chat to use it.`);
    },
    duplicate(id) {
        const newId = duplicateLayout(id);
        if (newId) notify('success', `Created "${getLayout(newId).name}".`);
    },
    async rename(id) {
        const layout = getLayout(id);
        const name = layout && await promptText('Rename layout:', layout.name);
        if (name) renameLayout(id, name);
    },
    async delete(id) {
        const layout = getLayout(id);
        if (!layout) return;
        if (listLayouts().length <= 1) {
            notify('warning', 'This is the only layout, so it can\'t be deleted.');
            return;
        }
        const ok = await confirmYesNo(`Delete the layout "${layout.name}" and its ${layout.panelCount} panel(s)? This cannot be undone.`);
        if (ok && removeLayout(id)) await showChatLayout();
    },
    async export(id) {
        const payload = exportLayout(id) && await attachFonts(exportLayout(id));
        if (payload) downloadJson(`${safeFilename(payload.data.name)}.layout.json`, payload);
    },
    import() {
        return importFile(KIND.LAYOUT, (data) => {
            const layout = getLayout(importLayout(data));
            notify('success', `Imported "${layout.name}". Select it above to use it.`);
        });
    },
};

const templateActions = {
    async rename(id) {
        const current = listTemplates().find((t) => t.id === id);
        const name = current && await promptText('Rename template:', current.name);
        if (name) renameTemplate(id, name);
    },
    async export(id) {
        const payload = exportTemplate(id) && await attachFonts(exportTemplate(id));
        if (payload) downloadJson(`${safeFilename(payload.data.name)}.panel.json`, payload);
    },
    async delete(id) {
        const current = listTemplates().find((t) => t.id === id);
        if (!current) return;
        const ok = await confirmYesNo(`Delete the template "${current.name}"? Panels already created from it are not affected.`);
        if (ok) deleteTemplate(id);
    },
    import() {
        return importFile(KIND.PANEL_TEMPLATE, (data) => {
            const saved = importTemplate(data);
            notify('success', `Imported "${saved.name}" into the Panel Library.`);
        });
    },
};

const characterTemplateActions = {
    async new() {
        const name = await promptText('Name for the new character template:', 'Character Card');
        if (!name) return;
        openTemplateEditor(createCharacterTemplate(name).id);
    },
    edit(id) {
        openTemplateEditor(id);
    },
    async rename(id) {
        const current = listCharacterTemplates().find((t) => t.id === id);
        const name = current && await promptText('Rename character template:', current.name);
        if (name) renameCharacterTemplate(id, name);
    },
    duplicate(id) {
        const copy = duplicateCharacterTemplate(id);
        if (copy) notify('success', `Created "${copy.name}".`);
    },
    async export(id) {
        const payload = exportCharacterTemplate(id) && await attachFonts(exportCharacterTemplate(id));
        if (payload) downloadJson(`${safeFilename(payload.data.name)}.character.json`, payload);
    },
    async delete(id) {
        const current = listCharacterTemplates().find((t) => t.id === id);
        if (!current) return;
        const ok = await confirmYesNo(`Delete the character template "${current.name}"? Character elements using it go back to the built-in card.`);
        if (ok) deleteCharacterTemplate(id);
    },
    import() {
        return importFile(KIND.CHARACTER_TEMPLATE, (data) => {
            const { summary, conflicts } = importCharacterTemplate(data);
            notify('success', `Imported "${summary.name}" into Character Templates.`);
            if (conflicts.length) notify('warning', `These roles already existed with another type and kept it: ${conflicts.join(', ')}.`);
        });
    },
};

export function initLibraryDrawer() {
    const root = document.getElementById('pretty_panels_settings');
    if (!root) return;

    document.getElementById('pp_layout_select').addEventListener('change', (e) => {
        if (e.target.value) void chooseLayout(e.target.value);
    });

    // New and import need no layout; the rest act on the one on screen.
    const needsLayout = new Set(['duplicate', 'rename', 'delete', 'export']);
    root.querySelectorAll('[data-layout-action]').forEach((button) => {
        button.addEventListener('click', () => {
            const action = button.dataset.layoutAction;
            if (needsLayout.has(action) && !getSessionState().layoutId) {
                notify('info', 'Select a layout first.');
                return;
            }
            void layoutActions[action](getActiveLayoutId());
        });
    });

    document.getElementById('pp_template_import').addEventListener('click', () => void templateActions.import());
    document.getElementById('pp_template_list').addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        const row = button?.closest('.pp-template-row');
        if (row) void templateActions[button.dataset.action](row.dataset.id);
    });

    document.getElementById('pp_char_template_new')?.addEventListener('click', () => void characterTemplateActions.new());
    document.getElementById('pp_char_template_import')?.addEventListener('click', () => void characterTemplateActions.import());
    document.getElementById('pp_char_template_list')?.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        const row = button?.closest('.pp-template-row');
        if (row) void characterTemplateActions[button.dataset.action](row.dataset.id);
    });

    render();
    onLibraryChange(render);
    onSessionChange(renderLayouts);
}
