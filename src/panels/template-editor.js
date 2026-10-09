// The character template editor: a TEMPORARY floating panel that edits one
// character template (src/library/character-template-library.js) with the
// ordinary panel tools - the same Panel, elements, properties pane, palette
// and drag-and-drop as a layout panel. Only one is open at a time.
//
// It is clearly not a layout panel: a dashed outline, a bar above it reading
// "Character template: <name>" with the preview character and Done, and no
// lock, layering, anchor or Panel Library controls in its properties. It
// never joins the layout or a group; its position is not stored (only its
// size and contents are - in the template).
//
// Elements may bind to the card's CHARACTER fields (the properties pane's
// Character palette), to variables and to roles. The preview character -
// one of this chat's characters, or a sample - answers the character fields
// while editing.

import { Panel } from './panel.js';
import {
    basePanelHooks, registerExtraPanel, unregisterExtraPanel, setEditorTemplate, getState, setEditingMode, onStateChange, closePropertiesExcept,
} from './panel-manager.js';
import {
    getCharacterTemplate, updateCharacterTemplate, onCharacterTemplatesChange, exportCharacterTemplate,
} from '../library/character-template-library.js';
import { getValue, getImage, onValuesChange, getCharacterList, getCharacter } from '../chat/variable-service.js';
import { isCharRef, charFieldOfRef } from '../elements/element-model.js';
import { characterEntry, characterFieldDef, SAMPLE_CHARACTER } from '../elements/character-fields.js';
import { hueFor, initialsFor } from '../elements/character-card.js';
import { notify } from '../ui/dialogs.js';
import { downloadJson, safeFilename } from '../ui/files.js';
import { attachFonts } from '../ui/font-transfer.js';

// Kept above every layout panel (their z-index is 0..99).
const EDITOR_Z_INDEX = 99;

let editor = null; // { templateId, panel, bar, pos: { x, y }, previewId, stops: [] }

export function isTemplateEditorOpen(templateId = null) {
    return !!editor && (templateId === null || editor.templateId === templateId);
}

function previewCharacter() {
    if (!editor || editor.previewId === SAMPLE_CHARACTER.id) return SAMPLE_CHARACTER;
    return getCharacter(editor.previewId) ?? SAMPLE_CHARACTER;
}

// The generated icon a card shows for a character without an image
// (character-card.js), as an image the editor's elements can draw.
function fallbackPortrait(character) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hueFor(character.id)} 45% 38%)"/>`
        + `<text x="50" y="50" dy=".35em" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="38" fill="#fff">${initialsFor(character.name).replace(/[<&>]/g, '')}</text></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// Character fields answer from the preview character; anything else is
// the chat's value, as on a layout panel.
function previewValue(ref) {
    if (!isCharRef(ref)) return getValue(ref);
    const character = previewCharacter();
    const field = charFieldOfRef(ref);
    const entry = characterEntry(character, field);
    if (entry === undefined && field === 'image') return { value: fallbackPortrait(character), def: characterFieldDef(field) };
    return entry;
}

// The panel record the editor shows: the template's design at the editor's
// (unstored) position.
function editorRecord(template, pos) {
    return {
        ...template,
        id: `ppc-editor-${template.id}`,
        name: template.name,
        x: pos.x,
        y: pos.y,
        locked: false,
        zIndex: EDITOR_Z_INDEX,
        anchorMode: 'free',
        anchorTarget: null,
    };
}

// Writes go to the template; placement stays with the editor.
function writeTemplate(patch) {
    const { x, y, locked: _locked, zIndex: _z, anchorMode: _mode, anchorTarget: _target, name: _name, ...design } = patch;
    const saved = Object.keys(design).length ? updateCharacterTemplate(editor.templateId, design) : getCharacterTemplate(editor.templateId);
    if (!saved) return null;
    if (Number.isFinite(x)) editor.pos.x = x;
    if (Number.isFinite(y)) editor.pos.y = y;
    return editorRecord(saved, editor.pos);
}

async function exportTemplate() {
    const payload = exportCharacterTemplate(editor.templateId);
    const withFonts = payload && await attachFonts(payload);
    if (withFonts) downloadJson(`${safeFilename(withFonts.data.name)}.character.json`, withFonts);
}

// The preview characters: this chat's, those in the scene first, then the sample.
function previewOptions() {
    const characters = [...getCharacterList()].sort((a, b) => Number(!!b.present) - Number(!!a.present) || a.name.localeCompare(b.name));
    return [...characters.map((c) => ({ id: c.id, label: `${c.name}${c.present ? ' (in the scene)' : ''}` })), { id: SAMPLE_CHARACTER.id, label: 'Sample character' }];
}

function fillBar() {
    const { bar } = editor;
    const template = getCharacterTemplate(editor.templateId);
    bar.querySelector('.pp-template-editor-name').textContent = template?.name ?? '';
    const select = bar.querySelector('select');
    if (select === document.activeElement) return;
    const options = previewOptions();
    if (!options.some((o) => o.id === editor.previewId)) editor.previewId = options[0].id;
    select.replaceChildren(...options.map((o) => new Option(o.label, o.id)));
    select.value = editor.previewId;
}

function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'pp-template-editor-bar';
    bar.innerHTML = `
        <i class="fa-solid fa-id-badge"></i>
        <span class="pp-template-editor-label">Character template:</span>
        <b class="pp-template-editor-name"></b>
        <label class="pp-template-editor-preview" title="Whose values the character fields show while you edit">
            <span>Preview</span><select class="text_pole"></select>
        </label>
        <div class="menu_button pp-template-editor-done" title="Close the template editor (changes are already saved)"><i class="fa-solid fa-check"></i><span>Done</span></div>`;
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.querySelector('select').addEventListener('change', (e) => {
        editor.previewId = e.target.value;
        editor.panel.renderValues();
    });
    bar.querySelector('.pp-template-editor-done').addEventListener('click', () => closeTemplateEditor());
    return bar;
}

// Opens the editor on a template (closing any other). Turns Editing Mode on.
export function openTemplateEditor(templateId) {
    if (!getState().enabled) {
        notify('warning', 'Turn Pretty Panels on to edit character templates.');
        return false;
    }
    const template = getCharacterTemplate(templateId);
    if (!template) return false;
    closeTemplateEditor();
    if (!getState().editingMode) setEditingMode(true);
    const pos = {
        x: Math.max(16, Math.round((window.innerWidth - template.width) / 2)),
        y: Math.max(80, Math.round((window.innerHeight - template.height) / 3)),
    };
    editor = { templateId, pos, previewId: null, stops: [] };
    const hooks = {
        ...basePanelHooks(),
        placePanel: () => false,
        onDragBegin() {},
        onAnchorChange() {},
        onLockChange() {},
        onDeleteRequest() {},
        onSaveTemplateRequest() {},
        onExportTemplateRequest: () => void exportTemplate(),
        onZIndexChange() {},
        onRestack() {},
        getGroupPeers: () => [],
        onPanelDragging() {},
        getValue: previewValue,
        getImage: (name) => getImage(name),
    };
    const panel = new Panel(editorRecord(template, pos), hooks);
    panel.writeRecord = writeTemplate;
    panel.isTemplateEditor = true;
    panel.el.classList.add('pp-template-editor');
    editor.panel = panel;
    editor.bar = buildBar();
    panel.el.appendChild(editor.bar);
    fillBar();
    registerExtraPanel(panel);
    panel.mount();
    setEditorTemplate(templateId);

    editor.stops.push(
        onValuesChange(() => {
            fillBar();
            panel.renderValues();
        }),
        onCharacterTemplatesChange(() => {
            if (!getCharacterTemplate(templateId)) closeTemplateEditor();
            else fillBar();
        }),
        // Leaving Editing Mode (or turning Pretty Panels off) closes it.
        onStateChange((state) => {
            if (!state.editingMode) closeTemplateEditor();
        }),
    );
    closePropertiesExcept(panel);
    panel.openProperties('panel');
    return true;
}

export function closeTemplateEditor() {
    if (!editor) return;
    const { panel, stops } = editor;
    editor = null;
    for (const stop of stops) stop();
    unregisterExtraPanel(panel);
    panel.destroy();
    setEditorTemplate(null);
}
