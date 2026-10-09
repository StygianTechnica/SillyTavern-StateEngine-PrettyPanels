// Chat-scoped layout selection. Layout designs are global; WHICH layout
// is on screen is chosen per chat, in the chat's PP Configuration preset
// (src/chat/pp-config.js). There is no default layout.
//
//   - Chat loads: show the layout its prettyPanels__layoutId names. If it
//     has none (PP Configuration not active, blank, or naming a deleted
//     layout), show NO layout - an empty screen and the "Select a layout to
//     use for this chat." prompt (src/ui/layout-gate.js). Nothing is
//     written in that case.
//   - User picks a layout (drawer or the prompt): show it and record it in
//     the chat.
//   - Whenever a layout becomes active in a chat, the presets that own the
//     variables its elements display are activated there too. Presets are
//     never deactivated when switching away.
//
// A layout is only ever chosen for an open chat: without one, nothing can
// be chosen and nothing is shown.
//
// Role gating (State Engine roles, requirements spec 1.40/1.41): the shown
// layout's roles - the layout roles it carries (role-library.js) plus any
// role its elements are bound to - are requested from State Engine for THIS
// chat (requestRoles, key "layout" - replaced on every layout change,
// cleared when no layout is shown), then checked (resolveRoles). Missing
// ones are reported through the session state, and the layout still
// renders - their elements show blank - with a warning to assign them (in
// the drawer's Layout Roles, or State Engine's Roles tab).
//
// Also keeps element values live: refreshes them on chat changes and on
// State Engine's variables-changed event (which role changes emit too), and
// follows a layout choice that arrives later (e.g. a new chat inheriting PP
// Configuration).

import { EXTENSION_ID } from '../constants.js';
import { activatePreset } from '../api/activate-preset.js';
import { requestRoles } from '../api/request-roles.js';
import { resolveRoles } from '../api/resolve-roles.js';
import { getLayout, getActiveLayoutId } from '../library/layout-library.js';
import { listLayoutRoles } from '../library/role-library.js';
import {
    switchLayout, setLayoutShown, getBoundVariableNames, getBoundImageNames, getBoundRoleIds, onBindingsChange, refreshPanels,
} from '../panels/panel-manager.js';
import { ensureConfigPreset, ensureConfigActive, readChatLayoutId, writeChatLayoutId } from './pp-config.js';
import {
    VARIABLES_CHANGED_EVENT, currentChatId, watchNames, refreshValues, refreshRoles, loadCatalog, isCatalogWatched,
} from './variable-service.js';
import { startRoleSync, onRolesSynced } from './role-sync.js';
import { notify } from '../ui/dialogs.js';

// The State Engine role request this extension keeps per chat.
const ROLE_REQUEST_KEY = 'layout';

let started = false;
let configReady = false;
// While a user choice is being written, a variables-changed event can
// still carry the OLD layout ID - don't let it switch the screen back.
let writingChoice = 0;
// Whether a layout is on screen (chosen for the current chat, or picked
// with no chat open). False = the empty screen and the layout prompt.
let layoutShown = false;
// Whether the current chat recorded a layout choice.
let chosenForChat = false;
// The shown layout's roles State Engine reports unusable in this chat
// (ids), and whether State Engine could answer at all.
let missingRoles = [];
let roleCheckFailed = false;
const sessionListeners = new Set();

function emitSessionChange() {
    const state = getSessionState();
    for (const listener of sessionListeners) listener(state);
}

// { chatId, layoutId (null when none is shown), chosen, missingRoles, roleCheckFailed }
export function getSessionState() {
    return {
        chatId: currentChatId(),
        layoutId: layoutShown ? getActiveLayoutId() : null,
        chosen: chosenForChat,
        missingRoles: [...missingRoles],
        roleCheckFailed,
    };
}

export function onSessionChange(listener) {
    sessionListeners.add(listener);
    return () => sessionListeners.delete(listener);
}

// Activates, in `chatId`, every inactive preset that owns a variable the
// active layout displays. Only ever activates.
async function activateLayoutPresets(chatId, names = getBoundVariableNames()) {
    if (!chatId || !layoutShown || names.length === 0) return;
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
    await watchNames(layoutShown ? getBoundVariableNames() : [], layoutShown ? getBoundImageNames() : []);
}

// The role ids the shown layout needs: its own layout roles and the roles
// its elements are bound to.
export function getLayoutRoleIds() {
    if (!layoutShown) return [];
    const ids = new Set([...listLayoutRoles(getActiveLayoutId()).map((r) => r.id), ...getBoundRoleIds()]);
    return [...ids].sort();
}

// Re-checks the shown layout's roles in the current chat (resolveRoles).
async function checkRoles(chatId = currentChatId()) {
    const required = chatId ? getLayoutRoleIds() : [];
    let missing = [];
    let failed = false;
    if (required.length > 0) {
        try {
            const result = await resolveRoles(EXTENSION_ID, chatId, required);
            if (result) missing = result.missing;
            else failed = true;
        } catch (err) {
            console.warn('[PrettyPanels] could not check this layout\'s roles (update State Engine for role support)', err);
            failed = true;
        }
    }
    if (chatId !== currentChatId()) return;
    const changed = failed !== roleCheckFailed || missing.join('|') !== missingRoles.join('|');
    missingRoles = missing;
    roleCheckFailed = failed;
    if (changed) emitSessionChange();
}

// Tells State Engine which roles the shown layout needs in `chatId` (none
// when no layout is shown - that clears the request), then checks them.
async function syncRoles(chatId = currentChatId()) {
    if (chatId) {
        const layout = layoutShown ? getLayout(getActiveLayoutId()) : null;
        try {
            await requestRoles(EXTENSION_ID, {
                key: ROLE_REQUEST_KEY,
                label: layout ? `Pretty Panels layout "${layout.name}"` : 'Pretty Panels layout',
                chatId,
                roles: layout ? getLayoutRoleIds() : [],
            });
        } catch (err) {
            console.warn('[PrettyPanels] could not request this layout\'s roles (update State Engine for role support)', err);
        }
    }
    await checkRoles(chatId);
}

function showLayout(id) {
    layoutShown = id ? switchLayout(id) : false;
    setLayoutShown(layoutShown);
}

// Shows the layout the current chat chose, or none. Also used after the
// active layout is deleted.
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
    // Keep the choice inheritable by a continued chat (pp-config.js).
    if (chosenForChat) await ensureConfigActive(chatId).catch((err) => console.warn('[PrettyPanels] could not reactivate PP Configuration', err));
    if (chatId !== currentChatId()) return;
    showLayout(chosenForChat ? stored : null);
    missingRoles = [];
    roleCheckFailed = false;
    emitSessionChange();
    await activateLayoutPresets(chatId);
    await syncRoles(chatId);
    await refreshVariables();
}

async function onVariablesChanged(chatId) {
    const current = currentChatId();
    if (!current || (chatId !== null && chatId !== current)) return;
    if (configReady && writingChoice === 0) {
        const stored = await readChatLayoutId(current).catch(() => null);
        if (current === currentChatId() && writingChoice === 0 && stored && getLayout(stored)
            && (!layoutShown || stored !== getActiveLayoutId())) {
            chosenForChat = true;
            showLayout(stored);
            emitSessionChange();
            await activateLayoutPresets(current);
            await syncRoles(current);
            await refreshVariables();
            return;
        }
    }
    await refreshValues();
    // A role assigned (or unassigned) in State Engine's Roles tab lands here.
    await checkRoles(current);
    // A variable just created in State Engine's manager seeds a value, which
    // lands here - pick up the new definition while a properties pane is
    // open (the variable list, Binding and Image variable fields).
    if (isCatalogWatched()) await loadCatalog();
}

// The user picked a layout for the open chat: show it and record it as the
// chat's layout. Without a chat nothing can be chosen.
export async function chooseLayout(layoutId) {
    const chatId = currentChatId();
    if (!chatId || !getLayout(layoutId)) return false;
    showLayout(layoutId);
    if (!layoutShown) return false;
    if (configReady) {
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
    await syncRoles(chatId);
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

    // An element was bound/rebound/removed: activate what it needs, re-request
    // the layout's roles (a role binding added or removed), then re-watch
    // values.
    onBindingsChange((addedNames) => {
        void (async () => {
            await activateLayoutPresets(currentChatId(), addedNames);
            await syncRoles();
            await refreshVariables();
        })();
    });

    // Layout roles reached State Engine (startup, or one was added, renamed,
    // retyped or removed): re-request and re-check the shown layout's roles,
    // and redraw - a rename rewrote element bindings.
    onRolesSynced(async (change) => {
        if (change?.renamed) refreshPanels();
        await syncRoles();
        await refreshRoles();
        await refreshVariables();
    });
    void startRoleSync();

    const { eventSource, eventTypes } = SillyTavern.getContext();
    eventSource.on(eventTypes.CHAT_CHANGED, () => void showChatLayout());
    eventSource.on(VARIABLES_CHANGED_EVENT, (chatId) => void onVariablesChanged(chatId ?? null));

    await showChatLayout();
}
