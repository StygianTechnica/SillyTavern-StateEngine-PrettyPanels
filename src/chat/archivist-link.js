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

const lower = (value) => String(value ?? '').trim().toLowerCase();

// The names something goes by: its name and aliases, lower case.
function namesOf(thing) {
    return new Set([thing?.name, ...(Array.isArray(thing?.aliases) ? thing.aliases : [])].map(lower).filter(Boolean));
}

// Whether a compiled entity ({ id | null, name }) is `who` (an object with
// id, name and aliases).
function isEntity(entity, who) {
    if (!entity || !who) return false;
    if (entity.id && who.id) return entity.id === who.id;
    return namesOf(who).has(lower(entity.name));
}

// The insights for `character` in compiled `view` (Archivist's
// getCompiledMemory()), with its relationship toward `persona` ({ id?, name,
// aliases? } - the user's persona): { traits, habits, stressors,
// motivations, arc, feeling, relationship: { type, polarity,
// polarity_label, intensity, trend, text } | null, threads: [titles of its
// open or active threads], secrets: [secrets it knows] }, or null when the
// view says nothing about it.
export function characterInsights(view, character, persona) {
    if (!view || !character) return null;
    const profile = (view.character_profiles ?? []).find((p) => isEntity({ id: p.entity_id, name: p.name }, character)) ?? null;
    const relationship = persona ? (view.relationships ?? []).find((r) => isEntity(r.from, character) && isEntity(r.to, persona)) ?? null : null;
    const threads = (view.threads ?? [])
        .filter((t) => (t.status === 'open' || t.status === 'active') && (t.involved ?? []).some((e) => isEntity(e, character)))
        .map((t) => t.title);
    const secrets = (view.world?.secret ?? []).filter((w) => (w.known_by ?? []).some((e) => isEntity(e, character))).map((w) => w.name);
    if (!profile && !relationship && threads.length === 0 && secrets.length === 0) return null;
    return {
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
        } : null,
        threads,
        secrets,
    };
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
    return [...characters.values()].find((c) => namesOf(c).has(lower(name))) ?? { id: null, name, aliases: [] };
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
