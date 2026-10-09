// Atmosphere layers (src/atmosphere/atmosphere-model.js).

import {
    normalizeLayer, normalizeAtmosphere, createLayer, normalizeAtmosphereSettings, activeEffects, MAX_LAYERS,
} from '../src/atmosphere/atmosphere-model.js';

describe('layers', () => {
    it('an unknown effect is dropped; the rest gets defaults and limits', () => {
        expect(normalizeLayer({ effect: 'meteors' })).toBeNull();
        expect(normalizeLayer({ effect: 'rain', flag: ' se__rain ', intensity: 250, id: 'a' })).toEqual({ id: 'a', effect: 'rain', flag: 'se__rain', intensity: 100 });
        expect(createLayer('snow')).toMatchObject({ effect: 'snow', flag: '', intensity: 60 });
    });

    it('a list keeps valid layers, unique ids, at most the maximum', () => {
        const list = normalizeAtmosphere([{ id: 'x', effect: 'rain' }, { id: 'x', effect: 'snow' }, 'junk', { effect: 'nope' }]);
        expect(list.map((l) => l.effect)).toEqual(['rain', 'snow']);
        expect(new Set(list.map((l) => l.id)).size).toBe(2);
        expect(normalizeAtmosphere(Array.from({ length: 30 }, () => ({ effect: 'dust' })))).toHaveLength(MAX_LAYERS);
        expect(normalizeAtmosphere('x')).toEqual([]);
    });

    it('settings: on with a 100% scale by default', () => {
        expect(normalizeAtmosphereSettings(undefined)).toEqual({ enabled: true, scale: 100 });
        expect(normalizeAtmosphereSettings({ enabled: false, scale: 999 })).toEqual({ enabled: false, scale: 200 });
    });
});

describe('activeEffects', () => {
    const layers = [
        { id: 'r', effect: 'rain', flag: 'se__rain', intensity: 80 },
        { id: 'e', effect: 'embers', flag: 'se__fire', intensity: 50 },
        { id: 'r2', effect: 'rain', flag: 'se__storm', intensity: 100 },
        { id: 'n', effect: 'snow', flag: '', intensity: 60 },
    ];
    const flags = (on) => (ref) => on.includes(ref);

    it('every layer whose flag is on runs - layers mix (snowing in hell)', () => {
        expect(activeEffects(layers, {}, flags(['se__rain', 'se__fire']))).toEqual([
            { effect: 'rain', strength: 0.8 },
            { effect: 'embers', strength: 0.5 },
        ]);
    });

    it('two layers on the same effect: the strongest wins', () => {
        expect(activeEffects(layers, {}, flags(['se__rain', 'se__storm']))).toEqual([{ effect: 'rain', strength: 1 }]);
    });

    it('a layer without a flag never runs - unless previewed', () => {
        expect(activeEffects(layers, {}, flags([]))).toEqual([]);
        expect(activeEffects(layers, {}, flags([]), new Set(['n']))).toEqual([{ effect: 'snow', strength: 0.6 }]);
    });

    it('the global switch and scale apply on top', () => {
        expect(activeEffects(layers, { enabled: false }, flags(['se__rain']))).toEqual([]);
        expect(activeEffects(layers, { scale: 50 }, flags(['se__rain']))).toEqual([{ effect: 'rain', strength: 0.4 }]);
        expect(activeEffects(layers, { scale: 0 }, flags(['se__rain']))).toEqual([]);
    });

    it('only a real true is on', () => {
        expect(activeEffects(layers, {}, () => 'true')).toEqual([]);
    });
});
