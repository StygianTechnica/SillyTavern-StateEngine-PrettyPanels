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
//
// A template with a compact area (src/panels/drawer.js) draws collapsed
// cards - the tiling uses their compact size, in Editing Mode too, so the
// layout shows its real spacing. A Drawer Toggle on a card (outside Editing
// Mode) opens that card: the whole card floats from <body> over its
// neighbours (a list scrolls and clips; a drawer must not be cut off), its
// compact area over the collapsed card's. Each card opens on its own; the
// state is per chat, per session.

import { getCharacterTemplate } from '../library/character-template-library.js';
import { buildCharacterCard, fallbackIcon } from './character-card.js';
import { characterEntry } from './character-fields.js';
import { bindingRef, isCharRef, charFieldOfRef, isVariableElement, ELEMENT_TYPE_CHARACTER, normalizeCharacterOptions } from './element-model.js';
import { buildElementContent, renderElementContent } from './element-view.js';
import { applyPanelTheme } from '../themes/theme-apply.js';
import { currentChatId } from '../chat/variable-service.js';
import { fitCompact, collapsedBox, openBox, drawerKey, isDrawerOpen, setDrawerOpen, toggleDrawer } from '../panels/drawer.js';

// The value an element of a template shows on `character`'s card.
export function templateEntry(element, character, getValue) {
    const ref = bindingRef(element.binding);
    if (!ref) return undefined;
    return isCharRef(ref) ? characterEntry(character, charFieldOfRef(ref)) : getValue(ref);
}

// Draws `template`'s elements into `canvas` for `character`. A portrait
// (the image field) the character has none for shows its fallback icon.
// Character elements are not drawn inside a card (no cards in cards).
// context.drawerOpen: the card's drawer is open (a toggle's icon turns over).
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
        const flag = element.visibleWhen?.flag;
        renderElementContent(el, element, entry, theme, { ...context, flagValue: flag ? getValue(flag)?.value : undefined });
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
export function buildTemplateCard(template, character, { getValue, getImage }, drawerOpen = false) {
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
        getValue, theme, context: { variant, panelClock: template.clock, drawerOpen },
    });
    return card;
}

// ---- card drawers ------------------------------------------------------------

// Open card drawers on screen: drawer key -> { card (floating), anchor (the
// collapsed card in its list) }.
const floating = new Map();

function cardKey(elementId, characterId) {
    return drawerKey(currentChatId(), 'card', elementId, characterId);
}

// The card's insets around its canvas.
function cardChrome(card) {
    const box = card.getBoundingClientRect();
    const canvas = card.querySelector('.pp-panel-canvas').getBoundingClientRect();
    return { left: canvas.left - box.left, top: canvas.top - box.top, right: box.right - canvas.right, bottom: box.bottom - canvas.bottom };
}

// The template's compact area kept inside its canvas, for a card in the DOM.
function cardArea(card, template) {
    const chrome = cardChrome(card);
    return { chrome, area: fitCompact(template.compact, template.width - chrome.left - chrome.right, template.height - chrome.top - chrome.bottom) };
}

// Shrinks a (connected) card to its template's compact area.
function collapseCard(card, template) {
    const { chrome, area } = cardArea(card, template);
    const small = collapsedBox({ x: 0, y: 0 }, chrome, area);
    card.classList.add('pp-drawer-collapsed');
    card.style.setProperty('--pp-compact-x', `${area.x}px`);
    card.style.setProperty('--pp-compact-y', `${area.y}px`);
    Object.assign(card.style, { width: `${Math.round(small.width)}px`, height: `${Math.round(small.height)}px` });
}

function closeFloating(key) {
    floating.get(key)?.card.remove();
    floating.delete(key);
}

// Drops floating cards whose list is gone (an element deleted, a layout
// hidden): their collapsed card is no longer on the page.
function sweepFloating() {
    for (const [key, { anchor }] of floating) if (!anchor.isConnected) closeFloating(key);
}

// In its list a card inherits the styling variables it doesn't set itself
// (Panel Styling such as background opacity, theme colours and fonts) from
// the panel it sits in. Floating from <body> it has no such parent, so it
// takes them over from the collapsed card - open looks like closed.
function inheritPanelVars(card, anchor) {
    const inherited = getComputedStyle(anchor);
    for (let i = 0; i < inherited.length; i++) {
        const name = inherited[i];
        if (!name.startsWith('--pp') || name.startsWith('--pp-compact') || card.style.getPropertyValue(name)) continue;
        const value = inherited.getPropertyValue(name);
        if (value) card.style.setProperty(name, value);
    }
}

// The floating open card for `key`, over the collapsed `anchor` card.
function showFloating(key, anchor, template, character, services, onClick) {
    closeFloating(key);
    const rect = anchor.getBoundingClientRect();
    const card = buildTemplateCard(template, character, services, true);
    card.classList.add('pp-card-drawer');
    inheritPanelVars(card, anchor);
    document.body.append(card);
    const { area } = cardArea(card, template);
    const box = openBox({ x: rect.left, y: rect.top }, area, template.width, template.height, window.innerWidth, window.innerHeight);
    Object.assign(card.style, { left: `${Math.round(box.x)}px`, top: `${Math.round(box.y)}px` });
    card.addEventListener('click', onClick);
    floating.set(key, { card, anchor });
}

// Escape closes every open card drawer.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || floating.size === 0) return;
    for (const key of [...floating.keys()]) {
        setDrawerOpen(key, false);
        closeFloating(key);
    }
});

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
    const editing = document.body.classList.contains('pp-editing');
    const drawers = !!template?.compact;
    // This element's floating cards are rebuilt below (values change, cards
    // come and go); none float while editing.
    const prefix = cardKey(element.id, '');
    for (const key of [...floating.keys()]) if (key.startsWith(prefix)) closeFloating(key);
    sweepFloating();
    for (const id of chosen) {
        const character = services.getCharacter(id);
        const key = cardKey(element.id, id);
        const card = template
            ? buildTemplateCard(template, character, services)
            : buildCharacterCard(id, character, services.cardOptions);
        card.dataset.characterId = id;
        if (template) {
            card.title = character ? `${character.name}\nClick to open the Character Manager.` : `${id}: not a character of this chat or its setting`;
            // A Drawer Toggle opens or closes the card; anywhere else opens
            // the Character Manager. In Editing Mode a click selects the
            // element instead.
            const onClick = (e) => {
                if (document.body.classList.contains('pp-editing')) return;
                e.stopPropagation();
                if (drawers && e.target.closest('.pp-kind-toggle')) {
                    toggleDrawer(key);
                    if (isDrawerOpen(key)) showFloating(key, card, template, services.getCharacter(id), services, onClick);
                    else closeFloating(key);
                    return;
                }
                services.onOpen(id);
            };
            card.addEventListener('click', onClick);
            host.append(card);
            if (drawers) {
                // A card is measured to collapse it: on a first render the
                // list isn't on the page yet - collapse it once it is.
                const finish = () => {
                    if (!card.isConnected) return;
                    collapseCard(card, template);
                    if (!editing && isDrawerOpen(key)) showFloating(key, card, template, character, services, onClick);
                };
                if (card.isConnected) finish();
                else requestAnimationFrame(finish);
            }
            continue;
        }
        host.append(card);
    }
}
