// Atmosphere (docs/PLAN - FLAGS, DRAWERS, BANNERS, ATMOSPHERE.md, phase 4):
// weather and ambience drawn behind the chat - rain over the background
// while the story says it rains. A layout has a list of EFFECT LAYERS:
//
//   { id, effect, flag, intensity }
//     effect     one of EFFECTS
//     flag       a State Engine boolean (variable or role:... ref) - the layer
//                runs while it is on. Pretty Panels never evaluates
//                conditions: make the flag in State Engine (a calculated
//                isRaining = weather.contains("Rainy")). Empty: never runs
//                (except while previewed).
//     intensity  0-100
//
// Every layer whose flag is on runs, and layers mix: rain and embers at once
// is two layers on. Global settings (all layouts): on / off and an intensity
// scale (percent) applied on top of each layer's own.
//
// This module is plain logic (no DOM).

export const EFFECTS = [
    ['rain', 'Rain'],
    ['drizzle', 'Drizzle'],
    ['storm', 'Storm (heavy rain, lightning)'],
    ['snow', 'Snow'],
    ['hail', 'Hail'],
    ['fog', 'Fog'],
    ['embers', 'Embers'],
    ['leaves', 'Falling leaves'],
    ['dust', 'Dust motes'],
];

export const INTENSITY_LIMITS = [0, 100];
export const SCALE_LIMITS = [0, 200];
export const DEFAULT_INTENSITY = 60;
export const MAX_LAYERS = 12;

const EFFECT_IDS = new Set(EFFECTS.map(([id]) => id));

function newLayerId() {
    return `ppa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function clampNumber(value, [min, max], fallback) {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

// One layer, validated, or null (an unknown effect).
export function normalizeLayer(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !EFFECT_IDS.has(raw.effect)) return null;
    return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newLayerId(),
        effect: raw.effect,
        flag: typeof raw.flag === 'string' ? raw.flag.trim() : '',
        intensity: clampNumber(raw.intensity, INTENSITY_LIMITS, DEFAULT_INTENSITY),
    };
}

// A layout's layers: valid ones, unique ids, at most MAX_LAYERS.
export function normalizeAtmosphere(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const layer = normalizeLayer(item);
        if (!layer) continue;
        if (seen.has(layer.id)) layer.id = newLayerId();
        seen.add(layer.id);
        out.push(layer);
        if (out.length >= MAX_LAYERS) break;
    }
    return out;
}

export function createLayer(effect = 'rain') {
    return normalizeLayer({ effect, flag: '', intensity: DEFAULT_INTENSITY });
}

// The global settings: { enabled, scale } (scale: percent, 100 = as set).
export function normalizeAtmosphereSettings(raw) {
    const settings = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        enabled: settings.enabled !== false,
        scale: clampNumber(settings.scale, SCALE_LIMITS, 100),
    };
}

// The layers to draw now, as { effect, strength } (strength 0..2 - the
// layer's intensity times the global scale), strongest per effect when two
// layers run the same one. `isOn(ref)`: whether a flag is on; `previewed`: a
// Set of layer ids shown regardless of their flag.
export function activeEffects(layers, settings, isOn, previewed = new Set()) {
    const { enabled, scale } = normalizeAtmosphereSettings(settings);
    if (!enabled || scale === 0) return [];
    const strongest = new Map();
    for (const layer of layers) {
        const on = previewed.has(layer.id) || (!!layer.flag && isOn(layer.flag) === true);
        if (!on || layer.intensity === 0) continue;
        const strength = (layer.intensity / 100) * (scale / 100);
        if (strength > (strongest.get(layer.effect) ?? 0)) strongest.set(layer.effect, strength);
    }
    return [...strongest].map(([effect, strength]) => ({ effect, strength }));
}
