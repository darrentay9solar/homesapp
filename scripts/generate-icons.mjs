/**
 * Renders the 9 Solar Home mark into the PNGs a home-screen install needs:
 * `npm run icons`.
 *
 * The artwork is vector, so every size is sharp rather than an upscale. Run it
 * again if the mark changes; the outputs are committed so the build needs no
 * image tooling.
 *
 * Three variants, because platforms differ:
 *   any       transparent-free square, used by Android for legacy launchers
 *   maskable  Android crops this to a circle/squircle, so the mark sits inside
 *             the 80% safe zone or it loses its edges
 *   apple     iOS ignores transparency and composites onto black, so the
 *             background is drawn explicitly and corners are left square —
 *             iOS rounds them itself
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import sharp from "sharp";

const BRAND = "#16C47F";
const INK = "#08090A";

/**
 * The mark is authored on a 120-unit grid, matching the Flutter painter, but
 * it does not fill that grid: the roof spans x 18–102 and the artwork runs
 * y 18–100, with half a stroke beyond. Scaling the *grid* therefore left a
 * wide invisible margin and the icon read as small. These are the real ink
 * bounds, so markScale now means what it says — the fraction of the tile the
 * visible mark occupies.
 */
const BOX = { x: 15.5, y: 15.5, w: 89, h: 87 };

/**
 * @param {number} size      output pixel size
 * @param {number} markScale fraction of the canvas the visible mark occupies
 */
function svg(size, markScale) {
  // Fit the longer side so the aspect ratio is preserved.
  const scale = (size * markScale) / Math.max(BOX.w, BOX.h);
  const cx = BOX.x + BOX.w / 2;
  const cy = BOX.y + BOX.h / 2;
  const t = `translate(${(size / 2 - cx * scale).toFixed(2)}, ${(size / 2 - cy * scale).toFixed(2)}) scale(${scale.toFixed(4)})`;

  const rays = Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI * 2 / 8) * i - Math.PI / 2;
    const cx = 60;
    const cy = 66;
    const x1 = cx + Math.cos(angle) * 27;
    const y1 = cy + Math.sin(angle) * 27;
    const x2 = cx + Math.cos(angle) * 34;
    const y2 = cy + Math.sin(angle) * 34;
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke-width="3.4"/>`;
  }).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${INK}"/>
  <g transform="${t}" fill="none" stroke="${BRAND}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 52 L60 18 L102 52" stroke-width="4.5"/>
    <circle cx="60" cy="66" r="21" stroke-width="4"/>
    <path d="M63 55 L54 68 L61 68 L58 78 L67 65 L60 65 Z" fill="${BRAND}" stroke="none"/>
    ${rays}
  </g>
</svg>`;
}

const outputs = [
  // Android / manifest: fill the tile, leaving only a small optical margin.
  { file: "icon-192.png", size: 192, markScale: 0.86 },
  { file: "icon-512.png", size: 512, markScale: 0.86 },
  // Maskable is the one that must stay modest: Android crops to a circle or
  // squircle and guarantees only the centre 80% survives. 0.66 keeps the roof
  // line and the outer rays intact under the most aggressive crop.
  { file: "icon-maskable-512.png", size: 512, markScale: 0.66 },
  // iOS rounds the corners itself, so the mark can run close to the edge.
  { file: "apple-icon.png", size: 180, markScale: 0.88 },
  // A tab favicon is tiny; it needs every pixel.
  { file: "favicon-32.png", size: 32, markScale: 0.94 },
];

const publicDir = resolve(process.cwd(), "public");
await mkdir(publicDir, { recursive: true });

for (const { file, size, markScale } of outputs) {
  const buffer = Buffer.from(svg(size, markScale));
  const png = await sharp(buffer).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(resolve(publicDir, file), png);
  console.log(`  ${file.padEnd(24)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
}

console.log("\n  Icons written to public/\n");
