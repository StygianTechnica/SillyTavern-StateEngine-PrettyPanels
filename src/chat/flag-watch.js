// The flag and change watcher (docs/PLAN - FLAGS, DRAWERS, BANNERS,
// ATMOSPHERE.md, phase 0): what drawers, conditional panels, banners and
// atmosphere layers react to. Pretty Panels never evaluates conditions - a
// "flag" is a State Engine boolean variable (or a role assigned one); the
// logic that sets it lives in State Engine (a calculated boolean, a prompted
// one, a flag-mode one).
//
//   onFlag(ref, listener)    listener({ ref, on, rose }) when the flag turns
//                            on or off (on = a real boolean true)
//   onChange(ref, listener)  listener({ ref, value, previous }) when the
//                            value changes (any type)
//   isFlagOn(ref)            the flag's state now
//
// Both return an unsubscribe function. Nothing is reported for a chat load
// or switch, for a ref's first values, or when a role is reassigned to
// another variable - see flag-watch-core.js. A watched ref is read even when
// no panel element shows it (variable-service.js setWatcherRefs).

import { createFlagWatcher } from './flag-watch-core.js';
import { onValuesChange, getValue, targetOf, valuesChatId, setWatcherRefs, wasRead } from './variable-service.js';

const watcher = createFlagWatcher();
const flagListeners = new Map(); // ref -> Set<listener>
const changeListeners = new Map();
let attached = false;

function observe() {
    const events = watcher.observe(valuesChatId(), (ref) => (wasRead(ref) ? { target: targetOf(ref), value: getValue(ref)?.value } : null));
    for (const event of events) {
        const listeners = (event.kind === 'flag' ? flagListeners : changeListeners).get(event.ref);
        for (const listener of [...(listeners ?? [])]) {
            try {
                listener(event);
            } catch (err) {
                console.warn('[PrettyPanels] a flag listener failed (gracefully handled)', err);
            }
        }
    }
}

// Keeps the watcher's refs and the variable service's extra reads in step
// with the listeners.
function sync() {
    if (!attached) {
        attached = true;
        onValuesChange(observe);
    }
    const wanted = new Set([...flagListeners.keys(), ...changeListeners.keys()]);
    for (const ref of watcher.refs()) if (!wanted.has(ref)) watcher.remove(ref);
    for (const ref of wanted) watcher.add(ref);
    void setWatcherRefs([...wanted]);
}

function subscribe(map, ref, listener) {
    if (typeof ref !== 'string' || !ref || typeof listener !== 'function') return () => {};
    if (!map.has(ref)) map.set(ref, new Set());
    map.get(ref).add(listener);
    sync();
    return () => {
        const set = map.get(ref);
        if (!set?.delete(listener)) return;
        if (set.size === 0) map.delete(ref);
        sync();
    };
}

export function onFlag(ref, listener) {
    return subscribe(flagListeners, ref, listener);
}

export function onChange(ref, listener) {
    return subscribe(changeListeners, ref, listener);
}

// Whether the flag is on now. Read from the current values, so it answers
// before the watcher's first observation too.
export function isFlagOn(ref) {
    return getValue(ref)?.value === true;
}
