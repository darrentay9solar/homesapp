"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The desktop welcome scene: night sky over the curve of the Earth. The sun
 * travels round the Earth — setting behind it and rising again — while the
 * stars stream towards the viewer, bright against the night and fading as
 * the sky lightens. A small clock follows the sun's simulated time of day.
 *
 * Drawn on a canvas rather than shipped as a video: crisp at any size, a
 * few kilobytes, and it loops without a seam. Respects "reduce motion"
 * (shows a still pre-dawn frame) and pauses when the tab is hidden.
 */

const SUNRISE = 7; // Singapore, roughly year-round
const SUNSET = 19;
const NOON = 13; // solar noon in Singapore (UTC+8 sits west of its meridian)

type Star = { x: number; y: number; z: number; tw: number };

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function mix(c1: number[], c2: number[], t: number) {
  return c1.map((v, i) => Math.round(lerp(v, c2[i], t)));
}
const rgb = (c: number[], a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => v * v * (3 - 2 * v);

/** How far the sun is above the horizon, -1 (midnight) … 1 (noon). */
function elevation(hour: number) {
  return Math.cos(((hour - NOON) / 24) * Math.PI * 2);
}

function phaseLabel(hour: number) {
  if (hour >= SUNRISE - 1.25 && hour < SUNRISE) return "Before sunrise";
  if (hour >= SUNRISE && hour < SUNRISE + 1) return "Sunrise";
  if (hour >= SUNRISE + 1 && hour < SUNSET - 1) return "Daytime";
  if (hour >= SUNSET - 1 && hour < SUNSET) return "Sunset";
  if (hour >= SUNSET && hour < SUNSET + 1) return "Dusk";
  return "Night";
}

/** Relative pace: a little slower through dawn and dusk, faster through deep night and midday. */
function paceAt(hour: number) {
  const nearEdge = Math.min(Math.abs(hour - SUNRISE), Math.abs(hour - SUNSET));
  return nearEdge < 1.5 ? 0.55 : nearEdge < 3 ? 0.9 : 1.5;
}

/** One full day, sunrise to sunrise, takes this long on screen. */
const CYCLE_SECONDS = 5;

// Scale the pace so the whole 24 h takes exactly CYCLE_SECONDS: the time
// spent on a slice of the day is dh / (pace × SCALE), integrated over 24 h.
const SCALE = (() => {
  let seconds = 0;
  const step = 0.01;
  for (let h = 0; h < 24; h += step) seconds += step / paceAt(h);
  return seconds / CYCLE_SECONDS;
})();

// Sky colours: [top, middle, horizon] for night, dawn and day.
const NIGHT = [
  [12, 15, 30],
  [24, 22, 40],
  [40, 30, 42],
];
const DAWN = [
  [26, 26, 44],
  [74, 44, 46],
  [232, 146, 84],
];
const DAY = [
  [38, 92, 148],
  [96, 150, 196],
  [236, 214, 170],
];

export function SkyScene() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [clock, setClock] = useState({ hour: 6.25, label: "Before sunrise" });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      h = el.clientHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    // A 3D starfield: each star flies from far (z≈1) to near (z→0).
    const stars: Star[] = Array.from({ length: 420 }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random(),
      tw: Math.random() * Math.PI * 2,
    }));

    // Starts just before sunrise, as in the reference. ?sky=HH.H starts at
    // another time of day — handy for checking every phase of the cycle.
    const asked = Number(new URLSearchParams(window.location.search).get("sky"));
    let hour = Number.isFinite(asked) && asked >= 0 && asked < 24 && asked !== 0 ? asked : 6.25;
    let last = performance.now();
    let raf = 0;
    let lastClock = 0;

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!reduce) hour = (hour + dt * paceAt(hour) * SCALE) % 24;

      const e = elevation(hour); // -1..1
      // 0 at night → 1 at full day; dawn glow peaks as the sun nears the horizon.
      const day = smooth(clamp01((e + 0.12) / 0.6));
      const glow = smooth(clamp01(1 - Math.abs(e + 0.02) / 0.32));
      const starAlpha = 1 - smooth(clamp01((e + 0.18) / 0.3));

      const night2dawn = (i: number) => mix(NIGHT[i], DAWN[i], glow);
      const sky = (i: number) => mix(night2dawn(i), DAY[i], day);

      // Earth: a huge circle whose top arc forms the horizon.
      const earthR = Math.max(w, h) * 1.35;
      const ex = w / 2;
      const ey = h * 0.7 + earthR;
      const horizonY = ey - earthR;

      // ---- sky
      const g = ctx.createLinearGradient(0, 0, 0, horizonY);
      g.addColorStop(0, rgb(sky(0)));
      g.addColorStop(0.55, rgb(sky(1)));
      g.addColorStop(1, rgb(sky(2)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // ---- stars streaming towards the viewer
      if (starAlpha > 0.01) {
        const cx = w / 2;
        const cy = horizonY * 0.55;
        const f = Math.max(w, h) * 0.55;
        for (const s of stars) {
          if (!reduce) s.z -= dt * 0.16;
          if (s.z <= 0.02) {
            s.x = (Math.random() - 0.5) * 2;
            s.y = (Math.random() - 0.5) * 2;
            s.z = 1;
          }
          const px = cx + (s.x / s.z) * f * 0.5;
          const py = cy + (s.y / s.z) * f * 0.5;
          if (px < 0 || px > w || py < 0 || py > horizonY) continue;
          const near = 1 - s.z; // 0 far … 1 close
          const size = 0.35 + near * near * 2.4;
          const twinkle = 0.75 + 0.25 * Math.sin(now / 600 + s.tw);
          const a = starAlpha * twinkle * (0.25 + near * 0.75);
          ctx.beginPath();
          ctx.fillStyle = `rgba(235,238,255,${a})`;
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
          if (near > 0.82) {
            // the closest stars get a soft halo
            ctx.beginPath();
            ctx.fillStyle = `rgba(200,210,255,${a * 0.18})`;
            ctx.arc(px, py, size * 3.2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      // ---- the sun, orbiting the Earth (drawn before it, so it sets behind)
      // An ellipse around the Earth in screen space: rises on the right (as
      // in the reference), crosses overhead at noon, sets on the left, then
      // passes underneath — hidden by the Earth, which is drawn after it.
      const angle = ((hour - NOON) / 24) * Math.PI * 2;
      const rx = w * 0.42;
      const ry = horizonY * 0.82;
      const pivotY = horizonY + ry * 0.12;
      const sx = w / 2 - Math.sin(angle) * rx;
      const sy = pivotY - Math.cos(angle) * ry;
      const sr = Math.max(26, Math.min(w, h) * 0.055);
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.4);
      sg.addColorStop(0, "rgba(255,248,226,1)");
      sg.addColorStop(0.22, "rgba(255,214,150,0.95)");
      sg.addColorStop(0.42, "rgba(255,170,90,0.35)");
      sg.addColorStop(1, "rgba(255,140,60,0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(sx, sy, sr * 3.4, 0, Math.PI * 2);
      ctx.fill();

      // ---- warm haze along the horizon, strongest near the sun
      const haze = ctx.createRadialGradient(sx, horizonY, 0, sx, horizonY, w * 0.9);
      haze.addColorStop(0, `rgba(255,170,90,${0.35 * glow + 0.08 * day})`);
      haze.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, w, h);

      // ---- the Earth
      const eg = ctx.createLinearGradient(0, horizonY, 0, h);
      eg.addColorStop(0, rgb(mix([12, 22, 26], [20, 44, 40], day)));
      eg.addColorStop(1, rgb(mix([4, 9, 11], [8, 20, 18], day)));
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.arc(ex, ey, earthR, 0, Math.PI * 2);
      ctx.fill();

      // atmosphere rim: a thin bright line plus a soft glow above it
      ctx.save();
      ctx.beginPath();
      ctx.arc(ex, ey, earthR, Math.PI, 2 * Math.PI);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = `rgba(255,205,120,${0.45 + 0.5 * glow})`;
      ctx.shadowColor = `rgba(255,170,80,${0.6 * glow + 0.2})`;
      ctx.shadowBlur = 18;
      ctx.stroke();
      ctx.restore();

      // the clock follows the sun (updated a few times a second, not every frame)
      if (now - lastClock > 60) {
        lastClock = now;
        setClock({ hour, label: phaseLabel(hour) });
      }

      if (!reduce) raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    const onVisible = () => {
      if (document.hidden) cancelAnimationFrame(raf);
      else if (!reduce) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const hh = Math.floor(clock.hour);
  const mm = Math.floor((clock.hour - hh) * 60);
  // Dot on the little sun arc: left = sunrise, top = noon, right = sunset;
  // parked at the left/right ends overnight.
  const progress = clamp01((clock.hour - SUNRISE) / (SUNSET - SUNRISE));
  const above = clock.hour >= SUNRISE && clock.hour <= SUNSET;
  const a = Math.PI * (1 - progress);
  const dotX = 30 + Math.cos(a) * 26;
  const dotY = 30 - (above ? Math.sin(a) * 24 : 0);

  return (
    <div className="sky">
      <canvas ref={canvas} aria-hidden="true" />
      <div className="sky-clock" aria-hidden="true">
        <svg width="62" height="36" viewBox="0 0 62 36">
          <path d="M4 30 A26 24 0 0 1 56 30" fill="none" stroke="rgba(255,255,255,.35)" strokeDasharray="2 3" />
          <path d="M0 30 H60" stroke="rgba(255,255,255,.35)" />
          <circle cx={dotX} cy={dotY} r="3.2" fill={above ? "#ffd27a" : "#cfd3dc"} />
        </svg>
        <div>
          <b>
            {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}
          </b>
          <small>{clock.label}</small>
        </div>
      </div>
      <div className="sky-copy">
        <h2>
          Rooftop solar,
          <br />
          tracked to the day.
        </h2>
        <p>Milestones from panels to SP turn-on · GPS site check-in · Handover signed on any device</p>
      </div>
    </div>
  );
}
