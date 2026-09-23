// Extension bootstrap: confirms the State Engine dependency is actually
// present, then claims a namespace, registers this extension for
// discovery, and declares its capabilities - the things every State
// Engine extension must do before it can create presets, variables, or
// anything else. Once that succeeds, it restores saved panels and adds
// the Magic Wand entry and the settings drawer. Panel logic itself
// lives in src/panels/, UI wiring in src/ui/.

import { ensureStateEngineAvailable, warnStateEngineMissing } from './api/dependency-check.js';
import { claimNamespace } from './api/namespace.js';
import { registerWithStateEngine } from './api/registration.js';
import { declareCapabilities } from './api/capabilities.js';
import { initPanels } from './panels/panel-manager.js';
import { addWandMenuItems } from './ui/wand-menu.js';
import { addSettingsDrawer } from './ui/settings-drawer.js';

// ---------------------------------------------------------------------
// EXTENSION IDENTITY
// ---------------------------------------------------------------------

// Must be unique across every extension that talks to the State Engine
// API on this SillyTavern install - it is how the State Engine tells
// your extension's calls apart from anyone else's. Convention: match
// your extension's own folder/repo name.
const EXTENSION_ID = 'SillyTavern-StateEngine-PrettyPanels';

// Prefixes every variable and preset your extension creates through the
// State Engine (e.g. a variable named "mood" is stored as
// "prettyPanels__mood"). Letters and digits only, starting with a
// letter - see the State Engine API Reference, "Namespace Model".
const NAMESPACE = 'prettyPanels';

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

    initPanels();
    addWandMenuItems();
    await addSettingsDrawer();
}
