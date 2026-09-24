// Panel-properties actions that feed the Panel Library: save the panel
// instance whose properties are open as a template (new, or overwrite
// an existing one after confirmation), or export it as a template file.
// Both act on exactly the instance they were handed - which is why they
// live in the properties pane and not the Magic Wand.

import { listTemplates, getTemplate, createTemplate, overwriteTemplate, templatePayload } from '../library/panel-library.js';
import { chooseFromList, confirmYesNo, promptText, notify } from './dialogs.js';
import { downloadJson, safeFilename } from './files.js';
import { attachFonts } from './font-transfer.js';

const NEW_TEMPLATE = Symbol('new-template');

export async function saveInstanceToLibrary(record) {
    const templates = listTemplates();
    let target = NEW_TEMPLATE;
    if (templates.length > 0) {
        target = await chooseFromList({
            title: 'Save Panel to Library',
            items: [
                { value: NEW_TEMPLATE, label: 'Save as new template', icon: 'fa-plus' },
                ...templates.map((t) => ({
                    value: t.id,
                    label: t.name,
                    detail: `Overwrite · ${t.width} × ${t.height}`,
                    icon: 'fa-floppy-disk',
                })),
            ],
        });
        if (target === undefined) return;
    }

    if (target === NEW_TEMPLATE) {
        const name = await promptText('Template name:', record.name);
        if (!name) return;
        const saved = createTemplate(name, record);
        notify('success', `Saved "${saved.name}" to the Panel Library.`);
        return;
    }

    const existing = getTemplate(target);
    if (!existing) return;
    const ok = await confirmYesNo(`Overwrite the template "${existing.name}" with this panel? Panels already created from it are not changed.`);
    if (!ok) return;
    overwriteTemplate(target, record);
    notify('success', `Updated "${existing.name}" in the Panel Library.`);
}

export async function exportInstanceTemplate(record) {
    const payload = await attachFonts(templatePayload(record.name, record));
    if (payload) downloadJson(`${safeFilename(record.name)}.panel.json`, payload);
}
