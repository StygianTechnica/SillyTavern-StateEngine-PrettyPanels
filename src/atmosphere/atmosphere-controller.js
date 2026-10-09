// Runs the atmosphere for the layout on screen: its effect layers
// (layout-library.js), their flags (src/chat/flag-watch.js - each layer's
// flag is followed even though no element shows it) and the global settings
// decide what the canvas draws (atmosphere.js). A chat that shows no layout
// has no atmosphere. Layers can be PREVIEWED (the drawer): shown regardless
// of their flag, for this session.

import { setEffects } from './atmosphere.js';
import { activeEffects } from './atmosphere-model.js';
import { getLayoutAtmosphere, onAtmosphereChange, getActiveLayoutId } from '../library/layout-library.js';
import { getAtmosphereSettings, onAtmosphereSettingsChange } from '../panels/panel-registry.js';
import { onFlag, isFlagOn } from '../chat/flag-watch.js';
import { onValuesChange } from '../chat/variable-service.js';
import { getSessionState, onSessionChange } from '../chat/chat-session.js';
import { onLibraryChange } from '../storage/store.js';

const previewed = new Set();
const previewListeners = new Set();
const watching = new Map(); // flag ref -> unsubscribe

function shownLayoutId() {
    return getSessionState().layoutId ? getActiveLayoutId() : null;
}

function sync() {
    const layoutId = shownLayoutId();
    const layers = layoutId ? getLayoutAtmosphere(layoutId) : [];
    const refs = new Set(layers.map((layer) => layer.flag).filter(Boolean));
    for (const [ref, stop] of watching) {
        if (!refs.has(ref)) {
            stop();
            watching.delete(ref);
        }
    }
    for (const ref of refs) if (!watching.has(ref)) watching.set(ref, onFlag(ref, () => sync()));
    setEffects(activeEffects(layers, getAtmosphereSettings(), isFlagOn, previewed));
}

export function isLayerPreviewed(layerId) {
    return previewed.has(layerId);
}

// Shows a layer regardless of its flag (or stops), for this session.
export function setLayerPreview(layerId, on) {
    if (on) previewed.add(layerId);
    else previewed.delete(layerId);
    for (const listener of [...previewListeners]) listener();
    sync();
}

export function onLayerPreviewChange(listener) {
    previewListeners.add(listener);
    return () => previewListeners.delete(listener);
}

export function initAtmosphere() {
    onValuesChange(sync);
    onAtmosphereChange(sync);
    onAtmosphereSettingsChange(sync);
    onSessionChange(sync);
    onLibraryChange(sync);
    sync();
}
