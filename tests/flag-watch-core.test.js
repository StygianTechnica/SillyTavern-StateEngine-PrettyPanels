// The flag and change watcher's logic (src/chat/flag-watch-core.js).

import { createFlagWatcher, isOn } from '../src/chat/flag-watch-core.js';

// A read() over plain values: { ref: value } (ref -> its own name as target).
const reader = (values, targets = {}) => (ref) => ({ target: targets[ref] ?? ref, value: values[ref] });

describe('isOn', () => {
    it('only a real boolean true is on', () => {
        expect(isOn(true)).toBe(true);
        for (const v of [false, 'true', 1, null, undefined, [], {}]) expect(isOn(v)).toBe(false);
    });
});

describe('createFlagWatcher', () => {
    let w;
    beforeEach(() => {
        w = createFlagWatcher();
        w.add('se__rain');
    });

    it('the first values are a baseline: nothing is reported, even a flag that is already on', () => {
        expect(w.observe('chat-1', reader({ se__rain: true }))).toEqual([]);
        expect(w.isOn('se__rain')).toBe(true);
    });

    it('a flag turning on reports a rise and a change; turning off reports both too, without a rise', () => {
        w.observe('chat-1', reader({ se__rain: false }));
        expect(w.observe('chat-1', reader({ se__rain: true }))).toEqual([
            { kind: 'flag', ref: 'se__rain', on: true, rose: true },
            { kind: 'change', ref: 'se__rain', value: true, previous: false },
        ]);
        expect(w.observe('chat-1', reader({ se__rain: false }))).toEqual([
            { kind: 'flag', ref: 'se__rain', on: false, rose: false },
            { kind: 'change', ref: 'se__rain', value: false, previous: true },
        ]);
    });

    it('no change, no events', () => {
        w.observe('chat-1', reader({ se__rain: true }));
        expect(w.observe('chat-1', reader({ se__rain: true }))).toEqual([]);
    });

    it('a missing variable is off: becoming true from missing is a rise', () => {
        w.observe('chat-1', reader({}));
        expect(w.isOn('se__rain')).toBe(false);
        expect(w.observe('chat-1', reader({ se__rain: true }))[0]).toMatchObject({ kind: 'flag', rose: true });
    });

    it('a truthy non-boolean is not a flag turning on, but is a change', () => {
        w.observe('chat-1', reader({ se__rain: false }));
        expect(w.observe('chat-1', reader({ se__rain: 'true' }))).toEqual([
            { kind: 'change', ref: 'se__rain', value: 'true', previous: false },
        ]);
    });

    it('a chat switch is a new baseline: nothing is reported for it', () => {
        w.observe('chat-1', reader({ se__rain: false }));
        expect(w.observe('chat-2', reader({ se__rain: true }))).toEqual([]);
        expect(w.observe('chat-2', reader({ se__rain: false }))[0]).toMatchObject({ kind: 'flag', on: false });
    });

    it('a role reassigned to another variable is a new baseline', () => {
        w.add('role:scene.raining');
        w.observe('chat-1', reader({ 'role:scene.raining': false }, { 'role:scene.raining': 'se__a' }));
        expect(w.observe('chat-1', reader({ 'role:scene.raining': true }, { 'role:scene.raining': 'se__b' }))).toEqual([]);
    });

    it('changes compare by content: an equal array is no change, a different one is', () => {
        w.add('se__weather');
        w.observe('chat-1', reader({ se__weather: ['Rain'] }));
        expect(w.observe('chat-1', reader({ se__weather: ['Rain'] }))).toEqual([]);
        expect(w.observe('chat-1', reader({ se__weather: ['Rain', 'Snow'] }))).toEqual([
            { kind: 'change', ref: 'se__weather', value: ['Rain', 'Snow'], previous: ['Rain'] },
        ]);
    });

    it('a ref not read yet is skipped - not a baseline of "missing" that would make its real value look like a rise', () => {
        w.observe('chat-1', () => null);
        expect(w.observe('chat-1', reader({ se__rain: true }))).toEqual([]); // the baseline
        expect(w.isOn('se__rain')).toBe(true);
    });

    it('a removed ref is forgotten; added again, its first values are a baseline again', () => {
        w.observe('chat-1', reader({ se__rain: false }));
        w.remove('se__rain');
        expect(w.refs()).toEqual([]);
        expect(w.observe('chat-1', reader({ se__rain: true }))).toEqual([]);
        w.add('se__rain');
        expect(w.observe('chat-1', reader({ se__rain: true }))).toEqual([]);
    });

    it('several flags at once each report on their own', () => {
        w.add('se__fire');
        w.observe('chat-1', reader({ se__rain: false, se__fire: false }));
        const events = w.observe('chat-1', reader({ se__rain: true, se__fire: true }));
        expect(events.filter((e) => e.kind === 'flag').map((e) => e.ref)).toEqual(['se__rain', 'se__fire']);
    });
});
