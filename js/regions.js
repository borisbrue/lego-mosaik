// Bereiche: das Bild in zusammenhängende, farblich ähnliche Bereiche zerlegen (Titel, Gesicht,
// Himmel, Rahmen …), die sich einzeln ausblenden, anheben oder umfärben lassen. DOM-frei, getestet.
import { rgbToLab } from './mosaic.js';

/**
 * Graphbasierte Segmentierung (Felzenszwalb/Huttenlocher) auf dem Zellraster.
 * Kanten = 4er-Nachbarn mit Gewicht ΔE76 der Fotofarben. Zwei Bereiche verschmelzen, wenn die
 * verbindende Kante nicht stärker ist als die innere Streuung beider Bereiche plus k/Größe.
 * @param px Float32Array RGB je Zelle
 * @param detail 0..100 (höher = feiner, mehr Bereiche)
 * @returns {{label: Int32Array, regions: Array<{id, size, rgb, cx, cy}>}} – ids nach Größe absteigend (0 = größter)
 */
export function segment(px, cols, rows, detail = 50) {
  const n = cols * rows;
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) lab.set(rgbToLab(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]), i * 3);
  const dist = (a, b) => Math.sqrt((lab[a * 3] - lab[b * 3]) ** 2 + (lab[a * 3 + 1] - lab[b * 3 + 1]) ** 2 + (lab[a * 3 + 2] - lab[b * 3 + 2]) ** 2);
  // Kanten
  const ea = new Int32Array(2 * n), eb = new Int32Array(2 * n), ew = new Float32Array(2 * n);
  let m = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (x + 1 < cols) { ea[m] = i; eb[m] = i + 1; ew[m] = dist(i, i + 1); m++; }
    if (y + 1 < rows) { ea[m] = i; eb[m] = i + cols; ew[m] = dist(i, i + cols); m++; }
  }
  const order = Array.from({ length: m }, (_, e) => e).sort((a, b) => ew[a] - ew[b]);
  // Union-Find
  const parent = Int32Array.from({ length: n }, (_, i) => i), size = new Int32Array(n).fill(1), inner = new Float32Array(n);
  const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b, w) => {
    if (size[a] < size[b]) [a, b] = [b, a];
    parent[b] = a; size[a] += size[b]; inner[a] = Math.max(inner[a], inner[b], w);
    return a;
  };
  const k = 15 + (100 - detail) * 4.5;
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a === b) continue;
    const w = ew[e];
    if (w <= Math.min(inner[a] + k / size[a], inner[b] + k / size[b])) union(a, b, w);
  }
  // Zu kleine Bereiche mit dem ähnlichsten Nachbarn verschmelzen
  const minSize = Math.max(3, Math.round(n / (400 + detail * 16)));
  for (const e of order) {
    const a = find(ea[e]), b = find(eb[e]);
    if (a !== b && (size[a] < minSize || size[b] < minSize)) union(a, b, ew[e]);
  }
  // Durchnummerieren nach Größe
  const roots = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = roots.get(r);
    if (!g) { g = { size: 0, rgb: [0, 0, 0], sx: 0, sy: 0 }; roots.set(r, g); }
    g.size++; g.sx += i % cols; g.sy += (i / cols) | 0;
    for (let c = 0; c < 3; c++) g.rgb[c] += px[i * 3 + c];
  }
  const sorted = [...roots.entries()].sort((a, b) => b[1].size - a[1].size);
  const idOf = new Map(sorted.map(([r], id) => [r, id]));
  const label = new Int32Array(n);
  for (let i = 0; i < n; i++) label[i] = idOf.get(find(i));
  const regions = sorted.map(([, g], id) => ({
    id, size: g.size, rgb: g.rgb.map(v => Math.round(v / g.size)), cx: g.sx / g.size, cy: g.sy / g.size,
  }));
  return { label, regions };
}

/** Zelle des Bereichs, die seinem Schwerpunkt am nächsten liegt (als Ankerpunkt, normiert 0..1). */
export function regionAnchor(seg, cols, rows, id) {
  const r = seg.regions[id];
  let best = -1, bestD = Infinity;
  for (let i = 0; i < seg.label.length; i++) {
    if (seg.label[i] !== id) continue;
    const d = (i % cols - r.cx) ** 2 + (((i / cols) | 0) - r.cy) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return { x: ((best % cols) + 0.5) / cols, y: (((best / cols) | 0) + 0.5) / rows };
}

/** Bereich unter einem normierten Punkt. */
export function regionAt(seg, cols, rows, x, y) {
  const cx = Math.min(cols - 1, Math.max(0, Math.floor(x * cols)));
  const cy = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)));
  return seg.label[cy * cols + cx];
}

/** Bereich `id` – mit similar=true zusätzlich alle Bereiche mit ähnlicher Durchschnittsfarbe (ΔE < 14). */
export function regionGroup(seg, id, similar = false) {
  if (!similar) return new Set([id]);
  const lab = seg.regions[id].lab || (seg.regions[id].lab = rgbToLab(...seg.regions[id].rgb));
  const out = new Set();
  for (const r of seg.regions) {
    const l = r.lab || (r.lab = rgbToLab(...r.rgb));
    if (Math.sqrt((l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2) < 14) out.add(r.id);
  }
  return out;
}

/**
 * Wendet die Bereichs-Aktionen auf das Farbraster an.
 * ops: [{x, y, similar?, hide?, color?, level?}] – Ankerpunkt normiert, color = Farbindex, level = 0..3,
 * similar = auch alle farblich ähnlichen Bereiche (z. B. alle Buchstaben eines Titels)
 * Ausblenden füllt den Bereich mit der häufigsten Farbe direkt um ihn herum.
 * @returns {{hidden: Uint8Array, levels: Int8Array}} – levels: -1 = automatisch
 */
export function applyRegionOps(grid, cols, rows, seg, ops = []) {
  const n = cols * rows, hidden = new Uint8Array(n), levels = new Int8Array(n).fill(-1);
  for (const op of ops) {
    const ids = regionGroup(seg, regionAt(seg, cols, rows, op.x, op.y), op.similar);
    const cells = [];
    for (let i = 0; i < n; i++) if (ids.has(seg.label[i])) cells.push(i);
    if (op.hide) {
      const inside = new Uint8Array(n);
      for (const i of cells) inside[i] = 1;
      const cnt = new Map();
      for (const i of cells) {
        const x = i % cols;
        for (const j of [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols]) {
          if (j >= 0 && j < n && !inside[j]) cnt.set(grid[j], (cnt.get(grid[j]) || 0) + 1);
        }
      }
      let fill = grid[cells[0]], bestN = 0;
      for (const [c, k] of cnt) if (k > bestN) { bestN = k; fill = c; }
      for (const i of cells) { grid[i] = fill; hidden[i] = 1; }
    } else if (op.color !== undefined && op.color !== null) {
      for (const i of cells) grid[i] = op.color;
    }
    if (op.level !== undefined && op.level !== null) for (const i of cells) levels[i] = op.level;
  }
  return { hidden, levels };
}
