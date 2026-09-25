// Pretty Panels drawer in SillyTavern's Extensions settings - the home
// for every global Pretty Panels control. Rendered from settings.html
// and appended to #extensions_settings2, the same way State Engine's own
// drawer is. Toggles write through panel-manager.js, which updates the
// registry and the page immediately. The Layout Library and Panel
// Library sections are wired in src/ui/library-drawer.js.

import { getState, onStateChange, setEnabled, setEditingMode, getGrid, setGrid } from '../panels/panel-manager.js';
import { initLibraryDrawer } from './library-drawer.js';
import { openThemeEditor } from './theme-editor.js';

// SillyTavern resolves extension templates relative to
// public/scripts/extensions/, i.e. "third-party/<folder name>". Derived
// from this file's own URL so a renamed install folder still works.
const EXTENSION_FOLDER = decodeURIComponent(new URL('../../', import.meta.url).pathname.split('/').filter(Boolean).pop());
const TEMPLATE_PATH = `third-party/${EXTENSION_FOLDER}`;

function renderState({ enabled, editingMode }) {
    const enabledBox = document.getElementById('pp_enabled');
    const editingBox = document.getElementById('pp_editing_mode');
    if (!enabledBox || !editingBox) return;
    enabledBox.checked = enabled;
    editingBox.checked = editingMode;
    editingBox.disabled = !enabled;
    editingBox.closest('label')?.classList.toggle('disabled', !enabled);
}

export async function addSettingsDrawer() {
    if (document.getElementById('pretty_panels_settings')) return;

    let html;
    try {
        html = await SillyTavern.getContext().renderExtensionTemplateAsync(TEMPLATE_PATH, 'settings');
    } catch (err) {
        console.error('[PrettyPanels] failed to load settings.html template', err);
        return;
    }

    const container = document.getElementById('extensions_settings2');
    if (!container) return;
    container.insertAdjacentHTML('beforeend', html);

    document.getElementById('pp_enabled').addEventListener('change', (e) => setEnabled(e.target.checked));
    document.getElementById('pp_editing_mode').addEventListener('change', (e) => setEditingMode(e.target.checked));
    document.getElementById('pp_theme_editor').addEventListener('click', () => openThemeEditor());

    const snapBox = document.getElementById('pp_snap_to_grid');
    const sizeInput = document.getElementById('pp_grid_size');
    const renderGrid = ({ snap, size }) => {
        snapBox.checked = snap;
        sizeInput.value = String(size);
        sizeInput.disabled = !snap;
    };
    snapBox.addEventListener('change', () => renderGrid(setGrid({ snap: snapBox.checked })));
    sizeInput.addEventListener('change', () => renderGrid(setGrid({ size: Number(sizeInput.value) })));
    renderGrid(getGrid());

    renderState(getState());
    onStateChange(renderState);

    initLibraryDrawer();
}
