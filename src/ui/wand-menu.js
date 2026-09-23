// Magic Wand (#extensionsMenu) entries: "New Pretty Panel" and an
// Editing Mode toggle. Only wiring lives here - the actual behaviour is
// in src/panels/panel-manager.js.

import { createPanel, toggleEditingMode, isEditingMode, onEditingModeChange } from '../panels/panel-manager.js';

const NEW_PANEL_ID = 'pp-wand-new-panel';
const EDIT_MODE_ID = 'pp-wand-editing-mode';

function renderEditingState(enabled) {
    const item = document.getElementById(EDIT_MODE_ID);
    if (!item) return;
    item.classList.toggle('pp-wand-active', enabled);
    item.querySelector('.pp-wand-state').className = `pp-wand-state fa-solid ${enabled ? 'fa-toggle-on' : 'fa-toggle-off'}`;
}

export function addWandMenuItems() {
    const menu = document.getElementById('extensionsMenu');
    if (!menu || document.getElementById(NEW_PANEL_ID)) return;

    menu.insertAdjacentHTML('beforeend', `
        <div id="${NEW_PANEL_ID}" class="list-group-item flex-container flexGap5">
            <div class="extensionsMenuExtensionButton fa-solid fa-table-columns"></div>
            <span>New Pretty Panel</span>
        </div>
        <div id="${EDIT_MODE_ID}" class="list-group-item flex-container flexGap5">
            <div class="extensionsMenuExtensionButton fa-solid fa-pen-ruler"></div>
            <span>Panel Editing Mode</span>
            <i class="pp-wand-state fa-solid fa-toggle-off"></i>
        </div>
    `);

    document.getElementById(NEW_PANEL_ID).addEventListener('click', () => createPanel());
    document.getElementById(EDIT_MODE_ID).addEventListener('click', () => toggleEditingMode());

    renderEditingState(isEditingMode());
    onEditingModeChange(renderEditingState);
}
