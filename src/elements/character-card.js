// Character variables on a panel (State Engine characters, requirements
// spec 1.42): a character variable draws a CharacterCard, a list of
// characters (an array of item type character) a CharacterList of cards.
//
// A card: the character's image - or a generated fallback icon (initials
// on a colour derived from the character's id, so a character keeps its
// colour) - its name (through Text Case, like all text), a confirmed /
// unconfirmed badge, and optionally a presence dot and its aliases (the
// element's Value Formatting: format.value.characterPresence /
// characterAliases). Clicking a card outside Editing Mode opens the
// Character Manager on that character.

// A stable hue for a character id.
function hueFor(id) {
    let hash = 0;
    for (const ch of String(id)) hash = ((hash << 5) - hash + ch.codePointAt(0)) | 0;
    return Math.abs(hash) % 360;
}

// "Captain Rhys Varn" -> "CR"; "the hooded woman" -> "HW" (a leading
// article is skipped).
export function initialsFor(name) {
    const words = String(name ?? '').trim().split(/\s+/).filter((w) => !/^(the|a|an)$/i.test(w));
    const letters = (words.length ? words : [String(name ?? '?')]).slice(0, 2).map((w) => [...w][0] ?? '');
    return letters.join('').toUpperCase() || '?';
}

// The fallback icon: an element showing the initials on the character's colour.
export function fallbackIcon(character) {
    const icon = document.createElement('div');
    icon.className = 'pp-character-fallback';
    const hue = hueFor(character?.id ?? character?.name ?? '');
    icon.style.background = `hsl(${hue} 45% 38%)`;
    icon.textContent = initialsFor(character?.name);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function portrait(character) {
    if (character?.image) {
        const img = document.createElement('img');
        img.className = 'pp-character-image';
        img.src = character.image;
        img.alt = '';
        img.draggable = false;
        // A broken image falls back to the icon.
        img.addEventListener('error', () => img.replaceWith(fallbackIcon(character)), { once: true });
        return img;
    }
    return fallbackIcon(character);
}

// One CharacterCard. `character` is State Engine's character (or null for an
// id it no longer knows); `options`: { showPresence, showAliases,
// caseText(text), onOpen(id) }.
export function buildCharacterCard(id, character, options) {
    const card = document.createElement('div');
    card.className = 'pp-character-card';
    card.dataset.characterId = id;
    if (!character) {
        card.classList.add('pp-character-missing');
        card.append(fallbackIcon({ id, name: '?' }));
        const name = document.createElement('span');
        name.className = 'pp-character-name';
        name.textContent = 'Unknown character';
        card.append(name);
        card.title = `${id}: not a character of this chat or its setting`;
        return card;
    }
    card.append(portrait(character));
    const body = document.createElement('div');
    body.className = 'pp-character-body';
    const nameRow = document.createElement('div');
    nameRow.className = 'pp-character-name-row';
    const name = document.createElement('span');
    name.className = 'pp-character-name';
    name.textContent = options.caseText(character.name);
    nameRow.append(name);
    if (options.showPresence) {
        const dot = document.createElement('span');
        dot.className = `pp-character-presence ${character.present ? 'pp-present' : 'pp-absent'}`;
        dot.title = character.present ? 'In the scene' : 'Not in the scene';
        nameRow.append(dot);
    }
    const badge = document.createElement('span');
    badge.className = `pp-character-badge ${character.confirmed ? 'pp-confirmed' : 'pp-unconfirmed'}`;
    badge.textContent = character.confirmed ? '✓' : '?';
    badge.title = character.confirmed ? 'Confirmed' : 'Unconfirmed - review it in the Character Manager';
    nameRow.append(badge);
    body.append(nameRow);
    if (options.showAliases && character.aliases.length) {
        const aliases = document.createElement('div');
        aliases.className = 'pp-character-aliases';
        aliases.textContent = options.caseText(character.aliases.join(', '));
        body.append(aliases);
    }
    card.append(body);
    card.title = `${character.name}${character.aliases.length ? ` (${character.aliases.join(', ')})` : ''}\n${character.id}${character.scope === 'chat' ? ' - this chat only' : ''}\nClick to open the Character Manager.`;
    card.addEventListener('click', (e) => {
        // In Editing Mode a click selects the element instead.
        if (document.body.classList.contains('pp-editing')) return;
        e.stopPropagation();
        options.onOpen?.(id);
    });
    return card;
}

// Fills `container` with a card (a character variable) or a list of cards
// (a list of characters). `ids` are the variable's character ids.
export function renderCharacters(container, ids, getCharacter, options) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter((id) => typeof id === 'string' && id);
    container.replaceChildren();
    if (list.length === 0) {
        container.textContent = '—';
        return;
    }
    const holder = document.createElement('div');
    holder.className = options.list ? 'pp-character-list' : 'pp-character-single';
    for (const id of list) holder.append(buildCharacterCard(id, getCharacter(id), options));
    container.append(holder);
}
