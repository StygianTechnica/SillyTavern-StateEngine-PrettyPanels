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
//
// Outside a template there is no character, so a character field has no
// value there.

// [field, label, display type]
export const CHARACTER_IDENTITY_FIELDS = [
    ['name', 'Name', 'string'],
    ['image', 'Image', 'image'],
    ['aliases', 'Aliases', 'list'],
    ['present', 'In the scene', 'boolean'],
    ['faction', 'Faction', 'string'],
    ['role', 'Role', 'string'],
    ['description', 'Description', 'text'],
    ['personality', 'Personality', 'text'],
    ['goals', 'Goals', 'text'],
    ['relationships', 'Relationships', 'text'],
    ['introduction_snippet', 'Introduction', 'text'],
];
// Fields saved under an older name -> the field that holds them now.
const RENAMED_FIELDS = { biography: 'description' };
const BUILT_IN_RUNTIME = ['thought', 'mood', 'intent'];
const CUSTOM_PREFIX = 'custom.';
const ICON_PREFIX = 'icon.';
const FIELD_PATTERN = /^(?:[a-z_]+|(?:custom|icon)\.[a-z][a-z0-9_]{0,39})$/;

export function isCharacterField(field) {
    return typeof field === 'string' && FIELD_PATTERN.test(field);
}

function runtimeType(type) {
    return type === 'number' ? 'number' : 'string';
}

function labelFor(name) {
    return name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');
}

// The fields a template can use, for the Character palette: identity, then
// the runtime fields `runtimeFields` (State Engine's, for the chat's
// setting) - [{ field, label, type, group }].
export function characterFieldList(runtimeFields = []) {
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
        description: `The image set for the current ${f.name.replace(/_/g, ' ')} (Character Manager > Runtime fields > Images).`,
    }));
    return [...identity, ...runtime, ...icons];
}

// A display definition for a character field (the shape a variable's has):
// labels and formats an element bound to it.
export function characterFieldDef(field) {
    if (RENAMED_FIELDS[field]) return { ...characterFieldDef(RENAMED_FIELDS[field]), name: `char:${field}`, characterField: field };
    if (field.startsWith(ICON_PREFIX)) {
        return { name: `char:${field}`, type: 'image', label: `${labelFor(field.slice(ICON_PREFIX.length))} (icon)`, characterField: field };
    }
    const known = CHARACTER_IDENTITY_FIELDS.find(([f]) => f === field);
    const label = known ? known[1] : (field.startsWith(CUSTOM_PREFIX) ? field.slice(CUSTOM_PREFIX.length) : field).replace(/_/g, ' ');
    return { name: `char:${field}`, type: known ? known[2] : 'string', label: label.charAt(0).toUpperCase() + label.slice(1), characterField: field };
}

// The value a character shows for `field` (undefined: none). Runtime
// fields - built in or the setting's own - all live in runtime.values.
export function characterFieldValue(character, field) {
    if (!character) return undefined;
    if (BUILT_IN_RUNTIME.includes(field)) return character.runtime?.values?.[field] ?? undefined;
    if (field.startsWith(CUSTOM_PREFIX)) return character.runtime?.values?.[field.slice(CUSTOM_PREFIX.length)] ?? undefined;
    if (field.startsWith(ICON_PREFIX)) return character.runtime?.images?.[field.slice(ICON_PREFIX.length)] ?? undefined;
    if (field === 'present') return character.runtime?.present ?? character.present ?? false;
    const value = character[RENAMED_FIELDS[field] ?? field];
    if (Array.isArray(value)) return value.length ? value : undefined;
    return value === null || value === undefined || value === '' ? undefined : value;
}

// The variable service's { value, def } shape for a character field, or
// undefined when the character has no value for it.
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
});
