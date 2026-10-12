// Widget element types: bars, gauges and the composite bar. Each draws
// its bound variable as a percentage, with Widget Properties stored in
// element.widget (saved with the layout). Anything unset uses the default
// below (colours: the SillyTavern theme).
//
// The DOM for a type is built once and then only updated, so width/height
// and stroke-dashoffset changes can animate (200ms) when `animate` is on.
//
// Percentage = (value - min) / (max - min) * 100, the value clamped to
// [min, max]. `min` / `max` are the element's Min Value / Max Value
// (widget.minValue / widget.maxValue - any numbers, negative too, max above
// min); each one left blank comes from the bound variable's own range - its
// min (else 0), its max (else 100). So a -3..3 score fills a bar from -3.
//
// GRADIENT: with a high-end colour (widget.gradientColor) the fill shades
// from the Fill colour (the low end) - through widget.gradientMid, when set -
// to it. A bar's gradient spans the whole track, so a low value shows only
// the low-end colours; a gauge takes the single colour for its value.

import { isColor } from '../panels/panel-style.js';
import { iconClass } from './element-style.js';
import { elementLabel } from './element-model.js';
import { formatText } from './text-format.js';

// Which Widget Properties each type offers, in display order.
export const WIDGET_FIELDS = {
    'bar-horizontal': ['minValue', 'maxValue', 'trackColor', 'fillColor', 'gradientMid', 'gradientColor', 'cornerRadius', 'barHeight', 'animate'],
    'bar-vertical': ['minValue', 'maxValue', 'trackColor', 'fillColor', 'gradientMid', 'gradientColor', 'cornerRadius', 'barWidth', 'animate'],
    'gauge-circle': ['minValue', 'maxValue', 'gaugeRadius', 'strokeWidth', 'trackColor', 'fillColor', 'gradientMid', 'gradientColor', 'showValue', 'animate'],
    'gauge-semicircle': ['minValue', 'maxValue', 'gaugeRadius', 'strokeWidth', 'trackColor', 'fillColor', 'gradientMid', 'gradientColor', 'showValue', 'animate'],
    'composite-bar': ['labelText', 'labelColor', 'icon', 'iconColor', 'iconSize', 'minValue', 'maxValue', 'trackColor', 'fillColor', 'gradientMid', 'gradientColor', 'cornerRadius', 'barHeight', 'animate'],
};

export const WIDGET_LIMITS = {
    cornerRadius: [0, 50],
    barHeight: [2, 200],
    barWidth: [2, 200],
    gaugeRadius: [8, 400],
    strokeWidth: [1, 60],
    iconSize: [8, 72],
};

export const WIDGET_DEFAULTS = {
    cornerRadius: 4,
    barHeight: 10,
    barWidth: 12,
    strokeWidth: 6,
    iconSize: 14,
    animate: true,
    showValue: true,
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function num(widget, key) {
    const value = widget?.[key];
    const [min, max] = WIDGET_LIMITS[key];
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : WIDGET_DEFAULTS[key] ?? null;
}

function flag(widget, key) {
    return widget?.[key] === undefined ? WIDGET_DEFAULTS[key] : widget[key] !== false;
}

function color(widget, key) {
    return isColor(widget?.[key]) ? widget[key] : null;
}

// The [min, max] a widget measures against (see header). A range that
// would be empty or upside down falls back step by step: the variable's,
// then 0..100 (or min..min+100).
export function effectiveRange(widget, def) {
    const given = (v) => Number.isFinite(v);
    const min = given(widget?.minValue) ? widget.minValue : (given(def?.min) ? def.min : 0);
    for (const max of [widget?.maxValue, def?.max, 100, min + 100]) {
        if (given(max) && max > min) return [min, max];
    }
    return [min, min + 100];
}

export function effectiveMax(widget, def) {
    return effectiveRange(widget, def)[1];
}

export function effectiveMin(widget, def) {
    return effectiveRange(widget, def)[0];
}

// 0-100, or null when the value isn't a number.
export function percentOf(value, def, widget) {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (!Number.isFinite(n)) return null;
    const [min, max] = effectiveRange(widget, def);
    return ((Math.min(max, Math.max(min, n)) - min) / (max - min)) * 100;
}

// The gradient's colours, low to high, or null for a plain fill: the Fill
// colour (or the theme's) at the low end, the optional middle, the high end.
export function gradientStops(widget) {
    const high = color(widget, 'gradientColor');
    if (!high) return null;
    const low = color(widget, 'fillColor') ?? 'var(--ppt-primary, var(--SmartThemeQuoteColor))';
    const mid = color(widget, 'gradientMid');
    return mid ? [low, mid, high] : [low, high];
}

// The single colour at `pct` (0-100) along `stops` - for a gauge.
export function colorAt(stops, pct) {
    const p = Math.min(100, Math.max(0, pct ?? 0));
    if (stops.length === 2) return `color-mix(in srgb, ${stops[1]} ${p.toFixed(1)}%, ${stops[0]})`;
    return p <= 50
        ? `color-mix(in srgb, ${stops[1]} ${(p * 2).toFixed(1)}%, ${stops[0]})`
        : `color-mix(in srgb, ${stops[2]} ${((p - 50) * 2).toFixed(1)}%, ${stops[1]})`;
}

function svg(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
}

function barMarkup(orientation) {
    return `<div class="pp-bar pp-bar-${orientation}"><div class="pp-bar-fill"></div></div>`;
}

function build(holder, type) {
    holder.replaceChildren();
    // Clear anything another element type (an analog clock) left behind.
    holder.removeAttribute('style');
    holder.removeAttribute('title');
    holder.dataset.type = type;
    if (type === 'bar-horizontal') holder.innerHTML = barMarkup('h');
    else if (type === 'bar-vertical') holder.innerHTML = barMarkup('v');
    else if (type === 'composite-bar') {
        holder.innerHTML = `<i class="pp-widget-icon" hidden></i><span class="pp-widget-label"></span>${barMarkup('h')}`;
    } else {
        const gauge = svg('svg', { class: 'pp-gauge' });
        gauge.append(
            svg(type === 'gauge-circle' ? 'circle' : 'path', { class: 'pp-gauge-track', fill: 'none' }),
            svg(type === 'gauge-circle' ? 'circle' : 'path', { class: 'pp-gauge-fill', fill: 'none', pathLength: '100' }),
        );
        const value = document.createElement('div');
        value.className = 'pp-gauge-value';
        holder.append(gauge, value);
    }
}

function applyColors(holder, widget) {
    const set = (prop, v) => (v ? holder.style.setProperty(prop, v) : holder.style.removeProperty(prop));
    set('--pp-w-track', color(widget, 'trackColor'));
    set('--pp-w-fill', color(widget, 'fillColor'));
    holder.classList.toggle('pp-animate', flag(widget, 'animate'));
}

function updateBar(holder, widget, pct, vertical) {
    holder.style.setProperty('--pp-w-radius', `${num(widget, 'cornerRadius')}px`);
    holder.style.setProperty(vertical ? '--pp-w-bar-w' : '--pp-w-bar-h', `${num(widget, vertical ? 'barWidth' : 'barHeight')}px`);
    const fill = holder.querySelector('.pp-bar-fill');
    fill.style[vertical ? 'height' : 'width'] = `${pct ?? 0}%`;
    // A gradient spans the whole track: the fill shows the part up to its value.
    const stops = gradientStops(widget);
    if (stops && pct) {
        fill.style.backgroundImage = `linear-gradient(${vertical ? 'to top' : 'to right'}, ${stops.join(', ')})`;
        const span = `${(10000 / pct).toFixed(2)}%`;
        fill.style.backgroundSize = vertical ? `100% ${span}` : `${span} 100%`;
        fill.style.backgroundPosition = vertical ? 'bottom' : 'left';
    } else {
        fill.style.removeProperty('background-image');
        fill.style.removeProperty('background-size');
        fill.style.removeProperty('background-position');
    }
}

// Gauge geometry from the element's own size (so the properties preview,
// which isn't laid out inside a panel, draws identically).
function updateGauge(holder, element, entry, pct, semi, formatting) {
    const widget = element.widget;
    const stroke = num(widget, 'strokeWidth');
    const width = Math.max(8, element.width - 4);
    const height = Math.max(8, element.height - 4);
    const auto = semi
        ? Math.min(width / 2, height) - stroke / 2 - 1
        : Math.min(width, height) / 2 - stroke / 2 - 1;
    const r = Math.max(2, Number.isFinite(widget?.gaugeRadius) ? num(widget, 'gaugeRadius') : auto);
    const size = 2 * r + stroke;
    const gauge = holder.querySelector('.pp-gauge');
    const track = holder.querySelector('.pp-gauge-track');
    const fill = holder.querySelector('.pp-gauge-fill');
    const c = size / 2;

    if (semi) {
        const h = r + stroke / 2 + 1;
        gauge.setAttribute('viewBox', `0 0 ${size} ${h}`);
        gauge.setAttribute('width', String(size));
        gauge.setAttribute('height', String(h));
        const d = `M ${stroke / 2} ${r + stroke / 2} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${r + stroke / 2}`;
        track.setAttribute('d', d);
        fill.setAttribute('d', d);
    } else {
        gauge.setAttribute('viewBox', `0 0 ${size} ${size}`);
        gauge.setAttribute('width', String(size));
        gauge.setAttribute('height', String(size));
        for (const circle of [track, fill]) {
            circle.setAttribute('cx', String(c));
            circle.setAttribute('cy', String(c));
            circle.setAttribute('r', String(r));
        }
        // Start at 12 o'clock.
        fill.setAttribute('transform', `rotate(-90 ${c} ${c})`);
    }
    for (const ring of [track, fill]) ring.setAttribute('stroke-width', String(stroke));
    const stops = gradientStops(widget);
    if (stops) fill.style.stroke = colorAt(stops, pct);
    else fill.style.removeProperty('stroke');
    fill.setAttribute('stroke-dasharray', '100 100');
    fill.style.strokeDashoffset = String(100 - (pct ?? 0));
    fill.classList.toggle('pp-gauge-empty', !pct);

    const valueEl = holder.querySelector('.pp-gauge-value');
    valueEl.hidden = !flag(widget, 'showValue');
    valueEl.textContent = entry === undefined ? '—' : formatText(entry.value, entry.def, element.format, formatting).text;
    valueEl.style.fontSize = `${Math.max(9, Math.round(r * (semi ? 0.42 : 0.5)))}px`;
    holder.classList.toggle('pp-gauge-semi', semi);
}

function updateComposite(holder, element, entry, pct) {
    const widget = element.widget;
    const icon = holder.querySelector('.pp-widget-icon');
    const cls = iconClass(widget?.icon);
    icon.hidden = !cls;
    icon.className = `pp-widget-icon ${cls ?? ''}`.trim();
    icon.style.color = color(widget, 'iconColor') ?? '';
    icon.style.fontSize = `${num(widget, 'iconSize')}px`;

    const label = holder.querySelector('.pp-widget-label');
    const text = typeof widget?.labelText === 'string' ? widget.labelText.trim() : '';
    // Icon only when an icon is set and no label text; otherwise the label
    // text, falling back to the variable's own label.
    label.textContent = text || (cls ? '' : elementLabel(element, entry?.def ?? null));
    label.hidden = !label.textContent;
    label.style.color = color(widget, 'labelColor') ?? '';
    updateBar(holder, widget, pct, false);
}

// Draws (or updates) a widget element inside `container`'s .pp-widget.
// `formatting` is the panel theme's formatting (for a gauge's value).
export function renderWidget(container, element, entry, formatting = null) {
    const holder = container.querySelector('.pp-widget');
    if (holder.dataset.type !== element.type) build(holder, element.type);
    const pct = entry === undefined ? null : percentOf(entry.value, entry.def, element.widget);
    applyColors(holder, element.widget);
    holder.classList.toggle('pp-widget-nodata', pct === null);
    if (element.type === 'bar-horizontal') updateBar(holder, element.widget, pct, false);
    else if (element.type === 'bar-vertical') updateBar(holder, element.widget, pct, true);
    else if (element.type === 'gauge-circle') updateGauge(holder, element, entry, pct, false, formatting);
    else if (element.type === 'gauge-semicircle') updateGauge(holder, element, entry, pct, true, formatting);
    else if (element.type === 'composite-bar') updateComposite(holder, element, entry, pct);
}
