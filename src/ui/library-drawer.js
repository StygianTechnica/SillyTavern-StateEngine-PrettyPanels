// The Layout Library and Panel Library sections of the Pretty Panels
// drawer (markup in settings.html). Layout actions: select active, new,
// duplicate, rename, delete, export, import. Panel Library management:
// view, rename, delete, export, import - none of which touch the active
// layout or create instances. Both lists re-render on any library change.

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
import { KIND, readPayload } from '../library/format.js';
import { onLibraryChange } from '../storage/store.js';
import { switchLayout, removeLayout } from '../panels/panel-manager.js';
import { confirmYesNo, promptText, notify } from './dialogs.js';
import { downloadJson, pickJsonFile, safeFilename } from './files.js';

function renderLayouts() {
    const select = document.getElementById('pp_layout_select');
    if (!select) return;
    const activeId = getActiveLayoutId();
    select.replaceChildren(...listLayouts().map((layout) => {
        const option = document.createElement('option');
        option.value = layout.id;
        option.textContent = layout.name;
        option.selected = layout.id === activeId;
        return option;
    }));
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

function render() {
    renderLayouts();
    renderTemplates();
}

async function importFile(kind, apply) {
    const text = await pickJsonFile();
    if (text === null) return;
    try {
        apply(readPayload(text, kind));
    } catch (err) {
        notify('error', err.message);
    }
}

const layoutActions = {
    async new() {
        const name = await promptText('Name for the new layout:', 'New Layout');
        if (!name) return;
        switchLayout(createLayout(name));
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
        if (ok) removeLayout(id);
    },
    export(id) {
        const payload = exportLayout(id);
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
    export(id) {
        const payload = exportTemplate(id);
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

export function initLibraryDrawer() {
    const root = document.getElementById('pretty_panels_settings');
    if (!root) return;

    document.getElementById('pp_layout_select').addEventListener('change', (e) => switchLayout(e.target.value));

    root.querySelectorAll('[data-layout-action]').forEach((button) => {
        button.addEventListener('click', () => {
            void layoutActions[button.dataset.layoutAction](getActiveLayoutId());
        });
    });

    document.getElementById('pp_template_import').addEventListener('click', () => void templateActions.import());
    document.getElementById('pp_template_list').addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        const row = button?.closest('.pp-template-row');
        if (row) void templateActions[button.dataset.action](row.dataset.id);
    });

    render();
    onLibraryChange(render);
}
