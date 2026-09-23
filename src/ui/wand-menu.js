// Magic Wand (#extensionsMenu) entries, shown only while the extension
// is enabled AND Editing Mode is on:
//   - Add New Panel
//   - Add Panel from Template (picks from the Panel Library)
// Both only create a new panel instance in the active layout - they
// never modify templates or library metadata. Saving to the library
// lives in each panel's properties pane, since only there is it clear
// WHICH panel is being saved. Editing Mode itself is a global setting
// in the settings drawer (src/ui/settings-drawer.js).

import { createPanel, insertTemplate, getState, onStateChange } from '../panels/panel-manager.js';
import { listTemplates } from '../library/panel-library.js';
import { chooseFromList } from './dialogs.js';

const NEW_PANEL_ID = 'pp-wand-new-panel';
const FROM_TEMPLATE_ID = 'pp-wand-panel-from-template';

function renderState({ enabled, editingMode }) {
    for (const id of [NEW_PANEL_ID, FROM_TEMPLATE_ID]) {
        const item = document.getElementById(id);
        if (item) item.style.display = enabled && editingMode ? '' : 'none';
    }
}

async function addFromTemplate() {
    const templateId = await chooseFromList({
        title: 'Add Panel from Template',
        items: listTemplates().map((t) => ({ value: t.id, label: t.name, detail: `${t.width} × ${t.height}` })),
        emptyText: 'The Panel Library is empty. Save a panel to it from that panel\'s properties.',
    });
    if (templateId) insertTemplate(templateId);
}

export function addWandMenuItems() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById(NEW_PANEL_ID)) return;

    menu.insertAdjacentHTML('beforeend', `
        <div id="${NEW_PANEL_ID}" class="list-group-item flex-container flexGap5">
            <div class="extensionsMenuExtensionButton fa-solid fa-table-columns"></div>
            <span>Add New Panel</span>
        </div>
        <div id="${FROM_TEMPLATE_ID}" class="list-group-item flex-container flexGap5">
            <div class="extensionsMenuExtensionButton fa-solid fa-shapes"></div>
            <span>Add Panel from Template</span>
        </div>
    `);

    document.getElementById(NEW_PANEL_ID).addEventListener('click', () => createPanel());
    document.getElementById(FROM_TEMPLATE_ID).addEventListener('click', () => void addFromTemplate());

    renderState(getState());
    onStateChange(renderState);
}
