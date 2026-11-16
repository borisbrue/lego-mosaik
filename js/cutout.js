// Scherenschnitt: das Bild auf einem feinen Teilraster (S×S Teilpixel je Noppe) in wenige flache
// Farbflächen mit glatten Umrissen zerlegen. Daraus entstehen die Steine; Formteile werden an den
// glatten Umrissen ausgerichtet statt am Pixelrauschen. DOM-frei, getestet.
import { LEGO_COLORS } from './colors.js';
import { rgbToLab, nearestColor, smoothCells, hexToRgb } from './mosaic.js';
import { simplify } from './pieces.js';

/** Mehrheitsfilter 3×3 (in place): jede Zelle nimmt die häufigste Farbe ihrer Umgebung; bei Gleichstand bleibt sie. */
export function modeFilter(g, W, H, iterations = 1) {
  const counts = new Uint16Array(256), seen = new Uint8Array(9);
  for (let it = 0; it < iterations; it++) {
    const src = Uint8Array.from(g);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const own = src[y * W + x];
      // schneller Weg: alle 4 Nachbarn gleich → bleibt
      if ((x === 0 || src[y * W + x - 1] === own) && (x === W - 1 || src[y * W + x + 1] === own)
        && (y === 0 || src[(y - 1) * W + x] === own) && (y === H - 1 || src[(y + 1) * W + x] === own)) continue;
      let ns = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const c = src[ny * W + nx];
        if (!counts[c]) seen[ns++] = c;
        counts[c]++;
      }
      let best = own;
      for (let k = 0; k < ns; k++) if (counts[seen[k]] > counts[best]) best = seen[k];
      g[y * W + x] = best;
      for (let k = 0; k < ns; k++) counts[seen[k]] = 0;
    }
  }
  return g;
}

/**
 * Scherenschnitt auf dem Teilraster.
 * @param subRgb Float32Array RGB, W × H Teilpixel
 * @param idx    erlaubte Farben (Indizes in LEGO_COLORS)
 * @param prepared Palette zu idx (preparePalette)
 * @param strength 1..100 (höher = gröber: größere Mindestflächen, rundere Umrisse)
 * @returns Uint8Array Farbindex (LEGO_COLORS) je Teilpixel
 */
export function cutout(subRgb, W, H, idx, prepared, strength) {
  const t = Math.min(1, Math.max(0, strength / 100));
  const px = Float32Array.from(subRgb);
  smoothCells(px, W, H, 0.35 + 0.65 * t);
  if (t > 0.3) smoothCells(px, W, H, t);
  const g = new Uint8Array(W * H), cache = new Map();
  for (let i = 0; i < W * H; i++) {
    const r = px[i * 3], gg = px[i * 3 + 1], b = px[i * 3 + 2];
    const key = (Math.round(r / 4) << 12) | (Math.round(gg / 4) << 6) | Math.round(b / 4); // 64 Stufen je Kanal
    let c = cache.get(key);
    if (c === undefined) { c = idx[nearestColor(rgbToLab(r, gg, b), prepared)]; cache.set(key, c); }
    g[i] = c;
  }
  const minSize = Math.max(6, Math.round(6 + t ** 1.5 * W * H / 120));
  simplify(g, W, H, minSize);
  modeFilter(g, W, H, 1 + Math.round(t * 6));
  simplify(g, W, H, minSize);
  return g;
}

/** Steinfarben: Mehrheit der S×S Teilpixel je Zelle. */
export function cellsFromCutout(g, cols, rows, S) {
  const W = cols * S, grid = new Uint8Array(cols * rows), counts = new Uint16Array(256);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const seen = [];
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = g[(y * S + sy) * W + x * S + sx];
      if (!counts[c]) seen.push(c);
      counts[c]++;
    }
    let best = seen[0];
    for (const c of seen) if (counts[c] > counts[best]) best = c;
    grid[y * cols + x] = best;
    for (const c of seen) counts[c] = 0;
  }
  return grid;
}

/** Scherenschnitt als RGB (LEGO-Farben) – Vorlage für die Formteile. */
export function cutoutRgb(g) {
  const out = new Float32Array(g.length * 3), rgb = LEGO_COLORS.map(c => hexToRgb(c.hex));
  for (let i = 0; i < g.length; i++) out.set(rgb[g[i]], i * 3);
  return out;
}
