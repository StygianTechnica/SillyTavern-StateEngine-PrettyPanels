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
//                              'analogClock'
//     x, y, width, height,     position/size inside the panel body, px
//     role,                    optional conceptual tag ("health", ...)
//     binding: { name } | null fully-qualified State Engine variable name
//                              (always null for a shape or free text)
//     content,                 free text only: the text it shows
//     zIndex,                  stacking order inside the panel, any integer:
//                              elements draw in ascending zIndex, ties in
//                              stored order (DEFAULT_Z_INDEX per type)
//     opacity, fit,            image variable elements (a text element whose
//     clipShape, borderRadius, value is an image): see IMAGE_* below;
//     borderWidth, borderColor the border only shows with a clip shape
//     showLabel, labelOverride,
//     format,                  a key from formats.js ('auto' = by type)
//     formatPattern,           the 'custom' datetime format's pattern
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
// (src/storage/design.js stripBindings()).

export const ELEMENT_TYPE_TEXT = 'text';
export const ELEMENT_TYPE_SHAPE = 'shape';
export const ELEMENT_TYPE_FREE_TEXT = 'free-text';
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

// Suggestions for the Role field - free text, these are just offered.
export const ROLE_SUGGESTIONS = ['name', 'health', 'mana', 'stamina', 'status', 'mood', 'location', 'time', 'date', 'inventory', 'currency', 'objective'];

function finite(value, fallback) {
    return Number.isFinite(value) ? Math.round(value) : fallback;
}

function text(value) {
    return typeof value === 'string' ? value : '';
}

function newElementId() {
    return `ppe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeBinding(binding) {
    const name = typeof binding?.name === 'string' ? binding.name.trim() : '';
    return name ? { name } : null;
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
    return {
        ...element,
        id: typeof element.id === 'string' && element.id ? element.id : newElementId(),
        type,
        x: Math.max(0, finite(element.x, 0)),
        y: Math.max(0, finite(element.y, 0)),
        width: Math.max(MIN_ELEMENT_WIDTH, finite(element.width, DEFAULT_ELEMENT_WIDTH)),
        height: Math.max(MIN_ELEMENT_HEIGHT, finite(element.height, DEFAULT_ELEMENT_HEIGHT)),
        role: text(element.role),
        binding: UNBOUND_TYPES.has(type) ? null : normalizeBinding(element.binding),
        content: text(element.content).slice(0, MAX_FREE_TEXT_LENGTH),
        showLabel: element.showLabel !== false,
        labelOverride: text(element.labelOverride),
        format: typeof element.format === 'string' && element.format ? element.format : 'auto',
        formatPattern: text(element.formatPattern),
        zIndex: Number.isFinite(element.zIndex) ? Math.round(element.zIndex) : defaultZIndex(type),
        ...normalizeImageFields(element),
        style: object(element.style),
        widget: object(element.widget),
        shape: object(element.shape),
        clock: object(element.clock),
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
