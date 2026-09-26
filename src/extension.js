// Extension bootstrap: confirms the State Engine dependency is actually
// present, then claims a namespace, registers this extension for
// discovery, and declares its capabilities - the things every State
// Engine extension must do before it can create presets, variables, or
// anything else. Once that succeeds, it restores saved panels and adds
// the Magic Wand entry and the settings drawer, and starts the chat
// session (per-chat layout choice, live variable values). Panel logic
// lives in src/panels/, elements in src/elements/, chat/State Engine
// data in src/chat/, UI wiring in src/ui/.

import { ensureStateEngineAvailable, warnStateEngineMissing } from './api/dependency-check.js';
import { claimNamespace } from './api/namespace.js';
import { registerWithStateEngine } from './api/registration.js';
import { declareCapabilities } from './api/capabilities.js';
import { loadDateTimeFormatter } from './api/format-datetime.js';
import { loadDateTimePartsReader } from './api/get-datetime-parts.js';
import { EXTENSION_ID, NAMESPACE } from './constants.js';
import { initPanels } from './panels/panel-manager.js';
import { setDateTimeFormatter } from './elements/formats.js';
import { setDateTimePartsReader } from './elements/clock.js';
import { migrateInlineImages } from './storage/pp-variables.js';
import { startChatSession } from './chat/chat-session.js';
import { LAYOUT_VARIABLE } from './chat/pp-config.js';
import { addWandMenuItems } from './ui/wand-menu.js';
import { addSettingsDrawer } from './ui/settings-drawer.js';
import { addLayoutToolbar } from './ui/layout-toolbar.js';

// EXTENSION_ID / NAMESPACE live in src/constants.js - every module that
// calls the State Engine API needs them.

// Plain strings describing what this extension provides, so other
// extensions can discover it via getExtensionsProviding().
const CAPABILITIES = ['ui.panel'];

// Called once, on load (see src/index.js). Safe to call again on a
// later page load - claimNamespace() is idempotent for the same
// EXTENSION_ID/NAMESPACE pair, and registerWithStateEngine()/
// declareCapabilities() simply replace the previous declaration with
// the same one.
//
// The dependency check runs FIRST, and gates everything else: if State
// Engine is not installed, not enabled, or its API cannot be reached,
// this shows one popup and returns - no namespace is claimed, no
// registration or capability call is ever attempted.
export async function initExtension() {
    const available = await ensureStateEngineAvailable();
    if (!available) {
        warnStateEngineMissing();
        console.warn(`[${EXTENSION_ID}] State Engine was not found (not installed, not enabled, or not ready) - initialization aborted.`);
        return;
    }

    try {
        await claimNamespace(EXTENSION_ID, NAMESPACE);

        await registerWithStateEngine(EXTENSION_ID, {
            namespace: NAMESPACE,
            variables: [LAYOUT_VARIABLE],
            capabilities: CAPABILITIES,
            description: 'Free-floating, theme-aware HUD panels.',
        });

        await declareCapabilities(EXTENSION_ID, CAPABILITIES);

        console.log(`[${EXTENSION_ID}] initialized - namespace "${NAMESPACE}" claimed.`);
    } catch (err) {
        // State Engine looked present (the check above passed) but an
        // actual call still failed - "its API cannot be reached", the
        // one failure mode ensureStateEngineAvailable() can't catch in
        // advance. Same warning, never thrown further.
        warnStateEngineMissing();
        console.warn(`[${EXTENSION_ID}] State Engine calls failed unexpectedly - initialization aborted.`, err);
        return;
    }

    try {
        setDateTimeFormatter(await loadDateTimeFormatter(EXTENSION_ID));
    } catch (err) {
        console.warn(`[${EXTENSION_ID}] datetime formatting unavailable - datetime values show unformatted.`, err);
    }
    try {
        setDateTimePartsReader(await loadDateTimePartsReader(EXTENSION_ID));
    } catch (err) {
        console.warn(`[${EXTENSION_ID}] datetime parts unavailable - analog clocks show no time (update State Engine).`, err);
    }
    // Theme assets saved as inline images by the first asset version move
    // to files in the background; panels redraw when they have.
    void migrateInlineImages().catch((err) => console.warn(`[${EXTENSION_ID}] theme asset migration failed`, err));

    initPanels();
    addWandMenuItems();
    addLayoutToolbar();
    await addSettingsDrawer();
    await startChatSession();
}
