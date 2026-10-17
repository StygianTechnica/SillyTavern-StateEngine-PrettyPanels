// What the Archivist extension (window.StateEngineArchivist, optional) knows
// about each character, for character templates: the compiled memory's
// insights into the character and its relationship toward the user's
// persona. Read once per values refresh (variable-service.js) from
// Archivist's compiled view, and handed to templates as each character's
// `archivist` field (character-fields.js, the "archivist.*" fields).
//
// Without Archivist - or before it has compiled the chat - characters have
// no `archivist` field, and those template fields simply show nothing.

// Emitted by Archivist on SillyTavern's eventSource after a compile.
export const ARCHIVIST_COMPILED_EVENT = 'archivist_compiled_changed';

export function archivistApi() {
    try {
        return globalThis.window?.StateEngineArchivist ?? null;
    } catch {
        return null;
    }
}

const ARTICLES = new Set(['a', 'an', 'the']);

// A name as its words - lower case, no punctuation or brackets, no leading
// article, any order - so "gremlin (lead)" is "A lead gremlin". The same
// rule Archivist links names to objects by (its compiler/entity-link.js).
export function nameKey(name) {
    const words = String(name ?? '').toLowerCase().replace(/['’]s\b/g, '').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    return [...new Set(words.filter((w) => !ARTICLES.has(w)))].sort().join(' ');
}

// The names something goes by: its name and aliases, as name keys.
function namesOf(thing) {
    return new Set([thing?.name, ...(Array.isArray(thing?.aliases) ? thing.aliases : [])].map(nameKey).filter(Boolean));
}

// Whether a compiled entity ({ id | null, name }) is `who` (an object with
// id, name and aliases).
function isEntity(entity, who) {
    if (!entity || !who) return false;
    if (entity.id && who.id) return entity.id === who.id;
    return namesOf(who).has(nameKey(entity.name));
}

// The insights for `character` in compiled `view` (Archivist's
// getCompiledMemory()), with the relationship between it and `persona`
// ({ id?, name, aliases? } - the user's persona): { summary, traits, habits,
// stressors, motivations, arc, feeling, relationship: { type, polarity,
// polarity_label, intensity, trend, text, view } | null, threads: [titles
// of its open or active threads], secrets: [secrets it knows],
// relationships: [{ other: { id, name }, type, polarity, polarity_label,
// intensity, trend, text, view }] - every relationship it is part of, its
// own view of the other where the story shows one ('theirs'), else the
// other's view of it ('about') }, or null when the view says nothing about it.
//
// The relationship is the character's own view of the persona when the
// memories show it (view 'theirs'), else the persona's view of the
// character ('yours') - often all a story has shown so far.
export function characterInsights(view, character, persona) {
    if (!view || !character) return null;
    const profile = (view.character_profiles ?? []).find((p) => isEntity({ id: p.entity_id, name: p.name }, character)) ?? null;
    const find = (from, to) => (view.relationships ?? []).find((r) => isEntity(r.from, from) && isEntity(r.to, to)) ?? null;
    const theirs = persona ? find(character, persona) : null;
    const yours = persona && !theirs ? find(persona, character) : null;
    const relationship = theirs ?? yours;
    const threads = (view.threads ?? [])
        .filter((t) => (t.status === 'open' || t.status === 'active') && (t.involved ?? []).some((e) => isEntity(e, character)))
        .map((t) => t.title);
    // A disproven secret is kept in Archivist's record, but is no secret.
    const secrets = (view.world?.secret ?? [])
        .filter((w) => w.status !== 'disproven' && (w.known_by ?? []).some((e) => isEntity(e, character)))
        .map((w) => w.name);
    // Every relationship it is part of: its own view of each other one, else
    // the other's view of it.
    const relationships = [];
    const seen = new Set();
    for (const r of (view.relationships ?? [])) {
        if (!isEntity(r.from, character) || isEntity(r.to, character)) continue;
        const key = r.to?.id || nameKey(r.to?.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        relationships.push(storyRelation(r, r.to, 'theirs'));
    }
    for (const r of (view.relationships ?? [])) {
        if (!isEntity(r.to, character) || isEntity(r.from, character)) continue;
        const key = r.from?.id || nameKey(r.from?.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        relationships.push(storyRelation(r, r.from, 'about'));
    }
    if (!profile && !relationship && threads.length === 0 && secrets.length === 0 && relationships.length === 0) return null;
    return {
        summary: profile?.summary ?? '',
        traits: profile?.traits ?? [],
        habits: profile?.habits ?? [],
        stressors: profile?.stressors ?? [],
        motivations: profile?.motivations ?? [],
        arc: profile?.arc ?? '',
        feeling: profile?.emotional_state ?? '',
        relationship: relationship ? {
            type: relationship.type,
            polarity: relationship.polarity,
            polarity_label: relationship.polarity_label,
            intensity: relationship.intensity,
            trend: relationship.trend ?? '',
            text: relationship.text ?? '',
            view: theirs ? 'theirs' : 'yours',
        } : null,
        threads,
        secrets,
        relationships,
    };
}

function storyRelation(r, other, view) {
    return {
        other: { id: other?.id ?? null, name: other?.name ?? '' },
        type: r.type ?? '', polarity: r.polarity, polarity_label: r.polarity_label ?? '',
        intensity: r.intensity ?? '', trend: r.trend ?? '', text: r.text ?? '', view,
    };
}

// ---- the relationships the user wrote, in Scenario Builder

export function scenarioBuilderApi() {
    try {
        return globalThis.window?.StateEngineScenarioBuilder ?? null;
    } catch {
        return null;
    }
}

// `characters` with each one's AUTHORED relationships (Scenario Builder's
// getRelationships, optional) attached as `authoredRelations`:
// [{ otherId, otherName, kind, note, direction }]. They take precedence
// over the story's for a pair (character-fields.js relationsOfObject).
// Unchanged without Scenario Builder. Never throws.
export async function withAuthoredRelations(characters) {
    const api = scenarioBuilderApi();
    if (typeof api?.getRelationships !== 'function' || characters.size === 0) return characters;
    const next = new Map();
    for (const [id, character] of characters) {
        try {
            const list = await api.getRelationships(id);
            next.set(id, Array.isArray(list) && list.length ? { ...character, authoredRelations: list } : character);
        } catch {
            next.set(id, character);
        }
    }
    return next;
}

// The user's persona as a relationship target: its character object when
// the chat has one by that name, else just the name.
function personaOf(characters) {
    let name = '';
    try {
        name = SillyTavern.getContext().name1 ?? '';
    } catch {
        name = '';
    }
    if (!name) return null;
    return [...characters.values()].find((c) => namesOf(c).has(nameKey(name))) ?? { id: null, name, aliases: [] };
}

// `characters` (id -> character) with each one's insights attached as
// `archivist`, for chat `chatId`. Unchanged without Archivist or a compiled
// view. Never throws.
export async function withArchivistInsights(chatId, characters) {
    const api = archivistApi();
    if (!chatId || !api?.getCompiledMemory || characters.size === 0) return characters;
    let view = null;
    try {
        view = await api.getCompiledMemory(chatId);
    } catch (err) {
        console.warn('[PrettyPanels] could not read Archivist\'s compiled memory', err);
        return characters;
    }
    if (!view) return characters;
    const persona = personaOf(characters);
    const next = new Map();
    for (const [id, character] of characters) {
        const insights = characterInsights(view, character, persona);
        next.set(id, insights ? { ...character, archivist: insights } : character);
    }
    return next;
}
