// Drawers: the compact area's geometry and the per-session open state
// (src/panels/drawer.js), and the drawer-related element fields
// (src/elements/element-model.js).

import {
    normalizeCompact, fitCompact, collapsedBox, openBox, keepInside,
    drawerKey, isDrawerOpen, setDrawerOpen, toggleDrawer, onDrawerChange, closeAllDrawers,
} from '../src/panels/drawer.js';
import { normalizeVariableElement, isElementVisible, normalizeToggleOptions } from '../src/elements/element-model.js';

describe('normalizeCompact', () => {
    it('no area -> null', () => {
        for (const v of [null, undefined, 'x', [], 5]) expect(normalizeCompact(v)).toBeNull();
    });

    it('rounds, keeps the minimum size, and keeps on screen by default', () => {
        expect(normalizeCompact({ x: 10.4, y: -5, width: 3, height: 200.6 })).toEqual({ x: 10, y: 0, width: 24, height: 201, keepOnScreen: true });
        expect(normalizeCompact({ keepOnScreen: false }).keepOnScreen).toBe(false);
    });
});

describe('fitCompact', () => {
    it('keeps the area inside the canvas: size first, then position', () => {
        expect(fitCompact({ x: 250, y: 0, width: 100, height: 40, keepOnScreen: true }, 300, 200)).toMatchObject({ x: 200, y: 0, width: 100, height: 40 });
        expect(fitCompact({ x: 0, y: 0, width: 500, height: 40 }, 300, 200)).toMatchObject({ x: 0, width: 300 });
    });
});

describe('collapsedBox and openBox', () => {
    const chrome = { left: 5, top: 7, right: 5, bottom: 7 };

    it('the collapsed box keeps the compact area in place on screen', () => {
        const compact = { x: 0, y: 300, width: 280, height: 60 };
        expect(collapsedBox({ x: 100, y: 200 }, chrome, compact)).toEqual({ x: 100, y: 500, width: 290, height: 74 });
    });

    it('a compact area at the bottom of the design opens upward', () => {
        const compact = { x: 0, y: 300, width: 280, height: 60, keepOnScreen: true };
        const open = openBox({ x: 100, y: 500 }, compact, 290, 374, 1920, 1080);
        expect(open).toEqual({ x: 100, y: 200, width: 290, height: 374 });
    });

    it('keepOnScreen moves an open drawer back inside the window; off, it is left where it falls', () => {
        const compact = { x: 0, y: 0, width: 100, height: 40, keepOnScreen: true };
        expect(openBox({ x: 1800, y: 900 }, compact, 300, 400, 1920, 1080)).toEqual({ x: 1620, y: 680, width: 300, height: 400 });
        expect(openBox({ x: 1800, y: 900 }, { ...compact, keepOnScreen: false }, 300, 400, 1920, 1080)).toEqual({ x: 1800, y: 900, width: 300, height: 400 });
    });

    it('a box larger than the window keeps its top-left corner on screen', () => {
        expect(keepInside({ x: -50, y: -20, width: 3000, height: 2000 }, 1920, 1080)).toMatchObject({ x: 0, y: 0 });
    });
});

describe('open / closed state', () => {
    afterEach(() => closeAllDrawers());

    it('closed by default; toggles; keyed per chat', () => {
        const a = drawerKey('chat-1', 'panel', 'p1');
        const b = drawerKey('chat-2', 'panel', 'p1');
        expect(isDrawerOpen(a)).toBe(false);
        toggleDrawer(a);
        expect(isDrawerOpen(a)).toBe(true);
        expect(isDrawerOpen(b)).toBe(false);
        toggleDrawer(a);
        expect(isDrawerOpen(a)).toBe(false);
    });

    it('listeners hear real changes only; closeAllDrawers closes everything', () => {
        const heard = [];
        const stop = onDrawerChange((key, open) => heard.push([key, open]));
        setDrawerOpen('k1', true);
        setDrawerOpen('k1', true);
        setDrawerOpen('k2', true);
        closeAllDrawers();
        expect(heard).toEqual([['k1', true], ['k2', true], ['k1', false], ['k2', false]]);
        stop();
    });
});

describe('drawer element fields', () => {
    it('a Drawer Toggle is unbound and gets its look defaults', () => {
        const toggle = normalizeVariableElement({ type: 'toggle', binding: { name: 'se__x' } });
        expect(toggle.binding).toBeNull();
        expect(toggle.toggle).toEqual({ icon: 'chevron-down', color: '', size: 16 });
        expect(normalizeToggleOptions({ icon: ' caret-up ', size: 500 })).toMatchObject({ icon: 'caret-up', size: 72 });
    });

    it('visibleWhen: a flag ref, inverted or not; nothing else is kept', () => {
        expect(normalizeVariableElement({ type: 'text' }).visibleWhen).toBeNull();
        expect(normalizeVariableElement({ type: 'text', visibleWhen: { flag: ' se__rain ' } }).visibleWhen).toEqual({ flag: 'se__rain', invert: false });
        expect(normalizeVariableElement({ type: 'text', visibleWhen: { flag: 'char:name' } }).visibleWhen).toBeNull();
    });

    it('isElementVisible: only a real true is on', () => {
        const shown = { visibleWhen: { flag: 'se__rain', invert: false } };
        const hidden = { visibleWhen: { flag: 'se__rain', invert: true } };
        expect(isElementVisible({}, undefined)).toBe(true);
        expect(isElementVisible(shown, true)).toBe(true);
        expect(isElementVisible(shown, 'true')).toBe(false);
        expect(isElementVisible(hidden, true)).toBe(false);
        expect(isElementVisible(hidden, undefined)).toBe(true);
    });
});
