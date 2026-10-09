// The drawer's Atmosphere section (markup in settings.html): the global
// switch and intensity scale, and the effect layers of the layout on screen
// - each an effect, the flag that turns it on, an intensity, a preview
// toggle (show it now, whatever the flag) and delete.

import { EFFECTS, createLayer, MAX_LAYERS, SCALE_LIMITS } from '../atmosphere/atmosphere-model.js';
import { getLayoutAtmosphere, setLayoutAtmosphere, onAtmosphereChange, getActiveLayoutId } from '../library/layout-library.js';
import { getAtmosphereSettings, setAtmosphereSettings, onAtmosphereSettingsChange } from '../panels/panel-registry.js';
import { isLayerPreviewed, setLayerPreview, onLayerPreviewChange } from '../atmosphere/atmosphere-controller.js';
import { getCatalog, onCatalogChange, loadCatalog } from '../chat/variable-service.js';
import { getSessionState, onSessionChange } from '../chat/chat-session.js';
import { onLibraryChange } from '../storage/store.js';

const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));

function layoutId() {
    return getSessionState().layoutId ? getActiveLayoutId() : null;
}

// Flag suggestions: boolean and calculated variables of the catalog.
function renderFlagOptions() {
    const list = document.getElementById('pp_atmo_flags');
    if (!list) return;
    list.replaceChildren(...getCatalog().flatMap((preset) => preset.variables
        .filter((def) => def.type === 'boolean' || def.type === 'calculated')
        .map((def) => {
            const option = document.createElement('option');
            option.value = def.name;
            option.label = `${def.label || def.name} · ${preset.name}`;
            return option;
        })));
}

function renderSettings() {
    const settings = getAtmosphereSettings();
    const enabled = document.getElementById('pp_atmo_enabled');
    const scale = document.getElementById('pp_atmo_scale');
    if (!enabled || !scale) return;
    enabled.checked = settings.enabled;
    if (scale !== document.activeElement) scale.value = String(settings.scale);
    document.getElementById('pp_atmo_scale_value').textContent = `${settings.scale}%`;
}

function renderLayers() {
    const list = document.getElementById('pp_atmo_layers');
    if (!list) return;
    const id = layoutId();
    const add = document.getElementById('pp_atmo_add');
    if (!id) {
        list.innerHTML = '<div class="pp-template-empty">No layout is shown in this chat.</div>';
        add.hidden = true;
        return;
    }
    const layers = getLayoutAtmosphere(id);
    add.hidden = layers.length >= MAX_LAYERS;
    if (layers.length === 0) {
        list.innerHTML = '<div class="pp-template-empty">No effects yet. Add one, then pick the flag that turns it on.</div>';
        return;
    }
    list.innerHTML = layers.map((layer) => `
        <div class="pp-atmo-layer" data-layer="${escapeHtml(layer.id)}">
            <select class="text_pole" data-atmo="effect" title="The effect">
                ${EFFECTS.map(([value, label]) => `<option value="${value}"${value === layer.effect ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}
            </select>
            <input type="text" class="text_pole" data-atmo="flag" list="pp_atmo_flags" value="${escapeHtml(layer.flag)}" placeholder="flag, e.g. se__is_raining" autocomplete="off" title="A State Engine boolean - the effect runs while it is on (e.g. a calculated isRaining = weather.contains(&quot;Rainy&quot;))" />
            <div class="menu_button fa-solid fa-eye${isLayerPreviewed(layer.id) ? ' pp-active' : ''}" data-atmo-action="preview" title="Preview: show it now, whatever its flag (this session)"></div>
            <div class="menu_button fa-solid fa-trash-can" data-atmo-action="delete" title="Remove this effect"></div>
            <label class="pp-atmo-intensity" title="How strong: how much rain, snow, fog...">
                <span>Intensity</span>
                <input type="range" min="0" max="100" step="5" data-atmo="intensity" value="${layer.intensity}" />
                <span data-atmo-intensity-value>${layer.intensity}%</span>
            </label>
        </div>`).join('');
}

function render() {
    renderSettings();
    renderLayers();
}

// One layer changed: written back with the rest.
function updateLayer(layerId, patch) {
    const id = layoutId();
    if (!id) return;
    setLayoutAtmosphere(id, getLayoutAtmosphere(id).map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)));
}

export function initAtmosphereDrawer() {
    const root = document.getElementById('pp_atmosphere_section');
    if (!root) return;
    document.getElementById('pp_atmo_enabled').addEventListener('change', (e) => setAtmosphereSettings({ enabled: e.target.checked }));
    const scale = document.getElementById('pp_atmo_scale');
    scale.min = String(SCALE_LIMITS[0]);
    scale.max = String(SCALE_LIMITS[1]);
    scale.addEventListener('input', (e) => {
        document.getElementById('pp_atmo_scale_value').textContent = `${e.target.value}%`;
    });
    scale.addEventListener('change', (e) => setAtmosphereSettings({ scale: Number(e.target.value) }));
    document.getElementById('pp_atmo_add').addEventListener('click', () => {
        const id = layoutId();
        if (id) setLayoutAtmosphere(id, [...getLayoutAtmosphere(id), createLayer('rain')]);
    });

    const list = document.getElementById('pp_atmo_layers');
    list.addEventListener('change', (e) => {
        const row = e.target.closest('[data-layer]');
        const field = e.target.dataset.atmo;
        if (!row || !field) return;
        updateLayer(row.dataset.layer, { [field]: field === 'intensity' ? Number(e.target.value) : e.target.value });
    });
    list.addEventListener('input', (e) => {
        if (e.target.dataset.atmo !== 'intensity') return;
        e.target.closest('[data-layer]').querySelector('[data-atmo-intensity-value]').textContent = `${e.target.value}%`;
    });
    list.addEventListener('click', (e) => {
        const button = e.target.closest('[data-atmo-action]');
        const row = button?.closest('[data-layer]');
        if (!row) return;
        const layerId = row.dataset.layer;
        if (button.dataset.atmoAction === 'preview') {
            setLayerPreview(layerId, !isLayerPreviewed(layerId));
            return;
        }
        setLayerPreview(layerId, false);
        const id = layoutId();
        if (id) setLayoutAtmosphere(id, getLayoutAtmosphere(id).filter((layer) => layer.id !== layerId));
    });

    render();
    renderFlagOptions();
    void loadCatalog().then(renderFlagOptions);
    onCatalogChange(renderFlagOptions);
    onAtmosphereChange(renderLayers);
    onAtmosphereSettingsChange(renderSettings);
    onLayerPreviewChange(renderLayers);
    onSessionChange(renderLayers);
    onLibraryChange(renderLayers);
}
