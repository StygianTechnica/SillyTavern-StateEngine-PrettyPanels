// Actions other extensions offer, for Action Buttons (element-model.js) and
// for opening an object.
//
// A PROVIDER is another extension's public API with
//   getActions() -> [{ id, label, icon, scope: 'object' | 'panel', description }]
//   runAction(id, objectId?) -> Promise<{ ok, message }>
//   openEntry(id)?  -> Promise<boolean>  (its own page for an object)
// Today: Scenario Builder (window.StateEngineScenarioBuilder). An action is
// named by its REF, "<provider>:<action>" ("scenario-builder:leave"). An
// 'object' action on a card template acts on the card's object; on a panel
// it has none to act on and says so.
//
// Opening an object (a card click): the provider's page for it when it has
// one and the user wants that (store.openObjects: 'extension', the default),
// else Pretty Panels' Object Manager. Nothing here throws.

import { getStore, save } from '../storage/store.js';
import { openObjectManager } from '../ui/object-manager.js';
import { notify } from '../ui/dialogs.js';
import { scenarioBuilderApi } from './archivist-link.js';

const PROVIDERS = Object.freeze([
    { id: 'scenario-builder', name: 'Scenario Builder', api: scenarioBuilderApi },
]);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// "<provider>:<action>" -> { provider, action } or null.
export function parseActionRef(ref) {
    const m = /^([\w-]+):([\w-]+)$/.exec(String(ref ?? ''));
    return m ? { provider: m[1], action: m[2] } : null;
}

// The actions one provider's list describes, as refs. Pure.
export function actionsOf(provider, list) {
    return (Array.isArray(list) ? list : []).filter((a) => isObject(a) && /^[\w-]+$/.test(String(a.id ?? ''))).map((a) => ({
        ref: `${provider.id}:${a.id}`,
        provider: provider.id,
        providerName: provider.name,
        id: a.id,
        label: String(a.label ?? a.id),
        icon: String(a.icon ?? 'hand-pointer').replace(/^fa-/, ''),
        scope: a.scope === 'object' ? 'object' : 'panel',
        description: String(a.description ?? ''),
    }));
}

function apiOf(providerId) {
    const provider = PROVIDERS.find((p) => p.id === providerId);
    try {
        return provider ? provider.api() : null;
    } catch {
        return null;
    }
}

// Every action an installed provider offers now.
export function listActions() {
    const out = [];
    for (const provider of PROVIDERS) {
        const api = apiOf(provider.id);
        if (typeof api?.getActions !== 'function') continue;
        try {
            out.push(...actionsOf(provider, api.getActions()));
        } catch {
            // A provider that fails to list offers nothing.
        }
    }
    return out;
}

export function findAction(ref) {
    return listActions().find((a) => a.ref === ref) ?? null;
}

// Runs an action; `objectId` for an object action on a card.
export async function runAction(ref, objectId = null) {
    const parsed = parseActionRef(ref);
    if (!parsed) return notify('info', 'This button has no action yet - choose one in its properties.');
    const api = apiOf(parsed.provider);
    if (typeof api?.runAction !== 'function') return notify('warning', 'The extension this button belongs to is not installed or not ready.');
    const action = findAction(ref);
    if (action?.scope === 'object' && !objectId) return notify('info', `"${action.label}" acts on an object - put it on a card template.`);
    try {
        const result = await api.runAction(parsed.action, objectId);
        if (result && result.ok === false && result.message) notify('info', result.message);
    } catch (err) {
        notify('error', `The action failed: ${err?.message ?? err}`);
    }
}

// ---- opening an object

export function opensObjectsInExtension() {
    return getStore().openObjects !== 'manager';
}

export function setOpensObjectsInExtension(on) {
    getStore().openObjects = on ? 'extension' : 'manager';
    save();
}

// A provider that can open an object's page, or null.
export function objectPageProvider() {
    for (const provider of PROVIDERS) if (typeof apiOf(provider.id)?.openEntry === 'function') return provider;
    return null;
}

export async function openObject(id) {
    const provider = opensObjectsInExtension() ? objectPageProvider() : null;
    if (provider) {
        try {
            if (await apiOf(provider.id).openEntry(id)) return;
        } catch {
            // Fall back to the Object Manager.
        }
    }
    await openObjectManager({ characterId: id, view: 'chat' });
}
