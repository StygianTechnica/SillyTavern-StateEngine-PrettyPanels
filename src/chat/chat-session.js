// Chat-scoped layout selection. Layout designs are global; WHICH layout
// is on screen is chosen per chat, in the chat's PP Configuration preset
// (src/chat/pp-config.js).
//
//   - Chat loads: show the layout its prettyPanels__layoutId names; if it
//     has none (PP Configuration not active, blank, or naming a deleted
//     layout), show the default layout. Nothing is written in that case.
//   - User picks a layout (drawer): show it and record it in the chat.
//   - Whenever a layout becomes active in a chat, the presets that own the
//     variables its elements display are activated there too. Presets are
//     never deactivated when switching away.
//
// Also keeps element values live: refreshes them on chat changes and on
// State Engine's variables-changed event, and follows a layout choice
// that arrives later (e.g. a new chat inheriting PP Configuration).

import { EXTENSION_ID } from '../constants.js';
import { activatePreset } from '../api/activate-preset.js';
import { getLayout, getActiveLayoutId, getDefaultLayoutId } from '../library/layout-library.js';
import { switchLayout, getBoundVariableNames, onBindingsChange } from '../panels/panel-manager.js';
import { ensureConfigPreset, readChatLayoutId, writeChatLayoutId } from './pp-config.js';
import { VARIABLES_CHANGED_EVENT, currentChatId, watchNames, refreshValues, loadCatalog } from './variable-service.js';
import { notify } from '../ui/dialogs.js';

let started = false;
let configReady = false;
// While a user choice is being written, a variables-changed event can
// still carry the OLD layout ID - don't let it switch the screen back.
let writingChoice = 0;
// Whether the current chat recorded a layout choice (false = showing the
// default).
let chosenForChat = false;
const sessionListeners = new Set();

function emitSessionChange() {
    const state = getSessionState();
    for (const listener of sessionListeners) listener(state);
}

// { chatId, layoutId, chosen }
export function getSessionState() {
    return { chatId: currentChatId(), layoutId: getActiveLayoutId(), chosen: chosenForChat };
}

export function onSessionChange(listener) {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
}

// Activates, in `chatId`, every inactive preset that owns a variable the
// active layout displays. Only ever activates.
async function activateLayoutPresets(chatId, names = getBoundVariableNames()) {
    if (!chatId || names.length === 0) return;
    const catalog = await loadCatalog();
    const wanted = new Set(names);
    let activated = 0;
    for (const preset of catalog) {
        if (preset.active || !preset.variables.some((v) => wanted.has(v.name))) continue;
        try {
            if (await activatePreset(EXTENSION_ID, chatId, preset.namespace, preset.name)) activated++;
        } catch (err) {
            console.warn(`[PrettyPanels] could not activate preset "${preset.name}"`, err);
        }
    }
    if (activated > 0) await loadCatalog();
}

async function refreshVariables() {
    await watchNames(getBoundVariableNames());
}

// Shows the layout the current chat chose, or the default. Also used
// after the active layout is deleted.
export async function showChatLayout() {
    const chatId = currentChatId();
    let stored = null;
    if (chatId && configReady) {
        try {
            stored = await readChatLayoutId(chatId);
        } catch (err) {
            console.warn('[PrettyPanels] could not read the chat layout choice', err);
        }
    }
    if (chatId !== currentChatId()) return; // the chat changed again meanwhile
    chosenForChat = !!(stored && getLayout(stored));
    switchLayout(chosenForChat ? stored : getDefaultLayoutId());
    emitSessionChange();
    await activateLayoutPresets(chatId);
    await refreshVariables();
}

async function onVariablesChanged(chatId) {
    const current = currentChatId();
    if (!current || (chatId !== null && chatId !== current)) return;
    if (configReady && writingChoice === 0) {
        const stored = await readChatLayoutId(current).catch(() => null);
        if (current === currentChatId() && writingChoice === 0 && stored && getLayout(stored) && stored !== getActiveLayoutId()) {
            chosenForChat = true;
            switchLayout(stored);
            emitSessionChange();
            await activateLayoutPresets(current);
            await refreshVariables();
            return;
        }
    }
    await refreshValues();
}

// The user picked a layout: show it and, if a chat is open, record it as
// that chat's layout. Without a chat it only changes what is on screen.
export async function chooseLayout(layoutId) {
    if (!switchLayout(layoutId)) return false;
    const chatId = currentChatId();
    if (chatId && configReady) {
        writingChoice++;
        try {
            chosenForChat = (await writeChatLayoutId(chatId, layoutId)) === true;
        } catch (err) {
            console.warn('[PrettyPanels] could not record the chat layout choice', err);
            notify('warning', 'Pretty Panels could not save this chat\'s layout choice to State Engine.');
        } finally {
            writingChoice--;
        }
    }
    emitSessionChange();
    await activateLayoutPresets(chatId);
    await refreshVariables();
    return true;
}

export async function startChatSession() {
    if (started) return;
    started = true;

    try {
        await ensureConfigPreset();
        configReady = true;
    } catch (err) {
        console.warn('[PrettyPanels] could not set up the PP Configuration preset - layouts will not be remembered per chat', err);
    }

    // An element was bound/rebound/removed: activate what it needs, then
    // re-watch values.
    onBindingsChange((addedNames) => {
        void (async () => {
            await activateLayoutPresets(currentChatId(), addedNames);
            await refreshVariables();
        })();
    });

    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, () => void showChatLayout());
    eventSource.on(VARIABLES_CHANGED_EVENT, (chatId) => void onVariablesChanged(chatId ?? null));

    await showChatLayout();
}
