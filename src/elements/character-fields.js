// Character fields: what an element inside a CHARACTER TEMPLATE can bind to
// besides variables and roles (src/library/character-template-library.js).
// Each card a Character element draws is one character; an element bound to
// a character field shows that card's character's value.
//
// A character is a State Engine OBJECT of type character (State Engine API
// Reference, "Object API"): { name, aliases, image, description,
// introduction_snippet, ...the type's fields, present, confirmed,
// runtime: { present, values: { [field]: value }, images } }.
//
// A character-field binding is { char: field }, as a ref "char:<field>"
// (element-model.js CHAR_REF_PREFIX). Fields:
//   identity   name, aliases, image, introduction_snippet, description and
//              the character type's fields - personality, faction, role,
//              goals, relationships (the active variant's) - and present.
//              "biography" (templates made before objects) reads description.
//   runtime    thought, mood, intent (built in), and the setting's own
//              runtime fields as "custom.<name>" - all read from
//              runtime.values
//   icons      "icon.<name>" for every enum runtime field: the image its
//              current value has (runtime.images, already checked for
//              <img src>), drawn like any image field
//   archivist  "archivist.<name>": what the Archivist extension compiled
//              about the character (traits, habits, stressors,
//              motivations, arc, feeling), its relationship toward the
//              user's persona (type, polarity, intensity, trend), its open
//              story threads and the secrets it knows - read from the
//              character's `archivist` field (src/chat/archivist-link.js).
//              Offered only while Archivist is installed.
//   relations  "relations.<name>": the character's relationships - the ones
//              the user wrote in Scenario Builder first, then the story's
//              (Archivist) for the other pairs: a list of lines ("Niamh -
//              ally (friendly)"), the names, the friendly and hostile ones,
//              a count, and "relations.people" - the related characters as
//              objects, drawn as cards by a Character element on the card.
//              A card inside a card may use its own template one level
//              deep, never one already being drawn (character-tiles.js),
//              so a relationship list never recurses.
//
// Outside a template there is no character, so a character field has no
// value there.

import { objectDisplayName } from './text-format.js';

// [field, label, display type]
export const CHARACTER_IDENTITY_FIELDS = [
    ['name', 'Name', 'string'],
    ['image', 'Image', 'image'],
    ['aliases', 'Aliases', 'list'],
    ['present', 'In the scene', 'boolean'],
    ['role', 'Role', 'string'],
    ['description', 'Description', 'text'],
    ['personality', 'Personality', 'text'],
    ['goals', 'Goals', 'text'],
    ['relationships', 'Relationships', 'text'],
    ['introduction_snippet', 'Introduction', 'text'],
    // Yes/no facts about the object itself - for showing an element only
    // when there is something to show (Visible: while char:has_image is on).
    ['confirmed', 'Confirmed', 'boolean'],
    ['has_image', 'Has an image', 'boolean'],
    ['has_description', 'Has a description', 'boolean'],
];
// Those yes/no fields, which every object has: [field, label] - the flag
// suggestions offer them for each object variable and object role.
export const OBJECT_FLAG_FIELDS = CHARACTER_IDENTITY_FIELDS.filter(([field]) => ['confirmed', 'has_image', 'has_description'].includes(field)).map(([field, label]) => [field, label]);
// Fields saved under an older name -> the field that holds them now. A
// character's faction became the runtime factions (State Engine, 2026-10-13).
const RENAMED_FIELDS = { biography: 'description', faction: 'factions' };
const BUILT_IN_RUNTIME = ['thought', 'mood', 'intent'];
const CUSTOM_PREFIX = 'custom.';
const ICON_PREFIX = 'icon.';
const ARCHIVIST_PREFIX = 'archivist.';
const RELATIONS_PREFIX = 'relations.';
const FIELD_PATTERN = /^(?:[a-z_]+|(?:custom|icon|archivist|relations)\.[a-z][a-z0-9_]{0,39})$/;

// Relationship kinds that read as friendly or hostile when there is no
// polarity to go by (the ones the user wrote).
const FRIENDLY_KINDS = new Set(['ally', 'friend', 'family', 'sibling', 'spouse / partner', 'lover', 'mentor of', 'student of', 'protects', 'admires', 'loves', 'serves', 'leads', 'parent of', 'child of', 'member of']);
const HOSTILE_KINDS = new Set(['rival', 'enemy', 'hates', 'fears', 'distrusts', 'owes']);

// [name, label, display type, description]
const RELATION_FIELDS = [
    ['list', 'Relationships', 'list', 'One line per relationship: "Niamh - ally (friendly)"'],
    ['names', 'Related (names)', 'list', 'The names of everyone they have a relationship with'],
    ['friends', 'Friends and allies', 'list', 'Those they are on good terms with'],
    ['foes', 'Rivals and enemies', 'list', 'Those they are on bad terms with'],
    ['count', 'Number of relationships', 'number', 'How many relationships they have'],
    ['people', 'Related characters (cards)', 'list', 'The related characters as objects - a Character element on the card draws them as small built-in cards'],
];

// Pure: a character's relationships, the user's first (Scenario Builder's
// authoredRelations), then the story's (archivist.relationships) for the
// other pairs. -> [{ id, name, kind, feeling, polarity, text, source }]
export function relationsOfObject(character) {
    const out = [];
    const seen = new Set();
    const keyOf = (id, name) => id || String(name ?? '').trim().toLowerCase();
    for (const r of character?.authoredRelations ?? []) {
        const key = keyOf(r.otherId, r.otherName);
        if (!key || seen.has(key) || !(r.otherName || r.otherId)) continue;
        seen.add(key);
        const kind = String(r.kind ?? '').trim();
        out.push({ id: r.otherId ?? null, name: r.otherName || named(r.otherId), kind, feeling: '', polarity: FRIENDLY_KINDS.has(kind) ? 1 : (HOSTILE_KINDS.has(kind) ? -1 : 0), text: r.note ?? '', source: 'yours' });
    }
    for (const r of character?.archivist?.relationships ?? []) {
        const key = keyOf(r.other?.id, r.other?.name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push({ id: r.other?.id ?? null, name: r.other?.name ?? '', kind: String(r.type ?? '').trim(), feeling: r.polarity_label ?? '', polarity: Number(r.polarity) || 0, text: r.text ?? '', source: 'story' });
    }
    return out;
}

function relationValue(character, name) {
    const list = relationsOfObject(character);
    const line = (r) => `${r.name}${r.kind ? ` - ${r.kind}` : ''}${r.feeling ? ` (${r.feeling})` : ''}`;
    const some = (xs) => (xs.length ? xs : undefined);
    switch (name) {
        case 'list': return some(list.map(line));
        case 'names': return some(list.map((r) => r.name));
        case 'friends': return some(list.filter((r) => r.polarity > 0).map(line));
        case 'foes': return some(list.filter((r) => r.polarity < 0).map(line));
        case 'count': return list.length;
        case 'people': return some(list.filter((r) => r.id && OBJECT_ID.test(r.id)).map((r) => r.id));
        default: return undefined;
    }
}

// [field, label, display type, how to read it from the insights, description]
const ARCHIVIST_FIELDS = [
    ['summary', 'Who they are now', 'text', (a) => a.summary, 'What is known about them now, judged by what they have done so far'],
    ['traits', 'Traits', 'list', (a) => a.traits, 'Personality traits Archivist inferred from the memories'],
    ['habits', 'Habits', 'list', (a) => a.habits, 'Habits and routines'],
    ['stressors', 'Stressors', 'list', (a) => a.stressors, 'What puts them under strain'],
    ['motivations', 'Motivations', 'list', (a) => a.motivations, 'What drives them'],
    ['arc', 'Arc', 'text', (a) => a.arc, 'How they have changed over the story'],
    ['feeling', 'Feeling lately', 'string', (a) => a.feeling, 'How they have been feeling lately'],
    // Between the character and your persona: their view of you when the
    // story has shown it, else yours of them (relationship_view says which).
    ['relationship_type', 'Relationship with you', 'string', (a) => a.relationship?.type, 'What they are to your persona (or you to them) - friend, mentor, rival, ally...'],
    ['relationship_polarity', 'Feeling between you', 'string', (a) => a.relationship?.polarity_label, 'hostile, antagonistic, wary, neutral, friendly, close or devoted'],
    ['relationship_score', 'Polarity between you (-3..3)', 'number', (a) => a.relationship?.polarity, '-3 (hostile) to 3 (devoted)'],
    ['relationship_intensity', 'Relationship intensity', 'string', (a) => a.relationship?.intensity, 'low, medium or high'],
    ['relationship_trend', 'Relationship trend', 'string', (a) => a.relationship?.trend, 'warming, cooling, stable or volatile'],
    ['relationship', 'Relationship (sentence)', 'text', (a) => a.relationship?.text, 'One sentence on the relationship'],
    ['relationship_view', 'Whose view', 'string', (a) => (a.relationship ? (a.relationship.view === 'theirs' ? 'their view of you' : 'your view of them') : undefined), 'Whether the relationship fields show their view of you or yours of them'],
    ['threads', 'Open story threads', 'list', (a) => a.threads, 'Plot hooks, threads and quests they are part of, still open'],
    ['secrets', 'Secrets they know', 'list', (a) => a.secrets, 'Secrets Archivist knows they are in on'],
];

export function isCharacterField(field) {
    return typeof field === 'string' && FIELD_PATTERN.test(field);
}

function runtimeType(type) {
    if (type === 'array') return 'list';
    return type === 'number' ? 'number' : 'string';
}

function labelFor(name) {
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
}

// The fields a template can use, for the Character palette: identity, then
// the runtime fields `runtimeFields` (State Engine's, for the chat's
// setting), then - with `archivist` - Archivist's - [{ field, label, type,
// group }].
export function characterFieldList(runtimeFields = [], { archivist = false } = {}) {
    const identity = CHARACTER_IDENTITY_FIELDS.map(([field, label, type]) => ({ field, label, type, group: 'Character' }));
    const fields = runtimeFields.length ? runtimeFields : BUILT_IN_RUNTIME.map((name) => ({ name, type: 'string', builtIn: true }));
    const runtime = fields.map((f) => ({
        field: f.builtIn ? f.name : `${CUSTOM_PREFIX}${f.name}`,
        label: labelFor(f.name),
        type: runtimeType(f.type),
        group: 'Runtime state',
        description: f.description ?? '',
    }));
    // An image in place of the word, from the enum's images.
    const icons = fields.filter((f) => f.type === 'enum').map((f) => ({
        field: `${ICON_PREFIX}${f.name}`,
        label: `${labelFor(f.name)} (icon)`,
        type: 'image',
        group: 'Runtime state',
        description: `The image set for the current ${f.name.replace(/_/g, ' ')} (Object Manager > Runtime fields > Images).`,
    }));
    const memory = archivist ? ARCHIVIST_FIELDS.map(([name, label, type, , description]) => ({
        field: `${ARCHIVIST_PREFIX}${name}`, label, type, group: 'Archivist (memory)', description,
    })) : [];
    const relations = RELATION_FIELDS.map(([name, label, type, description]) => ({ field: `${RELATIONS_PREFIX}${name}`, label, type, group: 'Relationships', description }));
    return [...identity, ...runtime, ...icons, ...relations, ...memory];
}

// A display definition for a character field (the shape a variable's has):
// labels and formats an element bound to it.
export function characterFieldDef(field) {
    if (RENAMED_FIELDS[field]) return { ...characterFieldDef(RENAMED_FIELDS[field]), name: `char:${field}`, characterField: field };
    if (field.startsWith(ICON_PREFIX)) {
        return { name: `char:${field}`, type: 'image', label: `${labelFor(field.slice(ICON_PREFIX.length))} (icon)`, characterField: field };
    }
    if (field.startsWith(RELATIONS_PREFIX)) {
        const name = field.slice(RELATIONS_PREFIX.length);
        const known = RELATION_FIELDS.find(([n]) => n === name);
        // The related characters are objects: a Character element draws them.
        if (name === 'people') return { name: `char:${field}`, type: 'array', itemType: 'object', itemObjectType: 'character', label: known[1], characterField: field };
        return { name: `char:${field}`, type: known?.[2] ?? 'list', label: known?.[1] ?? labelFor(name), characterField: field };
    }
    if (field.startsWith(ARCHIVIST_PREFIX)) {
        const known = ARCHIVIST_FIELDS.find(([name]) => name === field.slice(ARCHIVIST_PREFIX.length));
        const def = { name: `char:${field}`, type: known?.[2] ?? 'string', label: known?.[1] ?? labelFor(field.slice(ARCHIVIST_PREFIX.length)), characterField: field };
        // The polarity score runs -3..3: a bar or gauge measures it so by default.
        return field === `${ARCHIVIST_PREFIX}relationship_score` ? { ...def, min: -3, max: 3 } : def;
    }
    const known = CHARACTER_IDENTITY_FIELDS.find(([f]) => f === field);
    const label = known ? known[1] : (field.startsWith(CUSTOM_PREFIX) ? field.slice(CUSTOM_PREFIX.length) : field).replace(/_/g, ' ');
    return { name: `char:${field}`, type: known ? known[2] : 'string', label: label.charAt(0).toUpperCase() + label.slice(1), characterField: field };
}

// The value a character shows for `field` (undefined: none). Runtime
// fields - built in or the setting's own - all live in runtime.values.
export function characterFieldValue(character, field) {
    if (!character) return undefined;
    field = RENAMED_FIELDS[field] ?? field;
    if (BUILT_IN_RUNTIME.includes(field)) return character.runtime?.values?.[field] ?? undefined;
    if (field.startsWith(CUSTOM_PREFIX)) return shownRuntime(character.runtime?.values?.[field.slice(CUSTOM_PREFIX.length)]);
    if (field.startsWith(ICON_PREFIX)) return character.runtime?.images?.[field.slice(ICON_PREFIX.length)] ?? undefined;
    if (field.startsWith(RELATIONS_PREFIX)) return relationValue(character, field.slice(RELATIONS_PREFIX.length));
    if (field.startsWith(ARCHIVIST_PREFIX)) {
        const read = ARCHIVIST_FIELDS.find(([name]) => name === field.slice(ARCHIVIST_PREFIX.length))?.[3];
        const value = read && character.archivist ? read(character.archivist) : undefined;
        if (Array.isArray(value)) return value.length ? value : undefined;
        return value === null || value === undefined || value === '' ? undefined : value;
    }
    if (field === 'present') return character.runtime?.present ?? character.present ?? false;
    // Any other runtime field the setting gives its type (a character's or a
    // location's factions) - in a chat, or its starting value outside one.
    if (character.runtime?.values && field in character.runtime.values) return shownRuntime(character.runtime.values[field]);
    if (!character.runtime && character.startValues && field in character.startValues) return shownRuntime(character.startValues[field]);
    if (field === 'confirmed') return character.confirmed === true;
    if (field === 'has_image') return typeof character.image === 'string' && character.image.trim() !== '';
    if (field === 'has_description') return typeof character.description === 'string' && character.description.trim() !== '';
    const value = character[RENAMED_FIELDS[field] ?? field];
    if (Array.isArray(value)) return value.length ? value.map(named) : undefined;
    return value === null || value === undefined || value === '' ? undefined : named(value);
}

// One field of the object(s) a variable holds - `objects` an object or a
// list of them (null for none): a single object's value; for a list, true
// when any of them has the field on, else the first value there is. What a
// flag "<variable>#<field>" reads (src/chat/variable-service.js).
export function objectsFieldValue(objects, field) {
    const list = (Array.isArray(objects) ? objects : [objects]).filter(Boolean);
    const values = list.map((o) => characterFieldValue(o, field));
    if (values.some((v) => v === true)) return true;
    return values.find((v) => v !== undefined) ?? (list.length && values.every((v) => v === false) ? false : undefined);
}

// A runtime value as a card shows it: objects by name; none as undefined.
function shownRuntime(value) {
    if (Array.isArray(value)) return value.length ? value.map(named) : undefined;
    return value === null || value === undefined || value === '' ? undefined : named(value);
}

// A field holding other objects (a character's faction: faction objects)
// shows their names.
const OBJECT_ID = /^[a-z]{3}_[\w-]+$/;
function named(value) {
    return typeof value === 'string' && OBJECT_ID.test(value) ? objectDisplayName(value) ?? value : value;
}

// State Engine's id prefixes, by object type (its registry's idPrefix).
const TYPE_BY_PREFIX = { chr: 'character', loc: 'location', fac: 'faction', itm: 'item', crt: 'creature', lor: 'lore', qst: 'quest', scn: 'scene', evt: 'event' };

// A field's value as stored - object ids kept as ids (characterFieldValue
// shows them by name). undefined for the computed fields.
function storedValue(character, field) {
    field = RENAMED_FIELDS[field] ?? field;
    if (field.startsWith(CUSTOM_PREFIX)) return character.runtime?.values?.[field.slice(CUSTOM_PREFIX.length)];
    if ([ICON_PREFIX, ARCHIVIST_PREFIX, RELATIONS_PREFIX].some((p) => field.startsWith(p)) || BUILT_IN_RUNTIME.includes(field)) return undefined;
    if (character.runtime?.values && field in character.runtime.values) return character.runtime.values[field];
    if (!character.runtime && character.startValues && field in character.startValues) return character.startValues[field];
    return character[field];
}

// When a field holds other objects (a character's factions, an item's
// owner): { ids, list, type } - the ids as stored, whether it is a list,
// and the objects' type from their id prefix. null otherwise.
export function objectRefsOf(character, field) {
    if (!character) return null;
    const value = storedValue(character, field);
    const list = Array.isArray(value);
    const ids = (list ? value : [value]).filter((v) => typeof v === 'string' && v);
    if (!ids.length || !ids.every((v) => OBJECT_ID.test(v))) return null;
    const types = [...new Set(ids.map((v) => TYPE_BY_PREFIX[v.slice(0, 3)]).filter(Boolean))];
    return { ids, list, type: types.length === 1 ? types[0] : null };
}

// The variable service's { value, def } shape for a character field, or
// undefined when the character has no value for it. A field holding other
// objects keeps their ids, with a definition saying what they are - a text
// element shows them by name (text-format.js), a Character element draws
// them as cards.
export function characterEntry(character, field) {
    // An icon with no image for the current value (none set for it, no value
    // yet) shows the value as text rather than nothing.
    if (field.startsWith(ICON_PREFIX) && character) {
        const src = characterFieldValue(character, field);
        if (src !== undefined) return { value: src, def: characterFieldDef(field) };
        const name = field.slice(ICON_PREFIX.length);
        const word = characterFieldValue(character, BUILT_IN_RUNTIME.includes(name) ? name : `${CUSTOM_PREFIX}${name}`);
        return word === undefined ? undefined : { value: word, def: { ...characterFieldDef(field), type: 'string' } };
    }
    const refs = field.startsWith(RELATIONS_PREFIX) ? null : objectRefsOf(character, field);
    if (refs?.type) {
        const def = characterFieldDef(field);
        return refs.list
            ? { value: refs.ids, def: { ...def, type: 'array', itemType: 'object', itemObjectType: refs.type } }
            : { value: refs.ids[0], def: { ...def, type: 'object', objectType: refs.type } };
    }
    const value = characterFieldValue(character, field);
    return value === undefined ? undefined : { value, def: characterFieldDef(field) };
}

// The character the template editor previews with when the chat has none:
// every field filled, so the template's layout is visible.
export const SAMPLE_CHARACTER = Object.freeze({
    id: 'pp-sample-character',
    name: 'Sample Character',
    aliases: ['the sample'],
    image: '',
    introduction_snippet: 'A sample character stepped into the light.',
    description: 'A stand-in used to preview character templates.',
    personality: 'Patient, curious.',
    faction: 'Preview Guild',
    role: 'Stand-in',
    goals: 'Show off every field.',
    relationships: 'Friends with every template.',
    type: 'character',
    confirmed: true,
    present: true,
    runtime: { present: true, values: { thought: 'Is this layout readable?', mood: 'Curious', intent: 'Show every field' }, images: {} },
    archivist: {
        summary: 'A stand-in who has shown up for every template so far, patient with every margin.',
        traits: ['patient', 'curious'], habits: ['checks every margin'], stressors: ['clipped text'], motivations: ['a tidy layout'],
        arc: 'From a blank box to a finished card.', feeling: 'hopeful',
        relationship: { type: 'friend', polarity: 2, polarity_label: 'close', intensity: 'medium', trend: 'warming', text: 'Trusts you with every template.', view: 'theirs' },
        threads: ['The missing font'], secrets: ['Where the grid snaps'],
        relationships: [
            { other: { id: null, name: 'Sample Rival' }, type: 'rival', polarity: -1, polarity_label: 'wary', intensity: 'medium', trend: 'stable', text: 'Competes for every margin.', view: 'theirs' },
        ],
    },
    authoredRelations: [{ otherId: null, otherName: 'Sample Friend', kind: 'ally', note: 'Checks the layouts together.', direction: 'out' }],
});

// ---------------------------------------------------------------- any object type
//
// A card template has an OBJECT TYPE (character-template-library.js): ''
// for any object, or one type ('character', 'location', 'item'...). Its
// palette offers what that type has: every object's own fields, then the
// type's baseline fields (State Engine getObjectFields, scope 'global'),
// then its runtime fields - read the same way as a character's ("custom.
// <name>" from runtime.values, anything else from the object itself).

// Fields every object has: [field, label, display type].
export const COMMON_OBJECT_FIELDS = [
    ['name', 'Name', 'string'],
    ['image', 'Image', 'image'],
    ['aliases', 'Aliases', 'list'],
    ['description', 'Description', 'text'],
    ['introduction_snippet', 'Introduction', 'text'],
    ['confirmed', 'Confirmed', 'boolean'],
    ['has_image', 'Has an image', 'boolean'],
    ['has_description', 'Has a description', 'boolean'],
];
const COMMON_NAMES = new Set([...COMMON_OBJECT_FIELDS.map(([f]) => f), 'present', 'id', 'type', 'related_entity_ids', 'related_memory_ids']);

function displayType(def) {
    if (def.type === 'array') return 'list';
    if (def.type === 'number' || def.type === 'boolean') return def.type;
    if (def.type === 'longtext' || def.kind === 'longtext') return 'text';
    return 'string';
}

// The fields a template of `objectType` can use, for its palette.
// type: { id, label, hasPresence } (State Engine listObjectTypes) or null
// for any object; fields: the type's field definitions (getObjectFields);
// runtimeFields: its runtime fields (getObjectRuntimeFields).
// -> [{ field, label, type, group, description? }]
export function objectFieldList(type, { fields = [], runtimeFields = [], archivist = false } = {}) {
    if (type?.id === CHARACTER_TYPE) {
        // The character list, plus any baseline field the setting added.
        const list = characterFieldList(runtimeFields, { archivist });
        const known = new Set(list.map((f) => f.field));
        const extra = baselineOf(fields).filter((d) => !known.has(d.name)).map((d) => ({ field: d.name, label: d.label || labelFor(d.name), type: displayType(d), group: 'Character', description: d.description ?? '' }));
        const at = list.findIndex((f) => f.group !== 'Character');
        return at < 0 ? [...list, ...extra] : [...list.slice(0, at), ...extra, ...list.slice(at)];
    }
    const group = type ? type.label : 'Any object';
    const common = COMMON_OBJECT_FIELDS.map(([field, label, t]) => ({ field, label, type: t, group }));
    if (!type || type.hasPresence) common.splice(3, 0, { field: 'present', label: 'In the scene', type: 'boolean', group, description: type ? '' : 'Only objects with presence (characters, creatures...) are ever in the scene.' });
    if (!type) return common;
    const baseline = baselineOf(fields).map((d) => ({ field: d.name, label: d.label || labelFor(d.name), type: displayType(d), group, description: d.description ?? '' }));
    const runtime = runtimeFields.map((f) => ({
        field: `${CUSTOM_PREFIX}${f.name}`, label: labelFor(f.name), type: runtimeType(f.type), group: 'Runtime state', description: f.description ?? '',
    }));
    const icons = runtimeFields.filter((f) => f.type === 'enum').map((f) => ({
        field: `${ICON_PREFIX}${f.name}`, label: `${labelFor(f.name)} (icon)`, type: 'image', group: 'Runtime state',
        description: `The image set for the current ${f.name.replace(/_/g, ' ')} (Object Manager > Runtime fields > Images).`,
    }));
    return [...common, ...baseline, ...runtime, ...icons];
}

const CHARACTER_TYPE = 'character';
const baselineOf = (fields) => (fields ?? []).filter((d) => d?.scope === 'global' && typeof d.name === 'string' && !COMMON_NAMES.has(d.name) && isCharacterField(d.name));

// The object the template editor previews with when the chat has none of
// the template's type: every offered field filled.
export function sampleObject(type, list = []) {
    if (!type || type.id === CHARACTER_TYPE) {
        return type ? SAMPLE_CHARACTER : { ...SAMPLE_CHARACTER, id: 'pp-sample-object', name: 'Sample Object', description: 'A stand-in used to preview card templates.', type: '' };
    }
    const label = type.label || labelFor(type.id);
    const out = {
        id: `pp-sample-${type.id}`, type: type.id, name: `Sample ${label}`, aliases: ['the sample'], image: '',
        description: `A stand-in ${label.toLowerCase()} used to preview card templates.`, introduction_snippet: `A sample ${label.toLowerCase()} comes into view.`,
        confirmed: true, present: true, runtime: { present: true, values: {}, images: {} },
    };
    for (const f of list) {
        if (COMMON_NAMES.has(f.field) || f.field.startsWith(ICON_PREFIX)) continue;
        const value = f.type === 'list' ? [`Sample ${f.label.toLowerCase()}`] : f.type === 'number' ? 3 : f.type === 'boolean' ? true : `Sample ${f.label.toLowerCase()}`;
        if (f.field.startsWith(CUSTOM_PREFIX)) out.runtime.values[f.field.slice(CUSTOM_PREFIX.length)] = value;
        else out[f.field] = value;
    }
    return out;
}
