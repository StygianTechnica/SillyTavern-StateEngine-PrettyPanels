// The Editing Mode pencil: a small button in the chat's top-right corner
// that turns Editing Mode on and off, so the Extensions drawer need not be
// opened for it. A click toggles; pressing and dragging moves it (its place
// is kept as an offset from the chat's top-right corner, so it follows the
// chat when the window or the chat column changes size). Shown while Pretty
// Panels is enabled and "Editing pencil on the chat" is on in the drawer.

import { getState, onStateChange, setEditingMode } from '../panels/panel-manager.js';
import { getEditButtonState, setEditButtonState } from '../panels/panel-registry.js';

const BUTTON_ID = 'pp-edit-button';
// Corner gap, and how far a press must move before it is a drag.
const INSET = 8;
const DRAG_THRESHOLD = 4;

const listeners = new Set();
let button = null;

export function isEditButtonShown() {
    return getEditButtonState().show !== false;
}

export function setEditButtonShown(show) {
    setEditButtonState({ show: show === true });
    refresh();
    for (const listener of listeners) listener();
}

// Called after the pencil is shown or hidden from anywhere.
export function onEditButtonChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// The chat's box - the corner the pencil sits in - or the window's.
function chatRect() {
    const chat = document.getElementById('chat') ?? document.getElementById('sheld');
    const rect = chat?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect : { top: 0, right: window.innerWidth, left: 0, bottom: window.innerHeight };
}

function place() {
    if (!button || button.hidden) return;
    const { dx, dy } = getEditButtonState();
    const rect = chatRect();
    const width = button.offsetWidth || 28;
    const height = button.offsetHeight || 28;
    const left = rect.right - (Number.isFinite(dx) ? dx : INSET) - width;
    const top = rect.top + (Number.isFinite(dy) ? dy : INSET);
    button.style.left = `${Math.min(Math.max(0, left), window.innerWidth - width)}px`;
    button.style.top = `${Math.min(Math.max(0, top), window.innerHeight - height)}px`;
}

function render() {
    if (!button) return;
    const { enabled, editingMode } = getState();
    button.hidden = !enabled || !isEditButtonShown();
    button.classList.toggle('pp-edit-button-active', editingMode);
    button.title = editingMode
        ? 'Editing Mode is on - click to turn it off (drag to move this button)'
        : 'Turn Editing Mode on (drag to move this button)';
    button.setAttribute('aria-pressed', String(editingMode));
}

function refresh() {
    render();
    place();
}

// Click toggles; a press that moves is a drag, whose drop is saved.
function bindPointer() {
    button.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const start = { x: e.clientX, y: e.clientY };
        const rect = button.getBoundingClientRect();
        const grab = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        let dragging = false;
        button.setPointerCapture(e.pointerId);
        const move = (ev) => {
            if (!dragging && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_THRESHOLD) return;
            dragging = true;
            button.classList.add('pp-edit-button-dragging');
            const width = button.offsetWidth;
            const height = button.offsetHeight;
            button.style.left = `${Math.max(0, Math.min(ev.clientX - grab.x, window.innerWidth - width))}px`;
            button.style.top = `${Math.max(0, Math.min(ev.clientY - grab.y, window.innerHeight - height))}px`;
        };
        const end = () => {
            button.removeEventListener('pointermove', move);
            button.removeEventListener('pointerup', end);
            button.removeEventListener('pointercancel', end);
            button.classList.remove('pp-edit-button-dragging');
            if (dragging) {
                const chat = chatRect();
                const box = button.getBoundingClientRect();
                setEditButtonState({ dx: Math.round(chat.right - box.right), dy: Math.round(box.top - chat.top) });
                place();
            } else {
                setEditingMode(!getState().editingMode);
            }
        };
        button.addEventListener('pointermove', move);
        button.addEventListener('pointerup', end);
        button.addEventListener('pointercancel', end);
    });
    // Keyboard: Enter / Space toggle (a pointer press is handled above).
    button.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        setEditingMode(!getState().editingMode);
    });
}

export function addEditButton() {
    if (document.getElementById(BUTTON_ID)) return;
    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.className = 'pp-edit-button';
    button.innerHTML = '<i class="fa-solid fa-pencil"></i>';
    button.setAttribute('aria-label', 'Pretty Panels Editing Mode');
    bindPointer();
    document.body.appendChild(button);
    refresh();
    onStateChange(refresh);
    window.addEventListener('resize', place);
    // The chat column changes size without the window (side panels, zoom).
    const chat = document.getElementById('chat');
    if (chat && typeof ResizeObserver === 'function') new ResizeObserver(place).observe(chat);
}
