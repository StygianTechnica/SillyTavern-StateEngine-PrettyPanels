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
// A template is usually see-through - its cards sit on the panel that holds
// the Character element - so floating over the chat or a drawer it would
// be hard to read. It is drawn on a BACKDROP: the background of a panel on
// screen that shows this template's cards, or the theme's panel tint when
// none does.
//
// Elements may bind to the card's OBJECT fields (the properties pane's
// Character palette - the fields of the template's object type), to
// variables and to roles. The bar sets the object type ("Any object",
// "Character", "Location"...). The preview object - one of this chat's
// objects of that type, or a sample - answers the fields while editing.

import { Panel } from './panel.js';
import {
    basePanelHooks, registerExtraPanel, unregisterExtraPanel, setEditorTemplate, getState, setEditingMode, onStateChange, closePropertiesExcept, templateHostBox,
} from './panel-manager.js';
import {
    getCharacterTemplate, updateCharacterTemplate, onCharacterTemplatesChange, exportCharacterTemplate, setTemplateObjectType,
} from '../library/character-template-library.js';
import { getValue, getImage, onValuesChange, loadTemplateFieldList, listPreviewObjects, listCardObjectTypes } from '../chat/variable-service.js';
import { isCharRef, charFieldOfRef } from '../elements/element-model.js';
import { characterEntry, characterFieldDef, sampleObject } from '../elements/character-fields.js';
import { hueFor, initialsFor } from '../elements/character-card.js';
import { notify } from '../ui/dialogs.js';
import { downloadJson, safeFilename } from '../ui/files.js';
import { attachFonts } from '../ui/font-transfer.js';

// Kept above every layout panel (their z-index is 0..99).
const EDITOR_Z_INDEX = 99;

// { templateId, panel, bar, pos: { x, y }, previewId, objectType, type,
//   fields, objects: [preview objects], sample, types: [object types], stops: [] }
let editor = null;

export function isTemplateEditorOpen(templateId = null) {
    return !!editor && (templateId === null || editor.templateId === templateId);
}

function previewCharacter() {
    if (!editor) return sampleObject(null);
    return editor.objects.find((o) => o.id === editor.previewId) ?? editor.sample;
}

const fieldListeners = new Set();

// Called with the palette fields, and the object type (null: any object),
// whenever the open editor's object type is read (the properties pane's
// object palette).
export function onTemplateEditorFields(listener) {
    fieldListeners.add(listener);
    if (editor?.loaded) listener(editor.fields, editor.type);
    return () => fieldListeners.delete(listener);
}

// Reads what the template's object type offers: its fields (for the
// palette and the sample) and this chat's objects of it (for the preview).
async function loadType() {
    if (!editor) return;
    const objectType = getCharacterTemplate(editor.templateId)?.objectType ?? '';
    const [{ type, fields }, objects, types] = await Promise.all([
        loadTemplateFieldList(objectType), listPreviewObjects(objectType), editor.types.length ? editor.types : listCardObjectTypes(),
    ]);
    if (!editor) return;
    Object.assign(editor, { objectType, type, fields, objects: objectType ? objects : [], sample: sampleObject(type, fields), types, loaded: true });
    fillBar();
    editor.panel.renderValues();
    for (const listener of fieldListeners) listener(fields, type);
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

// The preview objects: this chat's of the template's type, those in the
// scene first, then the sample.
function previewOptions() {
    const objects = [...editor.objects].sort((a, b) => Number(!!b.present) - Number(!!a.present) || String(a.name).localeCompare(String(b.name)));
    const noun = editor.type ? editor.type.label.toLowerCase() : 'object';
    return [...objects.map((c) => ({ id: c.id, label: `${c.name}${c.present ? ' (in the scene)' : ''}` })), { id: editor.sample.id, label: `Sample ${noun}` }];
}

function fillBar() {
    const { bar } = editor;
    const template = getCharacterTemplate(editor.templateId);
    bar.querySelector('.pp-template-editor-name').textContent = template?.name ?? '';
    const typeSelect = bar.querySelector('[data-el="objectType"]');
    if (typeSelect !== document.activeElement) {
        const types = editor.types.length ? editor.types : [{ id: 'character', label: 'Character' }];
        typeSelect.replaceChildren(new Option('Any object', ''), ...types.map((t) => new Option(t.label, t.id)));
        if (editor.objectType && !types.some((t) => t.id === editor.objectType)) typeSelect.add(new Option(editor.objectType, editor.objectType));
        typeSelect.value = editor.objectType;
    }
    const select = bar.querySelector('[data-el="preview"]');
    if (select === document.activeElement) return;
    const options = previewOptions();
    if (!options.some((o) => o.id === editor.previewId)) editor.previewId = options[0].id;
    select.replaceChildren(...options.map((o) => new Option(o.label, o.id)));
    select.value = editor.previewId;
}

// Whether a computed CSS colour is (nearly) see-through.
function seeThrough(color) {
    if (!color || color === 'transparent') return true;
    const alpha = /rgba?\(([^)]+)\)/.exec(color)?.[1].split(/[\s,/]+/).filter(Boolean)[3];
    return alpha !== undefined && Number.parseFloat(alpha) < 0.15;
}

// The backdrop behind the editor: the host panel's colour, blur, image and
// texture as it shows them now - or the theme tint (the CSS default).
function buildBackdrop(templateId) {
    const backdrop = document.createElement('div');
    backdrop.className = 'pp-template-editor-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');
    const host = templateHostBox(templateId);
    if (!host) return backdrop;
    const box = getComputedStyle(host);
    const image = host.querySelector('.pp-panel-image');
    const imageStyle = image ? getComputedStyle(image) : null;
    const hasImage = !!imageStyle && imageStyle.backgroundImage && imageStyle.backgroundImage !== 'none';
    if (seeThrough(box.backgroundColor) && !hasImage) return backdrop;
    backdrop.classList.add('pp-template-editor-backdrop-host');
    backdrop.style.backgroundColor = box.backgroundColor;
    if (box.backdropFilter && box.backdropFilter !== 'none') backdrop.style.backdropFilter = box.backdropFilter;
    if (hasImage) {
        const layer = document.createElement('div');
        layer.className = 'pp-template-editor-backdrop-image';
        for (const prop of ['backgroundImage', 'backgroundSize', 'backgroundRepeat', 'backgroundPosition', 'opacity']) layer.style[prop] = imageStyle[prop];
        backdrop.append(layer);
    }
    backdrop.title = 'The background of the panel that shows these cards';
    return backdrop;
}

function buildBar() {
    const bar = document.createElement('div');
    bar.className = 'pp-template-editor-bar';
    // Two rows - the name and Done, then the pickers - so long names and
    // option labels show whole.
    bar.innerHTML = `
        <div class="pp-template-editor-row">
            <i class="fa-solid fa-id-badge"></i>
            <span class="pp-template-editor-label">Card template:</span>
            <b class="pp-template-editor-name"></b>
            <div class="menu_button pp-template-editor-done" title="Close the template editor (changes are already saved)"><i class="fa-solid fa-check"></i><span>Done</span></div>
        </div>
        <div class="pp-template-editor-row">
            <label class="pp-template-editor-preview" title="Which objects this template is for: its palette offers that type's fields, and Character elements showing that type offer it. Any object: only the fields every object has.">
                <span>For</span><select class="text_pole" data-el="objectType"></select>
            </label>
            <label class="pp-template-editor-preview" title="Whose values the fields show while you edit">
                <span>Preview</span><select class="text_pole" data-el="preview"></select>
            </label>
        </div>`;
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    bar.querySelector('[data-el="preview"]').addEventListener('change', (e) => {
        editor.previewId = e.target.value;
        editor.panel.renderValues();
    });
    bar.querySelector('[data-el="objectType"]').addEventListener('change', (e) => {
        if (setTemplateObjectType(editor.templateId, e.target.value)) editor.previewId = null;
    });
    bar.querySelector('.pp-template-editor-done').addEventListener('click', () => closeTemplateEditor());
    return bar;
}

// Opens the editor on a template (closing any other). Turns Editing Mode on.
export function openTemplateEditor(templateId) {
    if (!getState().enabled) {
        notify('warning', 'Turn Pretty Panels on to edit card templates.');
        return false;
    }
    const template = getCharacterTemplate(templateId);
    if (!template) return false;
    closeTemplateEditor();
    if (!getState().editingMode) setEditingMode(true);
    const pos = {
        x: Math.max(16, Math.round((window.innerWidth - template.width) / 2)),
        // Room above for the two-row bar.
        y: Math.max(110, Math.round((window.innerHeight - template.height) / 3)),
    };
    editor = { templateId, pos, previewId: null, objectType: template.objectType, type: null, fields: [], objects: [], sample: sampleObject(null), types: [], loaded: false, stops: [] };
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
    panel.el.prepend(buildBackdrop(templateId));
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
            const current = getCharacterTemplate(templateId);
            if (!current) closeTemplateEditor();
            else if (editor && current.objectType !== editor.objectType) void loadType();
            else fillBar();
        }),
        // Leaving Editing Mode (or turning Pretty Panels off) closes it.
        onStateChange((state) => {
            if (!state.editingMode) closeTemplateEditor();
        }),
    );
    closePropertiesExcept(panel);
    panel.openProperties('panel');
    void loadType();
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
