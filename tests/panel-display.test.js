// Conditional panels and banners: the display record, the banner queue and
// the editing pins (src/panels/panel-display.js).

import {
    normalizeDisplay, isConditional, describeDisplay, createPlayQueue, isPinned, setPinned, onPinChange,
} from '../src/panels/panel-display.js';

describe('normalizeDisplay', () => {
    it('no record, or "always" -> null (every panel as it always was)', () => {
        for (const v of [null, undefined, 'x', [], { mode: 'always' }, { mode: 'bogus' }]) expect(normalizeDisplay(v)).toBeNull();
    });

    it('always with full width keeps just that', () => {
        expect(normalizeDisplay({ mode: 'always', fullWidth: true })).toEqual({ mode: 'always', fullWidth: true });
    });

    it('a banner gets its defaults; values are limited', () => {
        expect(normalizeDisplay({ mode: 'timed', ref: ' se__location ', trigger: 'change' })).toEqual({
            mode: 'timed', ref: 'se__location', trigger: 'change', invert: false, holdSeconds: 4,
            animIn: 'fade', animOut: 'fade', durationMs: 600, minGapSeconds: 10, fullWidth: false,
        });
        expect(normalizeDisplay({ mode: 'timed', holdSeconds: 999, durationMs: -5, animIn: 'spin' })).toMatchObject({ holdSeconds: 60, durationMs: 0, animIn: 'fade' });
    });

    it('a "while" panel always follows a flag (no change trigger)', () => {
        expect(normalizeDisplay({ mode: 'while', ref: 'se__rain', trigger: 'change', invert: true })).toMatchObject({ trigger: 'flag', invert: true });
    });
});

describe('isConditional and describeDisplay', () => {
    it('describes each mode for the Layout Panels list', () => {
        expect(isConditional(null)).toBe(false);
        expect(describeDisplay(null)).toBe('Always');
        expect(describeDisplay(normalizeDisplay({ mode: 'while', ref: 'se__rain' }))).toBe('While se__rain is on');
        expect(describeDisplay(normalizeDisplay({ mode: 'timed', ref: 'se__loc', trigger: 'change' }))).toBe('Banner - when se__loc changes');
        expect(describeDisplay(normalizeDisplay({ mode: 'timed', ref: 'se__x', invert: true }))).toBe('Banner - when se__x turns off');
        expect(describeDisplay(normalizeDisplay({ mode: 'timed' }))).toBe('Banner - when (no flag chosen) turns on');
    });
});

describe('createPlayQueue', () => {
    // A play that finishes when `release` is called.
    const controlled = () => {
        let release;
        const play = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        return { play, release: () => release() };
    };
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('plays one banner at a time, in order', async () => {
        const q = createPlayQueue();
        const a = controlled();
        const b = controlled();
        q.enqueue('a', a.play);
        q.enqueue('b', b.play);
        await flush();
        expect(a.play).toHaveBeenCalledTimes(1);
        expect(b.play).not.toHaveBeenCalled();
        a.release();
        await flush();
        expect(b.play).toHaveBeenCalledTimes(1);
        b.release();
        await flush();
        expect(q.isBusy()).toBe(false);
    });

    it('a banner already waiting or playing is not queued twice', async () => {
        const q = createPlayQueue();
        const a = controlled();
        expect(q.enqueue('a', a.play)).toBe(true);
        expect(q.enqueue('a', a.play)).toBe(false);
        await flush();
        a.release();
        await flush();
    });

    it('the minimum gap is from when it last started', async () => {
        let t = 0;
        const q = createPlayQueue(() => t);
        const a = controlled();
        q.enqueue('a', a.play, 10_000);
        await flush();
        a.release();
        await flush();
        t = 5_000;
        expect(q.enqueue('a', a.play, 10_000)).toBe(false);
        t = 10_000;
        expect(q.enqueue('a', a.play, 10_000)).toBe(true);
        await flush();
        a.release();
        await flush();
    });

    it('a failing banner does not stop the queue', async () => {
        const q = createPlayQueue();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const b = controlled();
        q.enqueue('a', () => Promise.reject(new Error('boom')));
        q.enqueue('b', b.play);
        await flush();
        await flush();
        expect(b.play).toHaveBeenCalled();
        b.release();
        await flush();
    });

    it('clear drops what is waiting', async () => {
        const q = createPlayQueue();
        const a = controlled();
        const b = controlled();
        q.enqueue('a', a.play);
        q.enqueue('b', b.play);
        q.clear();
        await flush();
        a.release();
        await flush();
        expect(b.play).not.toHaveBeenCalled();
    });
});

describe('pins', () => {
    it('pinned per session; listeners hear real changes', () => {
        const heard = [];
        const stop = onPinChange((id, on) => heard.push([id, on]));
        setPinned('p1', true);
        setPinned('p1', true);
        expect(isPinned('p1')).toBe(true);
        setPinned('p1', false);
        expect(heard).toEqual([['p1', true], ['p1', false]]);
        stop();
    });
});
