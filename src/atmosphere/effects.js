// The atmosphere's effects: small particle systems drawn on one 2D canvas
// (src/atmosphere/atmosphere.js runs them). Each effect is
//
//   count(strength)            how many particles at this strength (0..2)
//   spawn(w, h, initial)       a new particle (initial: spread over the whole
//                              screen, not just its edge, so an effect that
//                              turns on fills the screen at once)
//   step(p, dt, w, h, t)       moves it; returns false once it has left
//   draw(ctx, p)
//   overlay(ctx, w, h, t, strength, state)   optional: drawn over the
//                              particles (fog banks, lightning)
//   tint                       [r, g, b, alpha per strength] - the static
//                              look for "reduce motion"
//
// Counts are modest and capped (atmosphere.js MAX_PARTICLES): this runs
// behind the chat all the time, on weak machines too.

const rand = (min, max) => min + Math.random() * (max - min);

function fallingStreaks({ density, speed, length, slant, alpha, width, color }) {
    return {
        count: (strength) => Math.round(density * strength),
        spawn(w, h, initial) {
            return {
                x: rand(-0.1 * w, 1.1 * w),
                y: initial ? rand(-h, h) : rand(-h * 0.3, -10),
                v: rand(...speed),
                len: rand(...length),
                a: rand(...alpha),
            };
        },
        step(p, dt, w, h) {
            p.y += p.v * dt;
            p.x += p.v * slant * dt;
            return p.y - p.len < h;
        },
        draw(ctx, p) {
            ctx.strokeStyle = `rgba(${color}, ${p.a})`;
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x - p.len * slant, p.y - p.len);
            ctx.stroke();
        },
    };
}

const rain = {
    ...fallingStreaks({ density: 320, speed: [900, 1300], length: [12, 22], slant: 0.12, alpha: [0.22, 0.42], width: 1, color: '200, 215, 235' }),
    tint: [120, 140, 170, 0.08],
};

const drizzle = {
    ...fallingStreaks({ density: 200, speed: [450, 650], length: [5, 10], slant: 0.06, alpha: [0.15, 0.3], width: 1, color: '210, 220, 235' }),
    tint: [140, 155, 175, 0.05],
};

// Heavy, slanted rain - and lightning: now and then a double flash.
const stormRain = fallingStreaks({ density: 480, speed: [1300, 1700], length: [18, 30], slant: 0.22, alpha: [0.25, 0.45], width: 1.2, color: '205, 215, 235' });
const storm = {
    ...stormRain,
    overlay(ctx, w, h, t, strength, state) {
        state.next ??= t + rand(4, 10);
        if (t >= state.next) {
            state.flashAt = t;
            state.next = t + rand(6, 16) / Math.max(0.5, strength);
        }
        if (state.flashAt === undefined) return;
        const since = t - state.flashAt;
        // Two quick flashes, fading.
        const flash = since < 0.12 ? 1 - since / 0.12 : since > 0.18 && since < 0.32 ? 0.6 * (1 - (since - 0.18) / 0.14) : 0;
        if (flash <= 0) return;
        ctx.fillStyle = `rgba(230, 235, 255, ${0.28 * flash * Math.min(1, strength)})`;
        ctx.fillRect(0, 0, w, h);
    },
    tint: [90, 100, 130, 0.12],
};

const snow = {
    count: (strength) => Math.round(150 * strength),
    spawn(w, h, initial) {
        return { x: rand(0, w), y: initial ? rand(-h, h) : rand(-40, -5), r: rand(1, 3.5), v: rand(25, 70), phase: rand(0, Math.PI * 2), sway: rand(10, 30), a: rand(0.55, 0.9) };
    },
    step(p, dt, w, h, t) {
        p.y += p.v * dt;
        p.x += Math.sin(t * 0.8 + p.phase) * p.sway * dt;
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        return p.y - p.r < h;
    },
    draw(ctx, p) {
        ctx.fillStyle = `rgba(255, 255, 255, ${p.a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    },
    tint: [230, 235, 245, 0.07],
};

const hail = {
    ...fallingStreaks({ density: 110, speed: [700, 1000], length: [3, 6], slant: 0.05, alpha: [0.6, 0.9], width: 2.4, color: '235, 240, 250' }),
    tint: [200, 210, 225, 0.07],
};

// Large soft banks drifting sideways.
const fog = {
    count: (strength) => Math.max(1, Math.round(9 * Math.min(1.5, strength))),
    spawn(w, h, initial) {
        const r = rand(0.25, 0.45) * Math.max(w, h);
        return { x: initial ? rand(-r, w + r) : -r, y: rand(0.1 * h, 0.95 * h), r, v: rand(6, 18), a: rand(0.1, 0.2) };
    },
    step(p, dt, w) {
        p.x += p.v * dt;
        return p.x - p.r < w;
    },
    draw(ctx, p) {
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(220, 225, 230, ${p.a})`);
        g.addColorStop(1, 'rgba(220, 225, 230, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    },
    tint: [210, 215, 220, 0.14],
};

// Glowing sparks rising and flickering.
const embers = {
    count: (strength) => Math.round(70 * strength),
    spawn(w, h, initial) {
        return { x: rand(0, w), y: initial ? rand(0, h * 1.1) : h + rand(5, 40), r: rand(1, 2.4), v: rand(25, 70), phase: rand(0, Math.PI * 2), sway: rand(10, 35), life: rand(0.6, 1) };
    },
    step(p, dt, w, h, t) {
        p.y -= p.v * dt;
        p.x += Math.sin(t * 1.3 + p.phase) * p.sway * dt;
        p.flicker = 0.55 + 0.45 * Math.sin(t * 9 + p.phase * 3);
        return p.y + p.r > -10;
    },
    draw(ctx, p) {
        const a = (p.flicker ?? 1) * p.life;
        ctx.fillStyle = `rgba(255, 150, 60, ${0.25 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255, 210, 140, ${0.9 * a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    },
    tint: [255, 120, 40, 0.06],
};

const LEAF_COLORS = ['190, 110, 40', '170, 70, 30', '200, 150, 50', '140, 90, 40'];
const leaves = {
    count: (strength) => Math.round(36 * strength),
    spawn(w, h, initial) {
        return {
            x: rand(0, w), y: initial ? rand(-h, h) : rand(-60, -10), size: rand(5, 10), v: rand(35, 80),
            phase: rand(0, Math.PI * 2), sway: rand(25, 60), rot: rand(0, Math.PI * 2), spin: rand(-2, 2),
            color: LEAF_COLORS[Math.floor(Math.random() * LEAF_COLORS.length)], a: rand(0.6, 0.9),
        };
    },
    step(p, dt, w, h, t) {
        p.y += p.v * dt;
        p.x += Math.sin(t * 0.9 + p.phase) * p.sway * dt;
        p.rot += p.spin * dt;
        return p.y - p.size < h;
    },
    draw(ctx, p) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `rgba(${p.color}, ${p.a})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },
    tint: [170, 100, 40, 0.05],
};

// Specks drifting slowly in the light.
const dust = {
    count: (strength) => Math.round(80 * strength),
    spawn(w, h) {
        return { x: rand(0, w), y: rand(0, h), r: rand(0.6, 1.6), vx: rand(-8, 8), vy: rand(-6, 6), phase: rand(0, Math.PI * 2), age: 0, life: rand(6, 14) };
    },
    step(p, dt) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.age += dt;
        return p.age < p.life;
    },
    draw(ctx, p) {
        // Fades in and out over its life.
        const a = 0.35 * Math.sin(Math.PI * Math.min(1, p.age / p.life));
        ctx.fillStyle = `rgba(255, 245, 220, ${a})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    },
    tint: [255, 240, 210, 0.04],
};

export const EFFECT_SYSTEMS = { rain, drizzle, storm, snow, hail, fog, embers, leaves, dust };
