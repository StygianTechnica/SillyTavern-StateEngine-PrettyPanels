// Element records: the widgets that live INSIDE a panel instance
// (panel.widgets[]). Plain data only - src/elements/element-view.js
// renders them. The only type in this pass is the VariableElement:
//
//   {
//     id, type: 'variable',
//     x, y, width, height,     position/size inside the panel body, px
//     role,                    optional conceptual tag ("health", ...)
//     binding: { name } | null fully-qualified State Engine variable name
//     showLabel, labelOverride,
//     format,                  a key from formats.js ('auto' = by type)
//     style,                   Element Styling (src/elements/element-style.js)
//   }
//
// Bindings live in the layout's panel instances (a chat chooses a layout
// for what it shows) and are stripped from panel templates
// (src/storage/design.js stripBindings()).

export const ELEMENT_TYPE_VARIABLE = 'variable';
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

// Fills defaults on a VariableElement. Unknown fields are preserved.
export function normalizeVariableElement(element) {
    return {
        ...element,
        id: typeof element.id === 'string' && element.id ? element.id : newElementId(),
        type: ELEMENT_TYPE_VARIABLE,
        x: Math.max(0, finite(element.x, 0)),
        y: Math.max(0, finite(element.y, 0)),
        width: Math.max(MIN_ELEMENT_WIDTH, finite(element.width, DEFAULT_ELEMENT_WIDTH)),
        height: Math.max(MIN_ELEMENT_HEIGHT, finite(element.height, DEFAULT_ELEMENT_HEIGHT)),
        role: text(element.role),
        binding: normalizeBinding(element.binding),
        showLabel: element.showLabel !== false,
        labelOverride: text(element.labelOverride),
        format: typeof element.format === 'string' && element.format ? element.format : 'auto',
        style: element.style && typeof element.style === 'object' && !Array.isArray(element.style) ? element.style : {},
    };
}

// Normalizes a panel's widget list: VariableElements get defaults, any
// other (future) widget type is kept as-is so it survives a round-trip
// through this version.
export function normalizeWidgets(widgets) {
    if (!Array.isArray(widgets)) return [];
    return widgets
        .filter((w) => w && typeof w === 'object' && !Array.isArray(w))
        .map((w) => (w.type === ELEMENT_TYPE_VARIABLE ? normalizeVariableElement(w) : w));
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
