// The atmosphere's canvas: one full-window canvas between SillyTavern's
// background (#bg1, z-index -1) and the chat column (#sheld, z-index 30) -
// behind the chat text, over the background - that never takes a click.
// setEffects([{ effect, strength }]) says what to draw (atmosphere-model.js
// activeEffects); one requestAnimationFrame loop runs every effect.
//
// Kept light: a particle cap, device pixel ratio capped, the loop stops
// when nothing runs and pauses while the tab is hidden. An effect turned
// off stops spawning and fades out over FADE_SECONDS rather than vanishing
// (slow fog or snow would otherwise linger for a minute). With "reduce motion" set in the system, nothing
// moves: each effect is a faint static tint instead.

import { EFFECT_SYSTEMS } from './effects.js';

const MAX_PARTICLES = 900;
const MAX_DPR = 1.5;
const FADE_SECONDS = 2.5;

let canvas = null;
let ctx = null;
// effect -> { strength, particles: [], state: {} }
const systems = new Map();
let frame = 0;
let last = 0;
let time = 0;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function ensureCanvas() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'pp_atmosphere';
    canvas.setAttribute('aria-hidden', 'true');
    // Right after the background, so it stacks above it and below the chat.
    const background = document.getElementById('bg1');
    if (background) background.after(canvas);
    else document.body.prepend(canvas);
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    reducedMotion?.addEventListener?.('change', () => {
        stop();
        start();
    });
    resize();
}

function resize() {
    if (!canvas) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reducedMotion?.matches) drawStill();
}

function totalParticles() {
    let n = 0;
    for (const system of systems.values()) n += system.particles.length;
    return n;
}

// What to draw: { effect, strength } for each running effect. Effects not
// listed fade out.
export function setEffects(effects) {
    const wanted = new Map(effects.filter((e) => EFFECT_SYSTEMS[e.effect]).map((e) => [e.effect, e.strength]));
    for (const [effect, system] of systems) if (!wanted.has(effect)) system.strength = 0;
    for (const [effect, strength] of wanted) {
        const system = systems.get(effect);
        if (system) {
            system.strength = strength;
            system.fade = 1;
        } else {
            ensureCanvas();
            const added = { strength, particles: [], state: {}, fresh: true, fade: 1 };
            systems.set(effect, added);
        }
    }
    if (systems.size === 0) {
        stop();
        clear();
        return;
    }
    start();
}

function clear() {
    if (!ctx) return;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    if (canvas) canvas.hidden = systems.size === 0;
}

// "Reduce motion": a faint tint per effect, drawn once.
function drawStill() {
    clear();
    for (const [effect, system] of systems) {
        if (system.strength <= 0) continue;
        const [r, g, b, a] = EFFECT_SYSTEMS[effect].tint;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.min(0.3, a * system.strength)})`;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }
    for (const [effect, system] of systems) if (system.strength <= 0) systems.delete(effect);
}

function start() {
    if (!canvas || systems.size === 0 || document.hidden) return;
    canvas.hidden = false;
    if (reducedMotion?.matches) {
        drawStill();
        return;
    }
    if (frame) return;
    last = performance.now();
    frame = requestAnimationFrame(tick);
}

function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
}

function tick(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    let room = MAX_PARTICLES - totalParticles();
    for (const [effect, system] of systems) {
        const fx = EFFECT_SYSTEMS[effect];
        // Spawn toward the target count (none once turned off).
        const target = system.strength > 0 ? fx.count(system.strength) : 0;
        let missing = Math.min(target - system.particles.length, room);
        // Top up gradually, except when an effect first appears (fill the screen).
        if (!system.fresh) missing = Math.min(missing, Math.ceil(target * dt * 1.5) + 1);
        for (let i = 0; i < missing; i++) system.particles.push(fx.spawn(w, h, system.fresh));
        room -= Math.max(0, missing);
        system.fresh = false;
        system.particles = system.particles.filter((p) => fx.step(p, dt, w, h, time));
        if (system.strength <= 0) system.fade = Math.max(0, system.fade - dt / FADE_SECONDS);
        ctx.globalAlpha = system.fade;
        for (const p of system.particles) fx.draw(ctx, p);
        if (system.strength > 0) fx.overlay?.(ctx, w, h, time, system.strength, system.state);
        ctx.globalAlpha = 1;
        if (system.strength <= 0 && (system.particles.length === 0 || system.fade === 0)) systems.delete(effect);
    }
    if (systems.size === 0) {
        clear();
        return;
    }
    frame = requestAnimationFrame(tick);
}
