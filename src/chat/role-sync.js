// Keeps State Engine's roles in Pretty Panels' namespace equal to the role
// registry (src/library/role-library.js): on startup, and whenever a layout
// role is added, renamed, retyped or removed. A rename is applied in State
// Engine first (updateRole), so every chat keeps its assignment under the
// new id; then the whole registry is sent (setNamespaceRoles), which adds,
// updates and removes the rest. Calls run one at a time, in order.
//
// After each sync the listeners run with the change ({ renamed? }) - the
// chat session re-requests and re-checks the shown layout's roles.

import { EXTENSION_ID } from '../constants.js';
import { setNamespaceRoles } from '../api/set-namespace-roles.js';
import { updateRole } from '../api/update-role.js';
import { registrySpecs, onLayoutRolesChange } from '../library/role-library.js';
import { notify } from '../ui/dialogs.js';

let queue = Promise.resolve();
let warned = false;
const syncedListeners = new Set();

export function onRolesSynced(listener) {
    syncedListeners.add(listener);
    return () => syncedListeners.delete(listener);
}

function warn(err) {
    console.warn('[PrettyPanels] could not send layout roles to State Engine (update State Engine for role support)', err);
    if (warned) return;
    warned = true;
    notify('warning', 'Pretty Panels could not send its layout roles to State Engine. Roles need a State Engine version with the Role API.');
}

async function run(change = {}) {
    const { renamed } = change;
    try {
        if (renamed) await updateRole(EXTENSION_ID, renamed.from, { publicName: renamed.to });
        const result = await setNamespaceRoles(EXTENSION_ID, registrySpecs());
        if (result === null) warn(new Error('setNamespaceRoles was rejected - see the State Engine warning above'));
    } catch (err) {
        warn(err);
    }
    for (const listener of syncedListeners) {
        try {
            await listener(change);
        } catch (err) {
            console.warn('[PrettyPanels] role sync listener failed', err);
        }
    }
}

// Queues a sync; resolves when it (and everything queued before it) is done.
export function syncRoleDefinitions(change = {}) {
    queue = queue.then(() => run(change));
    return queue;
}

let started = false;
export function startRoleSync() {
    if (started) return queue;
    started = true;
    onLayoutRolesChange((change) => void syncRoleDefinitions(change));
    return syncRoleDefinitions();
}
