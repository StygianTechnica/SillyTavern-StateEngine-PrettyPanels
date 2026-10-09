// Element records: the widgets that live INSIDE a panel instance
// (panel.widgets[]). Plain data only - src/elements/element-view.js
// renders them. Every element except a shape or free text is bound to
// one variable;
// its `type` picks how it is drawn (see ELEMENT_TYPES):
//
//   {
//     id, type,                'text' | 'bar-horizontal' | 'bar-vertical' |
//                              'gauge-circle' | 'gauge-semicircle' |
//                              'composite-bar' | 'shape' | 'free-text' |
//                              'analogClock' | 'character'
//     x, y, width, height,     position/size inside the panel body, px
//     binding: { name }        a fully-qualified State Engine variable name,
//            | { role }        or a State Engine role ("scene.title") - shows
//                              whichever variable the chat assigned to it
//            | { char }        or, inside a character template only, a
//                              character field ("name", "mood") - the card's
//                              character's value (character-fields.js)
//            | null            (always null for a shape or free text)
//     content,                 free text only: the text it shows
//     zIndex,                  stacking order inside the panel, any integer:
//                              elements draw in ascending zIndex, ties in
//                              stored order (DEFAULT_Z_INDEX per type)
//     opacity, fit,            image variable elements (a text element whose
//     clipShape, borderRadius, value is an image): see IMAGE_* below;
//     borderWidth, borderColor the border only shows with a clip shape
//     showLabel, labelOverride,
//     format,                  text formatting - { textCase, themeStyle, value }
//                              (src/elements/text-format.js, one pipeline for
//                              free text, variable and role values, gauges)
//     style,                   Element Styling - text and free text
//                              (src/elements/element-style.js)
//     widget,                  Widget Properties - bars/gauges only
//                              (src/elements/widgets.js)
//     shape,                   Shape Properties - shapes only
//                              (src/elements/shapes.js)
//     clock,                   Clock Properties - analog clocks only
//                              (src/elements/clock.js); an analog clock
//                              binds a datetime variable and also uses
//                              opacity
//     character,               Character element only: { templateId, tiling,
//                              gap } - a character variable (or a list of
//                              them) drawn as cards of a character template
//                              (src/elements/character-tiles.js); no
//                              templateId draws the built-in card
//   }
//
// With the default zIndex values shapes sit behind images, images behind
// text and text behind gauges, so a coloured rectangle can sit under text
// to keep it readable - and any element can be moved up or down.
//
// Elements saved before types existed have type 'variable'; they load as
// 'text'. Any other unknown type is kept untouched (and not drawn).
//
// Bindings live in the layout's panel instances (a chat chooses a layout
// for what it shows) and are stripped from panel templates
// (src/storage/design.js stripBindings()) - but kept in character
// templates, which are drawn inside a layout's Character elements.

import { NAMESPACE } from '../constants.js';
import { normalizeFormat } from './text-format.js';

// Element Styling keys that are not stored: textTransform (case is
// element.format.textCase now) and the Theme Style layer's computed CSS.
const UNSTORED_STYLE_KEYS = ['textTransform', 'fontFamilyCss', 'textColorCss'];

function elementStyle(style) {
    const out = { ...style };
    for (const key of UNSTORED_STYLE_KEYS) delete out[key];
    return out;
}

export const ELEMENT_TYPE_TEXT = 'text';
export const ELEMENT_TYPE_SHAPE = 'shape';
export const ELEMENT_TYPE_FREE_TEXT = 'free-text';
export const ELEMENT_TYPE_CHARACTER = 'character';
// How a Character element lays out a list of cards.
export const CHARACTER_TILINGS = [['grid', 'Grid'], ['row', 'Row'], ['column', 'Column']];
export const CHARACTER_GAP_LIMITS = [0, 64];
// Types that show no variable.
const UNBOUND_TYPES = new Set([ELEMENT_TYPE_SHAPE, ELEMENT_TYPE_FREE_TEXT]);
export const MAX_FREE_TEXT_LENGTH = 2000;
const LEGACY_TYPE_VARIABLE = 'variable';

export const ELEMENT_TYPES = [
    ['text', 'Text'],
    ['bar-horizontal', 'Horizontal Bar'],
    ['bar-vertical', 'Vertical Bar'],
    ['gauge-circle', 'Circular Gauge'],
    ['gauge-semicircle', 'Semi-Circular Gauge'],
    ['composite-bar', 'Composite Bar'],
    ['analogClock', 'Analog Clock'],
    ['character', 'Character Cards'],
    ['free-text', 'Free Text'],
    ['shape', 'Shape'],
];
const TYPE_IDS = new Set(ELEMENT_TYPES.map(([id]) => id));

// A new element's size, per type (text keeps DEFAULT_ELEMENT_*).
export const DEFAULT_TYPE_SIZES = {
    'text': [136, 32],
    'bar-horizontal': [136, 16],
    'bar-vertical': [24, 96],
    'gauge-circle': [72, 72],
    'gauge-semicircle': [96, 56],
    'composite-bar': [160, 24],
    'shape': [120, 64],
    'free-text': [160, 32],
    'analogClock': [120, 120],
    'character': [240, 160],
};

// A new element's zIndex, per type. Image variable elements (text bound
// to an image variable) get IMAGE_Z_INDEX; TITLE_Z_INDEX is reserved for
// a future title element.
export const DEFAULT_Z_INDEX = {
    'shape': 0,
    'text': 2,
    'free-text': 2,
    'bar-horizontal': 3,
    'bar-vertical': 3,
    'gauge-circle': 3,
    'gauge-semicircle': 3,
    'composite-bar': 3,
    'analogClock': 3,
    'character': 2,
};
export const IMAGE_Z_INDEX = 1;
export const TITLE_Z_INDEX = 4;

// Image variable elements: how the image is drawn.
export const IMAGE_FITS = [['cover', 'Cover (fill, crop)'], ['contain', 'Contain (whole image)']];
export const IMAGE_CLIP_SHAPES = [['none', 'None'], ['rectangle', 'Rectangle'], ['ellipse', 'Ellipse']];
export const IMAGE_RADIUS_LIMITS = [0, 500];
// Border drawn along a clipped image's edge (rectangle or ellipse), px.
export const IMAGE_BORDER_WIDTH_LIMITS = [0, 50];
// Set on an element when it is first bound to an image variable.
export const IMAGE_DEFAULTS = { opacity: 1, fit: 'cover', clipShape: 'none', borderRadius: 0 };
const IMAGE_VARIABLE_TYPES = new Set(['image', 'imageList', 'imageMap']);

export function isImageDefinition(def) {
    return IMAGE_VARIABLE_TYPES.has(def?.type);
}

// A character variable, or a list of characters (State Engine spec 1.42).
export function isCharacterDefinition(def) {
    return def?.type === 'character' || (def?.type === 'array' && def?.itemType === 'character');
}

// zIndex for a new element of `type` bound to a variable defined as `def`.
export function defaultZIndex(type, def = null) {
    if (type === ELEMENT_TYPE_TEXT && isImageDefinition(def)) return IMAGE_Z_INDEX;
    return DEFAULT_Z_INDEX[type] ?? 2;
}

// True for any element this version draws (every bound element type).
export function isVariableElement(widget) {
    return !!widget && TYPE_IDS.has(widget.type);
}

export function isShapeElement(widget) {
    return widget?.type === ELEMENT_TYPE_SHAPE;
}

export function isUnboundType(type) {
    return UNBOUND_TYPES.has(type);
}
export const DEFAULT_ELEMENT_WIDTH = 136;
export const DEFAULT_ELEMENT_HEIGHT = 32;
export const MIN_ELEMENT_WIDTH = 24;
export const MIN_ELEMENT_HEIGHT = 16;

// A binding as one string - a variable's name, or `role:<role id>` for a
// role (a variable name can never contain ':'). The pickers, the Binding
// field and drag-and-drop all pass these.
export const ROLE_REF_PREFIX = 'role:';
// State Engine's role rules: a public name is lowercase words separated by
// dots; an id is "<namespace>__<public name>", the same delimiter as a
// variable name ("prettyPanels__scene.title").
export const ROLE_PUBLIC_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const ROLE_ID = /^([A-Za-z][A-Za-z0-9]*)__([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*)$/;

// "prettyPanels__scene.title" -> { namespace, publicName }, or null.
export function parseRoleId(id) {
    const match = typeof id === 'string' ? ROLE_ID.exec(id) : null;
    return match ? { namespace: match[1], publicName: match[2] } : null;
}

// The id of this extension's role `publicName` (a layout role).
export function layoutRoleId(publicName) {
    return `${NAMESPACE}__${publicName}`;
}

// What lists show for a role: its public name. The namespace (the id) is
// shown on hover and in advanced views only.
export function rolePublicName(id) {
    return parseRoleId(id)?.publicName ?? id;
}

// A character field ref ("char:name") - character templates only.
export const CHAR_REF_PREFIX = 'char:';
// "icon.<name>": the image an enum runtime field's value has (character-fields.js).
const CHAR_FIELD = /^(?:[a-z_]+|(?:custom|icon)\.[a-z][a-z0-9_]{0,39})$/;

export function isCharRef(ref) {
    return typeof ref === 'string' && ref.startsWith(CHAR_REF_PREFIX);
}

export function charFieldOfRef(ref) {
    return isCharRef(ref) ? ref.slice(CHAR_REF_PREFIX.length) : null;
}

export function isRoleRef(ref) {
    return typeof ref === 'string' && ref.startsWith(ROLE_REF_PREFIX);
}

// "role:scene.title" -> "scene.title"; a variable ref -> null.
export function roleOfRef(ref) {
    return isRoleRef(ref) ? ref.slice(ROLE_REF_PREFIX.length) : null;
}

export function roleRef(role) {
    return `${ROLE_REF_PREFIX}${role}`;
}

// { name } -> name, { role } -> "role:<role>", { char } -> "char:<field>",
// anything else -> null.
export function bindingRef(binding) {
    if (binding?.role) return roleRef(binding.role);
    if (binding?.char) return `${CHAR_REF_PREFIX}${binding.char}`;
    return binding?.name || null;
}

// The binding a ref stands for (null for an empty or invalid one).
export function bindingFromRef(ref) {
    if (isCharRef(ref)) return normalizeBinding({ char: charFieldOfRef(ref) });
    return normalizeBinding(isRoleRef(ref) ? { role: roleOfRef(ref) } : { name: ref });
}

// The role type an element needs of the variable behind its role: bars and
// gauges show a number, an analog clock a datetime; text shows anything.
export function roleTypeForElement(type) {
    if (type === 'analogClock') return 'date';
    if (type === ELEMENT_TYPE_TEXT || type === ELEMENT_TYPE_CHARACTER) return 'any';
    return 'number';
}

function finite(value, fallback) {
    return Number.isFinite(value) ? Math.round(value) : fallback;
}

function text(value) {
    return typeof value === 'string' ? value : '';
}

function newElementId() {
    return `ppe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// { name } or { role: id }; a name written as a role ref becomes a role. A
// bare public name (a role binding from before role namespaces) becomes this
// extension's layout role of that name - src/storage/store.js adds it to the
// layout's roles. Anything else is no binding at all.
function normalizeBinding(binding) {
    const name = typeof binding?.name === 'string' ? binding.name.trim() : '';
    if (isRoleRef(name)) return normalizeBinding({ role: roleOfRef(name) });
    if (isCharRef(name)) return normalizeBinding({ char: charFieldOfRef(name) });
    const char = typeof binding?.char === 'string' ? binding.char.trim() : '';
    if (char) return CHAR_FIELD.test(char) ? { char } : null;
    if (name) return { name };
    const role = typeof binding?.role === 'string' ? binding.role.trim() : '';
    if (parseRoleId(role)) return { role };
    return ROLE_PUBLIC_NAME.test(role) ? { role: layoutRoleId(role) } : null;
}

// The free-text Role tag elements had before roles were State Engine's
// ("health", "Mood"): it becomes a layout-role binding when the element
// shows no variable, lowercased - otherwise it is dropped.
function legacyRoleBinding(tag) {
    const role = typeof tag === 'string' ? tag.trim().toLowerCase().replace(/\s+/g, '_') : '';
    return role ? normalizeBinding({ role }) : null;
}

// The image-styling fields an element has, validated (absent ones stay
// absent - they are only added when an element is bound to an image).
function normalizeImageFields(element) {
    const out = {};
    if (element.opacity !== undefined) out.opacity = Number.isFinite(element.opacity) ? Math.min(1, Math.max(0, element.opacity)) : 1;
    if (element.fit !== undefined) out.fit = IMAGE_FITS.some(([id]) => id === element.fit) ? element.fit : 'cover';
    if (element.clipShape !== undefined) out.clipShape = IMAGE_CLIP_SHAPES.some(([id]) => id === element.clipShape) ? element.clipShape : 'none';
    if (element.borderRadius !== undefined) {
        out.borderRadius = Number.isFinite(element.borderRadius)
            ? Math.min(IMAGE_RADIUS_LIMITS[1], Math.max(IMAGE_RADIUS_LIMITS[0], Math.round(element.borderRadius))) : 0;
    }
    if (element.borderWidth !== undefined) {
        out.borderWidth = Number.isFinite(element.borderWidth)
            ? Math.min(IMAGE_BORDER_WIDTH_LIMITS[1], Math.max(IMAGE_BORDER_WIDTH_LIMITS[0], Math.round(element.borderWidth))) : 0;
    }
    if (element.borderColor !== undefined && typeof element.borderColor !== 'string') out.borderColor = '';
    return out;
}

// Fills defaults on a VariableElement. Unknown fields are preserved.
export function normalizeVariableElement(element) {
    const type = TYPE_IDS.has(element.type) ? element.type : ELEMENT_TYPE_TEXT;
    const object = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
    const { role: legacyRole, formatPattern: _pattern, ...rest } = element;
    return {
        ...rest,
        id: typeof element.id === 'string' && element.id ? element.id : newElementId(),
        type,
        x: Math.max(0, finite(element.x, 0)),
        y: Math.max(0, finite(element.y, 0)),
        width: Math.max(MIN_ELEMENT_WIDTH, finite(element.width, DEFAULT_ELEMENT_WIDTH)),
        height: Math.max(MIN_ELEMENT_HEIGHT, finite(element.height, DEFAULT_ELEMENT_HEIGHT)),
        binding: UNBOUND_TYPES.has(type) ? null : (normalizeBinding(element.binding) ?? legacyRoleBinding(legacyRole)),
        content: text(element.content).slice(0, MAX_FREE_TEXT_LENGTH),
        showLabel: element.showLabel !== false,
        labelOverride: text(element.labelOverride),
        format: normalizeFormat(element.format),
        zIndex: Number.isFinite(element.zIndex) ? Math.round(element.zIndex) : defaultZIndex(type),
        ...normalizeImageFields(element),
        style: elementStyle(object(element.style)),
        widget: object(element.widget),
        shape: object(element.shape),
        clock: object(element.clock),
        ...(type === ELEMENT_TYPE_CHARACTER ? { character: normalizeCharacterOptions(element.character) } : {}),
    };
}

// A Character element's options: which template draws each card (null: the
// built-in card), how a list tiles, and the gap between cards (px).
export function normalizeCharacterOptions(raw) {
    const options = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const gap = Number.isFinite(options.gap) ? Math.round(options.gap) : 6;
    return {
        templateId: typeof options.templateId === 'string' && options.templateId ? options.templateId : null,
        tiling: CHARACTER_TILINGS.some(([id]) => id === options.tiling) ? options.tiling : 'grid',
        gap: Math.min(CHARACTER_GAP_LIMITS[1], Math.max(CHARACTER_GAP_LIMITS[0], gap)),
    };
}

// Normalizes a panel's widget list: VariableElements get defaults, any
// other (future) widget type is kept as-is so it survives a round-trip
// through this version.
export function normalizeWidgets(widgets) {
    if (!Array.isArray(widgets)) return [];
    return widgets
        .filter((w) => w && typeof w === 'object' && !Array.isArray(w))
        .map((w) => (TYPE_IDS.has(w.type) || w.type === LEGACY_TYPE_VARIABLE || w.type === undefined
            ? normalizeVariableElement(w)
            : w));
}

export function createVariableElement(init = {}) {
    return normalizeVariableElement({ ...init, id: newElementId() });
}

// "se__hp" -> "hp": the name a user recognises, without its namespace.
export function localName(qualifiedName) {
    const i = qualifiedName.indexOf('__');
    return i > 0 ? qualifiedName.slice(i + 2) : qualifiedName;
}

// The label an element shows (when showLabel is on): the override, else
// the variable's own label, else its local name.
export function elementLabel(element, def) {
    if (element.type === ELEMENT_TYPE_SHAPE) return 'Shape';
    if (element.type === ELEMENT_TYPE_FREE_TEXT) return 'Text';
    if (element.labelOverride) return element.labelOverride;
    if (def?.label) return def.label;
    if (element.binding?.role) return rolePublicName(element.binding.role);
    if (element.binding?.char) return element.binding.char.replace(/^custom\./, '');
    return element.binding ? localName(element.binding.name) : 'Unbound';
}

// Keeps an element's geometry inside its panel body (bodyWidth x
// bodyHeight) and above the minimum size. `changed` names the field just
// edited: a width/height edit keeps the position and limits the size to
// the space left; anything else fits the size first, then the position -
// either way the element never ends up outside the panel.
export function clampElementGeometry({ x, y, width, height }, bodyWidth, bodyHeight, changed = null) {
    const fit = (value, min, max) => Math.round(Math.min(Math.max(value, min), Math.max(min, max)));
    if (changed === 'width' || changed === 'height') {
        const px = fit(x, 0, bodyWidth - MIN_ELEMENT_WIDTH);
        const py = fit(y, 0, bodyHeight - MIN_ELEMENT_HEIGHT);
        return {
            x: px,
            y: py,
            width: fit(width, MIN_ELEMENT_WIDTH, bodyWidth - px),
            height: fit(height, MIN_ELEMENT_HEIGHT, bodyHeight - py),
        };
    }
    const w = fit(width, MIN_ELEMENT_WIDTH, bodyWidth);
    const h = fit(height, MIN_ELEMENT_HEIGHT, bodyHeight);
    return {
        x: fit(x, 0, bodyWidth - w),
        y: fit(y, 0, bodyHeight - h),
        width: w,
        height: h,
    };
}
