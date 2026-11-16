// Ebenen (Relief): Bereiche des Mosaiks stehen 1–3 Plattenhöhen über dem Rest.
// Unter einer erhöhten Zelle liegen pro Stufe Platten ("Sockel"), die auf der Stufe darunter
// bzw. auf dem Unterbau sitzen. DOM-frei, getestet.
import { LEGO_COLORS } from './colors.js';
import { SECTION } from './parts.js';
import { PLATES } from './substructure.js';
import { components, colorLab } from './pieces.js';
import { rgbToLab } from './mosaic.js';

export const MAX_LEVEL = 3;

// Plattengrößen nach Fläche absteigend, beide Ausrichtungen
const SHAPES = PLATES.flatMap(p => (p.a === p.b ? [[p.a, p.b, p]] : [[p.a, p.b, p], [p.b, p.a, p]]))
  .sort((x, y) => y[0] * y[1] - x[0] * x[1] || Math.abs(x[0] - x[1]) - Math.abs(y[0] - y[1]));

/**
 * Plant die Sockelplatten aller Stufen.
 * Stufe k bedeckt alle Zellen mit height ≥ k. Platten bleiben innerhalb eines 16er-Abschnitts
 * (die Anleitung baut abschnittsweise). Gierig: an der ersten freien Zelle die größte passende Platte.
 * @param project {cols, rows, grid, height, riserColorId} – riserColorId: LEGO-Farb-ID oder 'match' (Farbe der Oberfläche)
 * @returns Array<{level, x, y, w, h, part, colorIndex}>
 */
export function planRisers(project) {
  const { cols, rows, grid, height } = project;
  if (!height || !grid) return [];
  const match = project.riserColorId === 'match';
  const fixed = Math.max(0, LEGO_COLORS.findIndex(c => c.legoId === (match ? 26 : project.riserColorId ?? 26)));
  const out = [];
  for (let level = 1; level <= MAX_LEVEL; level++) {
    const need = i => height[i] >= level;
    if (!height.some(h => h >= level)) break;
    const done = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (done[i] || !need(i)) continue;
      const col = match ? grid[i] : fixed;
      const secR = (Math.floor(x / SECTION) + 1) * SECTION, secB = (Math.floor(y / SECTION) + 1) * SECTION;
      const fits = (w, h) => {
        if (x + w > Math.min(cols, secR) || y + h > Math.min(rows, secB)) return false;
        for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
          const j = (y + dy) * cols + x + dx;
          if (done[j] || !need(j) || (match && grid[j] !== col)) return false;
        }
        return true;
      };
      const [w, h, part] = SHAPES.find(([w, h]) => fits(w, h));
      for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) done[(y + dy) * cols + x + dx] = 1;
      out.push({ level, x, y, w, h, part, colorIndex: col });
    }
  }
  return out;
}

/** Zählt Sockelplatten je (Platte, Farbe). */
export function countRisers(risers) {
  const m = new Map();
  for (const r of risers) {
    const k = `${r.part.blId}|${r.colorIndex}`;
    const it = m.get(k) || { part: r.part, colorIndex: r.colorIndex, count: 0 };
    it.count++; m.set(k, it);
  }
  return [...m.values()].sort((a, b) => b.part.a * b.part.b - a.part.a * a.part.b || b.count - a.count);
}

/**
 * Schlägt Ebenen vor: Was sich farblich deutlich vom Hintergrund abhebt, kommt nach vorne.
 * Hintergrund = größte zusammenhängende Farbfläche. Entschieden wird je zusammenhängender Farbfläche,
 * damit Stufenkanten den Konturen folgen; winzige Flächen übernehmen die Stufe ihrer Nachbarn.
 * @param strength 0..100 (0 = alles flach; höher = mehr und höhere Stufen)
 * @param srcRgb optional Fotofarben je Zelle (sonst LEGO-Farben)
 */
export function autoDepth(grid, cols, rows, strength, srcRgb = null) {
  const n = cols * rows, height = new Uint8Array(n);
  if (strength <= 0) return height;
  const pal = colorLab();
  const lab = srcRgb
    ? Array.from({ length: n }, (_, i) => rgbToLab(srcRgb[i * 3], srcRgb[i * 3 + 1], srcRgb[i * 3 + 2]))
    : Array.from(grid, c => pal[c]);
  // Hintergrund = größte zusammenhängende Farbfläche (robuster als der Bildrand, der oft ein Rahmen ist)
  const { label, sizes } = components(grid, cols, rows);
  const big = sizes.indexOf(Math.max(...sizes));
  const bg = [0, 0, 0];
  for (let i = 0; i < n; i++) if (label[i] === big) for (let k = 0; k < 3; k++) bg[k] += lab[i][k] / sizes[big];
  // Abstand je Farbfläche (Mittel über die Fläche)
  const sum = new Float64Array(sizes.length);
  for (let i = 0; i < n; i++) sum[label[i]] += Math.sqrt((lab[i][0] - bg[0]) ** 2 + (lab[i][1] - bg[1]) ** 2 + (lab[i][2] - bg[2]) ** 2);
  const t = strength / 100;
  const t1 = 45 - 30 * t;          // ab diesem ΔE: Stufe 1 (45 … 15)
  const step = 22 - 8 * t;         // je weitere Stufe
  const maxLevel = t < 0.34 ? 1 : t < 0.67 ? 2 : 3;
  const lvl = Array.from(sum, (s, l) => {
    const d = s / sizes[l];
    return d < t1 ? 0 : Math.min(maxLevel, 1 + Math.floor((d - t1) / step));
  });
  for (let i = 0; i < n; i++) height[i] = lvl[label[i]];
  // Kleine Flächen (< 4 Zellen) übernehmen die häufigste Stufe ihrer Nachbarn
  for (let i = 0; i < n; i++) {
    if (sizes[label[i]] >= 4) continue;
    const x = i % cols, cnt = [0, 0, 0, 0];
    for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
      if (j >= 0 && j < n && label[j] !== label[i]) cnt[lvl[label[j]]]++;
    }
    const best = cnt.indexOf(Math.max(...cnt));
    if (cnt[best] > 0) height[i] = best;
  }
  return height;
}
