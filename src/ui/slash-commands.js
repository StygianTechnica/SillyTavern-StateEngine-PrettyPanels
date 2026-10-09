// Pretty Panels slash commands:
//   /pp-banner <panel name>   plays that panel's display animation once (a
//                             banner: in, hold, out) - for STscript and Quick
//                             Replies, and while designing one
// Registered best-effort: the slash command API varies between SillyTavern
// versions, and a failure never stops the extension from loading.

import { replayPanelByName } from '../panels/panel-manager.js';
import { notify } from './dialogs.js';

export function registerSlashCommands() {
    try {
        const context = SillyTavern.getContext();
        if (!context.SlashCommandParser || !context.SlashCommand?.fromProps) return;
        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name: 'pp-banner',
            callback: async (_args, value) => {
                const name = String(value ?? '').trim();
                if (!name) {
                    notify('warning', 'Usage: /pp-banner <panel name>');
                    return '';
                }
                if (!replayPanelByName(name)) notify('warning', `No panel named "${name}" in the layout on screen.`);
                return '';
            },
            helpString: 'Play a Pretty Panels banner (or any panel\'s display animation) once, by panel name: /pp-banner Scene Change',
        }));
    } catch (err) {
        console.warn('[PrettyPanels] slash command registration skipped', err);
    }
}
