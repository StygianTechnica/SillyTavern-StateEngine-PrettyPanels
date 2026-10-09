// Character elements (element type 'character'): a character variable - or
// a list of characters - drawn as CARDS. With a character template
// (src/library/character-template-library.js) each card is that template
// drawn for one character: the real panel structure and theme, its
// elements rendered exactly as on a panel, character fields answered from
// that card's character and everything else (variables, roles) from the
// chat. Without one, the built-in card (character-card.js).
//
// Cards keep the template's size. A list tiles as a grid (wrapping rows),
// a row or a column, per the element's options; whatever doesn't fit
// scrolls. Clicking a card outside Editing Mode opens the Character Manager
// on that character.

import { getCharacterTemplate } from '../library/character-template-library.js';
import { buildCharacterCard, fallbackIcon } from './character-card.js';
import { characterEntry } from './character-fields.js';
import { bindingRef, isCharRef, charFieldOfRef, isVariableElement, ELEMENT_TYPE_CHARACTER, normalizeCharacterOptions } from './element-model.js';
import { buildElementContent, renderElementContent } from './element-view.js';
import { applyPanelTheme } from '../themes/theme-apply.js';

// The value an element of a template shows on `character`'s card.
export function templateEntry(element, character, getValue) {
    const ref = bindingRef(element.binding);
    if (!ref) return undefined;
    return isCharRef(ref) ? characterEntry(character, charFieldOfRef(ref)) : getValue(ref);
}

// Draws `template`'s elements into `canvas` for `character`. A portrait
// (the image field) the character has none for shows its fallback icon.
// Character elements are not drawn inside a card (no cards in cards).
export function renderTemplateElements(canvas, template, character, { getValue, theme, context }) {
    canvas.replaceChildren();
    const elements = template.widgets
        .filter((w) => isVariableElement(w) && w.type !== ELEMENT_TYPE_CHARACTER)
        .map((element, index) => ({ element, index }))
        .sort((a, b) => (a.element.zIndex ?? 0) - (b.element.zIndex ?? 0) || a.index - b.index)
        .map(({ element }) => element);
    for (const element of elements) {
        const el = buildElementContent();
        Object.assign(el.style, { left: `${element.x}px`, top: `${element.y}px`, width: `${element.width}px`, height: `${element.height}px` });
        const entry = templateEntry(element, character, getValue);
        renderElementContent(el, element, entry, theme, context);
        if (element.binding?.char === 'image' && entry === undefined && character) showFallbackPortrait(el, character);
        canvas.append(el);
    }
}

function showFallbackPortrait(el, character) {
    el.classList.remove('pp-element-missing');
    el.classList.add('pp-character-portrait');
    el.querySelector('.pp-element-label').hidden = true;
    el.querySelector('.pp-element-value').replaceChildren(fallbackIcon(character));
}

// One card: `template` drawn for `character` (null: a character the chat no
// longer knows - drawn with no character values).
export function buildTemplateCard(template, character, { getValue, getImage }) {
    const card = document.createElement('div');
    card.className = 'pp-panel pp-template-card';
    card.innerHTML = `
        <div class="pp-panel-box">
            <div class="pp-panel-image" aria-hidden="true"></div>
            <div class="pp-panel-texture" aria-hidden="true"></div>
            <div class="pp-panel-accent" aria-hidden="true"></div>
            <div class="pp-panel-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <div class="pp-panel-body"><div class="pp-panel-canvas"></div></div>
        </div>`;
    Object.assign(card.style, { width: `${template.width}px`, height: `${template.height}px` });
    const background = template.style?.backgroundImageVariable;
    const { theme, variant } = applyPanelTheme(card, template, background ? getImage(background) : undefined);
    renderTemplateElements(card.querySelector('.pp-panel-canvas'), template, character, {
        getValue, theme, context: { variant, panelClock: template.clock },
    });
    return card;
}

// Fills a Character element's value area with its cards. `ids`: the
// variable's character id(s); `list`: it is a list (tiled); `services`:
// { getCharacter, getValue, getImage, onOpen(id), cardOptions } -
// cardOptions are the built-in card's (presence, aliases, text case).
export function renderCharacterTiles(host, element, ids, list, services) {
    const options = normalizeCharacterOptions(element.character);
    const template = getCharacterTemplate(options.templateId);
    const chosen = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id);
    host.replaceChildren();
    host.className = `pp-element-value pp-character-tiles pp-tiling-${list ? options.tiling : 'single'}${template ? '' : ' pp-character-builtin'}`;
    host.style.gap = `${options.gap}px`;
    if (chosen.length === 0) {
        host.textContent = '—';
        return;
    }
    for (const id of chosen) {
        const character = services.getCharacter(id);
        const card = template
            ? buildTemplateCard(template, character, services)
            : buildCharacterCard(id, character, services.cardOptions);
        card.dataset.characterId = id;
        if (template) {
            card.title = character ? `${character.name}\nClick to open the Character Manager.` : `${id}: not a character of this chat or its setting`;
            card.addEventListener('click', (e) => {
                // In Editing Mode a click selects the element instead.
                if (document.body.classList.contains('pp-editing')) return;
                e.stopPropagation();
                services.onOpen(id);
            });
        }
        host.append(card);
    }
}
