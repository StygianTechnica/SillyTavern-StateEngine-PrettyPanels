// Layout Tools: a small floating toolbar shown only in Editing Mode,
// next to the panels it acts on (SillyTavern's Extensions drawer closes
// on outside clicks, so these can't live there). Drag it by its title;
// collapse it with the chevron; both are remembered.
//
//   Show Grid                       visual grid (snapping unchanged)
//   Align  left/center/right, top/middle/bottom
//                                   to the first selected panel, or to
//                                   the screen when one is selected
//   Distribute horizontally/vertically   3+ selected panels
//   Group / Ungroup / Select Group
//
// Select panels by clicking them in Editing Mode; Ctrl/Shift+click adds.

import {
    getState,
    onStateChange,
    getSelectionState,
    onSelectionChange,
    clearSelection,
    alignSelection,
    distributeSelection,
    groupSelection,
    ungroupSelection,
    selectGroupOfSelection,
    getShowGrid,
    setShowGrid,
} from '../panels/panel-manager.js';
import { getToolbarState, setToolbarState } from '../panels/panel-registry.js';
import { notify } from './dialogs.js';

const TOOLBAR_ID = 'pp-layout-toolbar';

const ALIGN = [
    ['left', 'fa-align-left', 'Align Left'],
    ['center', 'fa-align-center', 'Align Center (horizontal)'],
    ['right', 'fa-align-right', 'Align Right'],
    ['top', 'fa-arrow-up-long', 'Align Top'],
    ['middle', 'fa-grip-lines', 'Align Middle (vertical)'],
    ['bottom', 'fa-arrow-down-long', 'Align Bottom'],
];

function button(action, icon, title, value = '') {
    return `<button type="button" class="menu_button pp-tool" data-tool="${action}" data-value="${value}" title="${title}"><i class="fa-solid ${icon}"></i></button>`;
}

function build() {
    const el = document.createElement('div');
    el.id = TOOLBAR_ID;
    el.className = 'pp-toolbar';
    el.innerHTML = `
        <div class="pp-toolbar-header">
            <span class="pp-toolbar-title" title="Drag to move"><i class="fa-solid fa-ruler-combined"></i> Layout Tools</span>
            <span class="pp-toolbar-count"></span>
            <button type="button" class="pp-properties-close" data-tool="collapse" title="Collapse / expand">
                <i class="fa-solid fa-chevron-down"></i>
            </button>
        </div>
        <div class="pp-toolbar-body">
            <label class="checkbox_label pp-toolbar-grid">
                <input type="checkbox" data-tool="grid" /><span>Show Grid</span>
            </label>
            <div class="pp-toolbar-row" role="group" aria-label="Align">
                ${ALIGN.map(([value, icon, title]) => button('align', icon, title, value)).join('')}
            </div>
            <div class="pp-toolbar-row" role="group" aria-label="Distribute">
                ${button('distribute', 'fa-arrows-left-right', 'Distribute Horizontally (3+ panels)', 'horizontal')}
                ${button('distribute', 'fa-arrows-up-down', 'Distribute Vertically (3+ panels)', 'vertical')}
                <span class="pp-toolbar-sep"></span>
                ${button('group', 'fa-object-group', 'Create Group (2+ panels)')}
                ${button('ungroup', 'fa-object-ungroup', 'Ungroup')}
                ${button('select-group', 'fa-link', 'Select Group')}
                ${button('clear', 'fa-xmark', 'Clear selection')}
            </div>
            <small class="pp-toolbar-hint">Click panels to select; Ctrl/Shift+click adds. The first selected is the reference.</small>
        </div>
    `;
    return el;
}

function render(el) {
    const { editingMode } = getState();
    el.hidden = !editingMode;
    const { count, grouped } = getSelectionState();
    el.querySelector('.pp-toolbar-count').textContent = count ? `${count} selected` : '';
    const enable = (tool, on) => el.querySelectorAll(`[data-tool="${tool}"]`).forEach((b) => { b.disabled = !on; });
    enable('align', count >= 1);
    enable('distribute', count >= 3);
    enable('group', count >= 2);
    enable('ungroup', grouped);
    enable('select-group', grouped);
    enable('clear', count >= 1);
    el.querySelector('[data-tool="grid"]').checked = getShowGrid();
    const { collapsed } = getToolbarState();
    el.classList.toggle('pp-collapsed', collapsed === true);
}

function place(el) {
    const { x, y } = getToolbarState();
    const maxX = Math.max(0, window.innerWidth - el.offsetWidth);
    const maxY = Math.max(0, window.innerHeight - el.offsetHeight);
    const left = Number.isFinite(x) ? x : Math.round((window.innerWidth - el.offsetWidth) / 2);
    const top = Number.isFinite(y) ? y : 8;
    el.style.left = `${Math.min(Math.max(0, left), maxX)}px`;
    el.style.top = `${Math.min(Math.max(0, top), maxY)}px`;
}

function bindDrag(el) {
    const handle = el.querySelector('.pp-toolbar-title');
    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const dx = e.clientX - rect.left;
        const dy = e.clientY - rect.top;
        handle.setPointerCapture(e.pointerId);
        const move = (ev) => {
            el.style.left = `${Math.max(0, Math.min(ev.clientX - dx, window.innerWidth - el.offsetWidth))}px`;
            el.style.top = `${Math.max(0, Math.min(ev.clientY - dy, window.innerHeight - el.offsetHeight))}px`;
        };
        const end = () => {
            handle.removeEventListener('pointermove', move);
            handle.removeEventListener('pointerup', end);
            handle.removeEventListener('pointercancel', end);
            setToolbarState({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', end);
        handle.addEventListener('pointercancel', end);
    });
}

function onTool(el, tool, value) {
    if (tool === 'collapse') {
        setToolbarState({ collapsed: !getToolbarState().collapsed });
    } else if (tool === 'grid') {
        setShowGrid(el.querySelector('[data-tool="grid"]').checked);
    } else if (tool === 'align') {
        alignSelection(value);
    } else if (tool === 'distribute') {
        distributeSelection(value);
    } else if (tool === 'group') {
        if (groupSelection()) notify('success', 'Grouped - these panels now move together.');
    } else if (tool === 'ungroup') {
        ungroupSelection();
    } else if (tool === 'select-group') {
        selectGroupOfSelection();
    } else if (tool === 'clear') {
        clearSelection();
    }
    render(el);
    place(el);
}

export function addLayoutToolbar() {
    if (document.getElementById(TOOLBAR_ID)) return;
    const el = build();
    // Keep presses inside the toolbar from reaching SillyTavern's
    // outside-click handlers.
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('click', (e) => {
        const target = e.target.closest('[data-tool]');
        if (!target || target.tagName === 'INPUT') return;
        onTool(el, target.dataset.tool, target.dataset.value);
    });
    el.querySelector('[data-tool="grid"]').addEventListener('change', () => onTool(el, 'grid'));
    bindDrag(el);
    document.body.appendChild(el);

    const refresh = () => {
        render(el);
        if (!el.hidden) place(el);
    };
    refresh();
    onStateChange(refresh);
    onSelectionChange(() => render(el));
    window.addEventListener('resize', () => { if (!el.hidden) place(el); });
}
