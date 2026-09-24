// Widget element types: bars, gauges and the composite bar. Each draws
// its bound variable as a percentage, with Widget Properties stored in
// element.widget (saved with the layout). Anything unset uses the default
// below (colours: the SillyTavern theme).
//
// The DOM for a type is built once and then only updated, so width/height
// and stroke-dashoffset changes can animate (200ms) when `animate` is on.
//
// Percentage: a variable that defines min/max fills relative to that
// range (hp 12 of max 20 = 60%); otherwise the value itself is the
// percentage, clamped to 0-100.

import { isColor } from '../panels/panel-style.js';
import { iconClass } from './element-style.js';
import { elementLabel } from './element-model.js';
import { formatValue } from './formats.js';

// Which Widget Properties each type offers, in display order.
export const WIDGET_FIELDS = {
    'bar-horizontal': ['trackColor', 'fillColor', 'cornerRadius', 'barHeight', 'animate'],
    'bar-vertical': ['trackColor', 'fillColor', 'cornerRadius', 'barWidth', 'animate'],
    'gauge-circle': ['gaugeRadius', 'strokeWidth', 'trackColor', 'fillColor', 'showValue', 'animate'],
    'gauge-semicircle': ['gaugeRadius', 'strokeWidth', 'trackColor', 'fillColor', 'showValue', 'animate'],
    'composite-bar': ['labelText', 'labelColor', 'icon', 'iconColor', 'iconSize', 'trackColor', 'fillColor', 'cornerRadius', 'barHeight', 'animate'],
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

// 0-100, or null when the value isn't a number.
export function percentOf(value, def) {
    const n = typeof value === 'number' ? value : (typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN);
    if (!Number.isFinite(n)) return null;
    const min = Number.isFinite(def?.min) ? def.min : 0;
    const max = Number.isFinite(def?.max) ? def.max : (Number.isFinite(def?.min) ? def.min + 100 : 100);
    if (max <= min) return null;
    return Math.min(100, Math.max(0, ((n - min) / (max - min)) * 100));
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
}

// Gauge geometry from the element's own size (so the properties preview,
// which isn't laid out inside a panel, draws identically).
function updateGauge(holder, element, entry, pct, semi) {
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
    fill.setAttribute('stroke-dasharray', '100 100');
    fill.style.strokeDashoffset = String(100 - (pct ?? 0));
    fill.classList.toggle('pp-gauge-empty', !pct);

    const valueEl = holder.querySelector('.pp-gauge-value');
    valueEl.hidden = !flag(widget, 'showValue');
    valueEl.textContent = entry === undefined ? '—' : formatValue(entry.value, entry.def, element.format).text;
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
export function renderWidget(container, element, entry) {
    const holder = container.querySelector('.pp-widget');
    if (holder.dataset.type !== element.type) build(holder, element.type);
    const pct = entry === undefined ? null : percentOf(entry.value, entry.def);
    applyColors(holder, element.widget);
    holder.classList.toggle('pp-widget-nodata', pct === null);
    if (element.type === 'bar-horizontal') updateBar(holder, element.widget, pct, false);
    else if (element.type === 'bar-vertical') updateBar(holder, element.widget, pct, true);
    else if (element.type === 'gauge-circle') updateGauge(holder, element, entry, pct, false);
    else if (element.type === 'gauge-semicircle') updateGauge(holder, element, entry, pct, true);
    else if (element.type === 'composite-bar') updateComposite(holder, element, entry, pct);
}
