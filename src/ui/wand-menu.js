// Magic Wand (#extensionsMenu) entry: "New Pretty Panel", shown only
// while the extension is enabled AND Editing Mode is on. Editing Mode
// itself is a global setting and lives in the settings drawer
// (src/ui/settings-drawer.js), not here. Only wiring lives here - the
// actual behaviour is in src/panels/panel-manager.js.

import { createPanel, getState, onStateChange } from '../panels/panel-manager.js';

const NEW_PANEL_ID = 'pp-wand-new-panel';

function renderState({ enabled, editingMode }) {
    const item = document.getElementById(NEW_PANEL_ID);
    if (item) item.style.display = enabled && editingMode ? '' : 'none';
}

export function addWandMenuItems() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById(NEW_PANEL_ID)) return;

    menu.insertAdjacentHTML('beforeend', `
        <div id="${NEW_PANEL_ID}" class="list-group-item flex-container flexGap5">
            <div class="extensionsMenuExtensionButton fa-solid fa-table-columns"></div>
            <span>New Pretty Panel</span>
        </div>
    `);

    document.getElementById(NEW_PANEL_ID).addEventListener('click', () => createPanel());

    renderState(getState());
    onStateChange(renderState);
}
