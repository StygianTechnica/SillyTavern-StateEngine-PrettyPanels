// The "PP Configuration" preset: Pretty Panels' own per-chat settings,
// stored as ordinary State Engine variables in Pretty Panels' namespace
// and created entirely through the public API. Today it holds one
// variable:
//
//   prettyPanels__layoutId   the layout this chat shows ('' = not chosen)
//
// A chat has a layout choice only once this preset is active in it
// (writeChatLayoutId() activates it). A chat without it shows the
// default layout. A new chat that continues from a previous one inherits
// the preset - and so the layout - through State Engine's own
// continuation, with nothing for Pretty Panels to do.

import { EXTENSION_ID, NAMESPACE } from '../constants.js';
import { listPresets } from '../api/list-presets.js';
import { createPreset } from '../api/create-preset.js';
import { listVariables } from '../api/list-variables.js';
import { createVariable } from '../api/create-variable.js';
import { activatePreset } from '../api/activate-preset.js';
import { getVariableValues } from '../api/get-variable-values.js';
import { setVariableValue } from '../api/set-variable-value.js';

export const CONFIG_PRESET_NAME = 'PP Configuration';
const LAYOUT_VARIABLE_LOCAL = 'layoutId';
export const LAYOUT_VARIABLE = `${NAMESPACE}__${LAYOUT_VARIABLE_LOCAL}`;

// Creates the preset and its variables if missing. Idempotent - safe on
// every load.
export async function ensureConfigPreset() {
    const presets = await listPresets(EXTENSION_ID, NAMESPACE);
    if (!presets.some((p) => p.name === CONFIG_PRESET_NAME)) {
        const created = await createPreset(EXTENSION_ID, {
            namespace: NAMESPACE,
            name: CONFIG_PRESET_NAME,
            description: 'Pretty Panels per-chat settings (which layout this chat shows). Managed by Pretty Panels.',
            triggers: [],
            showInTracker: false,
        });
        if (!created) throw new Error(`could not create the "${CONFIG_PRESET_NAME}" preset`);
    }

    const variables = await listVariables(EXTENSION_ID, NAMESPACE, CONFIG_PRESET_NAME);
    if (!variables.some((v) => v.name === LAYOUT_VARIABLE)) {
        const created = await createVariable(EXTENSION_ID, {
            namespace: NAMESPACE,
            presetName: CONFIG_PRESET_NAME,
            name: LAYOUT_VARIABLE_LOCAL,
            label: 'Pretty Panels layout',
            description: 'ID of the Pretty Panels layout this chat shows. Set by choosing a layout in the Pretty Panels drawer.',
            type: 'string',
            scope: 'chat',
            defaultValue: '',
            showInTracker: false,
        });
        if (!created) throw new Error(`could not create ${LAYOUT_VARIABLE}`);
    }
}

// The layout ID this chat chose, or null if it has none (preset not
// active, or never set).
export async function readChatLayoutId(chatId) {
    if (!chatId) return null;
    const values = await getVariableValues(EXTENSION_ID, chatId, [LAYOUT_VARIABLE]);
    const value = values?.[LAYOUT_VARIABLE]?.value;
    return typeof value === 'string' && value ? value : null;
}

// Records this chat's layout choice, activating the preset first so the
// variable exists in the chat.
export async function writeChatLayoutId(chatId, layoutId) {
    if (!chatId) return false;
    await activatePreset(EXTENSION_ID, chatId, NAMESPACE, CONFIG_PRESET_NAME);
    return setVariableValue(EXTENSION_ID, chatId, {
        namespace: NAMESPACE,
        presetName: CONFIG_PRESET_NAME,
        variableName: LAYOUT_VARIABLE_LOCAL,
    }, layoutId);
}
