// The drawer's Layout Panels section (markup in settings.html): every panel
// of the layout on screen with when it shows (src/panels/panel-display.js),
// so conditional panels and banners - hidden most of the time, and in
// Editing Mode unless pinned - can still be found and edited:
//   - pin / unpin: show a conditional panel in Editing Mode (per session)
//   - preview: play its animation once (in, hold, out)
//   - properties: Editing Mode on, the panel pinned and its properties open

import { listPanels, onPanelRecordsChange } from '../panels/panel-registry.js';
import { previewPanelDisplay, openPanelProperties, onStateChange } from '../panels/panel-manager.js';
import { describeDisplay, isConditional, isPinned, setPinned, onPinChange } from '../panels/panel-display.js';
import { onLibraryChange } from '../storage/store.js';
import { getSessionState, onSessionChange } from '../chat/chat-session.js';

function render() {
    const list = document.getElementById('pp_layout_panels_list');
    if (!list) return;
    const panels = getSessionState().layoutId ? listPanels() : [];
    if (panels.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'pp-template-empty';
        empty.textContent = getSessionState().layoutId ? 'This layout has no panels yet.' : 'No layout is shown in this chat.';
        list.replaceChildren(empty);
        return;
    }
    list.replaceChildren(...panels.map((record) => {
        const conditional = isConditional(record.display);
        const pinned = conditional && isPinned(record.id);
        const row = document.createElement('div');
        row.className = 'pp-template-row pp-layout-panel-row';
        row.dataset.id = record.id;
        row.innerHTML = `
            <span class="pp-template-name"></span>
            <span class="pp-layout-panel-mode"></span>
            <div class="menu_button fa-solid fa-thumbtack${pinned ? ' pp-active' : ''}" data-action="pin" title="${pinned ? 'Unpin: hide it again in Editing Mode' : 'Pin: show it in Editing Mode so it can be edited'}"${conditional ? '' : ' hidden'}></div>
            <div class="menu_button fa-solid fa-play" data-action="preview" title="Preview: play its animation once"></div>
            <div class="menu_button fa-solid fa-sliders" data-action="properties" title="Open its properties (turns on Editing Mode)"></div>
        `;
        row.querySelector('.pp-template-name').textContent = record.name;
        row.querySelector('.pp-template-name').title = record.name;
        const mode = describeDisplay(record.display);
        row.querySelector('.pp-layout-panel-mode').textContent = mode;
        row.querySelector('.pp-layout-panel-mode').title = mode;
        return row;
    }));
}

const actions = {
    pin: (id) => setPinned(id, !isPinned(id)),
    preview: (id) => previewPanelDisplay(id),
    properties: (id) => openPanelProperties(id),
};

export function initLayoutPanelsDrawer() {
    const list = document.getElementById('pp_layout_panels_list');
    if (!list) return;
    list.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        const row = button?.closest('.pp-layout-panel-row');
        if (row) actions[button.dataset.action]?.(row.dataset.id);
    });
    render();
    onPanelRecordsChange(render);
    onLibraryChange(render);
    onSessionChange(render);
    onPinChange(render);
    onStateChange(render);
}
