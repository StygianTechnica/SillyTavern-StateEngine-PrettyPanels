// The flag and change watcher's logic, kept free of SillyTavern, State Engine
// and the DOM so it can be unit-tested (src/chat/flag-watch.js connects it to
// the variable service). docs/PLAN - FLAGS, DRAWERS, BANNERS, ATMOSPHERE.md,
// phase 0.
//
// A watcher is told about refs (a variable name or "role:<id>"), and is then
// shown the current values once per refresh - observe(chatId, read), where
// read(ref) answers { target, value } (target: the variable the ref reads,
// null when it reads none). It reports what changed since the last
// observation:
//
//   flag    the ref's value turned on or off - on is a real boolean true;
//           anything else (false, a missing variable, "true", 1) is off.
//           { kind: 'flag', ref, on, rose }  rose: it turned on
//   change  the ref's value changed (any type, compared by content)
//           { kind: 'change', ref, value, previous }
//
// No event is reported for a BASELINE - the first values seen for a ref, for
// a chat (a chat load or switch changes everything at once; that is not a
// story event), or after the ref starts reading a different variable (a role
// reassigned). One observation is one burst of writes, so a value that
// changes once in it is reported once.

const MISSING = Symbol('missing');

function snapshot(value) {
    if (value === undefined) return MISSING;
    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

export function isOn(value) {
    return value === true;
}

export function createFlagWatcher() {
    const refs = new Set();
    // ref -> { chatId, target, key (content snapshot), value, on }
    const seen = new Map();

    return {
        // Starts watching `ref` (its first observation is a baseline).
        add(ref) {
            refs.add(ref);
        },

        // Stops watching `ref` and forgets what was seen for it.
        remove(ref) {
            refs.delete(ref);
            seen.delete(ref);
        },

        refs() {
            return [...refs];
        },

        // Whether `ref` is on, as last observed (false before any observation).
        isOn(ref) {
            return seen.get(ref)?.on === true;
        },

        // Compares the current values with the last observation; returns the
        // events (none for a baseline). `read(ref)` -> { target, value }, or
        // null when the ref's value has not been read yet (it is skipped:
        // not a baseline, not "missing").
        observe(chatId, read) {
            const events = [];
            for (const ref of refs) {
                const entry = read(ref);
                if (entry === null) continue;
                const { target = null, value } = entry ?? {};
                const now = { chatId: chatId ?? null, target, key: snapshot(value), value, on: isOn(value) };
                const before = seen.get(ref);
                seen.set(ref, now);
                if (!before || before.chatId !== now.chatId || before.target !== now.target) continue;
                if (before.key === now.key) continue;
                if (before.on !== now.on) events.push({ kind: 'flag', ref, on: now.on, rose: now.on });
                events.push({ kind: 'change', ref, value, previous: before.value });
            }
            return events;
        },
    };
}
