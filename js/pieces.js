// Teile-Logik (DOM-frei, getestet): Formen je Zelle, halbe Noppen, lange Fliesen, Stückliste.
import { LEGO_COLORS } from './colors.js';
import {
  STUD_PARTS, SHAPE_KEYS, SHAPE_PLATE, SHAPE_TILE, SHAPE_INDEX, LONG_TILES, OVERLAY_PARTS, SECTION,
  overlayCode, overlayKind, overlayRot, overlaySize, OVERLAY_COVERED,
} from './parts.js';
import { hexToRgb, rgbToLab } from './mosaic.js';

// ---------- Geometrie der halben Noppen (Einheitsquadrat 0..1, y nach unten) ----------

// Drehung um 90° im Uhrzeigersinn um die Zellmitte
const rotCW = ([x, y]) => [1 - y, x];
const rotCCW = ([x, y]) => [y, 1 - x];
const fmt = v => +v.toFixed(4);

/** Liegt der Punkt (x, y) – normiert auf die Grundfläche des Teils, 0..1 – im Teil `code`? */
export function overlayContains(code, x, y) {
  let p = [x, y];
  for (let r = overlayRot(code); r > 0; r--) p = rotCCW(p);
  const [u, v] = p, kind = overlayKind(code);
  if (kind === 0 || kind === 3) return u * u + v * v <= 1;                // Viertelkreis, Ecke oben links
  if (kind === 2) return u + v <= 1;                                      // Dreieck, rechter Winkel oben links
  return v <= 0.5 || (u - 0.5) ** 2 + (v - 0.5) ** 2 <= 0.25;             // Halbkreis, gerade Kante oben
}

/** SVG-Pfad des Teils im Einheitsquadrat (für SVG und Canvas/Path2D). */
export function overlayPath(code) {
  const kind = overlayKind(code), rot = overlayRot(code);
  const pt = p => { for (let r = 0; r < rot; r++) p = rotCW(p); return `${fmt(p[0])} ${fmt(p[1])}`; };
  if (kind === 0 || kind === 3) return `M${pt([0, 0])} L${pt([1, 0])} A1 1 0 0 1 ${pt([0, 1])} Z`;
  if (kind === 2) return `M${pt([0, 0])} L${pt([1, 0])} L${pt([0, 1])} Z`;
  return `M${pt([0, 0])} L${pt([1, 0])} L${pt([1, 0.5])} A0.5 0.5 0 0 1 ${pt([0, 0.5])} Z`;
}

/** Punkt, an dem die Nummer im Teil bzw. in der freien Ecke steht. */
export function overlayLabelPoints(code) {
  const rot = overlayRot(code);
  const turn = p => { for (let r = 0; r < rot; r++) p = rotCW(p); return p; };
  const kind = overlayKind(code);
  if (kind === 0) return { top: turn([0.36, 0.36]), base: turn([0.86, 0.86]) };
  if (kind === 2) return { top: turn([0.27, 0.27]), base: turn([0.78, 0.78]) };
  if (kind === 3) return { top: turn([0.3, 0.3]), base: turn([0.88, 0.88]) };
  return { top: turn([0.5, 0.42]), base: turn([0.11, 0.89]) };
}

const maskCache = new Map();
/** Bedeckungsanteil je Teilpixel bei S×S Teilpixeln pro Zelle (Maske über die ganze Grundfläche, (S·size)²). */
export function overlayMask(code, S) {
  const k = `${code}|${S}`;
  if (maskCache.has(k)) return maskCache.get(k);
  const T = S * overlaySize(code), m = new Float32Array(T * T), Q = 8;
  for (let sy = 0; sy < T; sy++) for (let sx = 0; sx < T; sx++) {
    let n = 0;
    for (let qy = 0; qy < Q; qy++) for (let qx = 0; qx < Q; qx++) {
      if (overlayContains(code, (sx + (qx + 0.5) / Q) / T, (sy + (qy + 0.5) / Q) / T)) n++;
    }
    m[sy * T + sx] = n / (Q * Q);
  }
  maskCache.set(k, m);
  return m;
}
export const ALL_OVERLAY_CODES = OVERLAY_PARTS.flatMap((_, k) => [0, 1, 2, 3].map(r => overlayCode(k, r)));
export const SMALL_CODES = ALL_OVERLAY_CODES.filter(c => overlaySize(c) === 1);
const BIG_CODES = ALL_OVERLAY_CODES.filter(c => overlaySize(c) === 2);
// Formteile nur an echten Konturen: Teil und Untergrund müssen sich deutlich unterscheiden (ΔE76),
// sonst entsteht zwischen ähnlichen Farben ein unruhiges Muster statt einer Kante.
const MIN_CONTRAST2 = 28 * 28;

// ---------- Farben ----------
let labCache = null;
export function colorLab() {
  if (!labCache) labCache = LEGO_COLORS.map(c => rgbToLab(...hexToRgb(c.hex)));
  return labCache;
}
const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// ---------- Flächen vereinfachen ----------
/** Zusammenhängende Flächen gleicher Farbe (4er-Nachbarschaft): Label je Zelle und Größe je Label. */
export function components(grid, cols, rows) {
  const n = cols * rows, label = new Int32Array(n).fill(-1), sizes = [], stack = new Int32Array(n);
  for (let s = 0; s < n; s++) {
    if (label[s] >= 0) continue;
    const id = sizes.length, v = grid[s];
    let size = 0, top = 0;
    label[s] = id; stack[top++] = s;
    while (top) {
      const i = stack[--top]; size++;
      const x = i % cols;
      let j;
      if (x > 0 && label[j = i - 1] < 0 && grid[j] === v) { label[j] = id; stack[top++] = j; }
      if (x < cols - 1 && label[j = i + 1] < 0 && grid[j] === v) { label[j] = id; stack[top++] = j; }
      if (i >= cols && label[j = i - cols] < 0 && grid[j] === v) { label[j] = id; stack[top++] = j; }
      if (i + cols < n && label[j = i + cols] < 0 && grid[j] === v) { label[j] = id; stack[top++] = j; }
    }
    sizes.push(size);
  }
  return { label, sizes };
}

/**
 * Verschmilzt Farbinseln mit weniger als `minSize` Steinen mit der Nachbarfläche,
 * die am längsten angrenzt und farblich am ähnlichsten ist (in place).
 * Dünne, aber zusammenhängende Linien (Schrift, Kanten) bleiben erhalten, weil sie
 * als Ganzes zählen. Kleine Inseln werden zuerst verschmolzen.
 * Kontrastschutz: eine Insel mit mindestens `keepMin` Steinen, die sich von allen Nachbarn um
 * mindestens `keepContrast` (ΔE76) abhebt (Augen, Lichter, Schrift), bleibt stehen – auf kleinen
 * Formaten sind das oft die Details, an denen man das Motiv erkennt.
 * @returns Anzahl geänderter Steine
 */
export function simplify(grid, cols, rows, minSize, { keepContrast = 0, keepMin = 2 } = {}) {
  if (minSize < 2) return 0;
  const keep2 = keepContrast > 0 ? keepContrast * keepContrast : Infinity;
  const pal = colorLab();
  let changed = 0;
  for (let s = 2; s <= minSize; s = s < 6 ? s + 1 : Math.ceil(s * 1.7)) {
    const lim = Math.min(s, minSize);
    const { label, sizes } = components(grid, cols, rows);
    const cells = new Map();
    for (let i = 0; i < label.length; i++) if (sizes[label[i]] < lim) {
      const l = label[i]; if (!cells.has(l)) cells.set(l, []); cells.get(l).push(i);
    }
    if (!cells.size) { if (lim === minSize) break; continue; }
    const order = [...cells.keys()].sort((a, b) => sizes[a] - sizes[b]);
    const n = grid.length, border = new Float64Array(256), touched = [];
    for (const l of order) {
      const list = cells.get(l), own = grid[list[0]];
      const add = c => { if (c !== own) { if (!border[c]) touched.push(c); border[c]++; } };
      for (const i of list) {
        const x = i % cols;
        if (x > 0) add(grid[i - 1]);
        if (x < cols - 1) add(grid[i + 1]);
        if (i >= cols) add(grid[i - cols]);
        if (i + cols < n) add(grid[i + cols]);
      }
      let best = -1, bestS = 0, minD2 = Infinity;
      for (const c of touched) {
        const d2 = dist2(pal[own], pal[c]);
        if (d2 < minD2) minD2 = d2;
        const sc = border[c] / (1 + Math.sqrt(d2) / 15);
        if (sc > bestS) { bestS = sc; best = c; }
        border[c] = 0;
      }
      touched.length = 0;
      if (best < 0 || (list.length >= keepMin && minD2 >= keep2)) continue;
      for (const i of list) grid[i] = best;
      changed += list.length;
    }
    if (lim === minSize) break;
  }
  return changed;
}

// ---------- Eckig/rund automatisch ----------
/**
 * Setzt in Konturzellen die Kanten-Form, sonst die Flächen-Form.
 * Kontur = ein 4er-Nachbar mit anderer LEGO-Farbe UND deutlich anderer Fotofarbe (ΔE76 > Schwelle).
 * Die Fotofarbe verhindert, dass Farbstufen in weichen Verläufen als Kontur gelten.
 * @param sensitivity 0..100 (100 = schon kleine Farbunterschiede sind Kontur)
 * @param srcRgb optional Float32Array RGB je Zelle (Foto vor der Farbzuordnung)
 */
export function autoShapes(grid, cols, rows, { area = 'plate-round', edge = 'tile', sensitivity = 50, minRegion = 3 } = {}, srcRgb = null) {
  const a = SHAPE_INDEX[area], e = edge === 'same' ? a : SHAPE_INDEX[edge];
  const out = new Uint8Array(cols * rows).fill(a);
  if (a === e) return out;
  // Kontur nur zwischen echten Flächen, nicht an verstreuten Einzelsteinen (sonst Schachbrett)
  const { label, sizes } = components(grid, cols, rows);
  const solid = i => sizes[label[i]] >= minRegion;
  const pal = colorLab();
  const lab = srcRgb
    ? Array.from({ length: cols * rows }, (_, i) => rgbToLab(srcRgb[i * 3], srcRgb[i * 3 + 1], srcRgb[i * 3 + 2]))
    : Array.from(grid, c => pal[c]);
  const thr2 = (40 - 0.32 * sensitivity) ** 2; // 40 … 8 ΔE
  const differs = (i, j) => grid[i] !== grid[j] && solid(i) && solid(j) && dist2(lab[i], lab[j]) > thr2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if ((x + 1 < cols && differs(i, i + 1)) || (x > 0 && differs(i, i - 1))
      || (y + 1 < rows && differs(i, i + cols)) || (y > 0 && differs(i, i - cols))) out[i] = e;
  }
  return out;
}

// ---------- Halbe Noppen ----------
/**
 * Sucht Zellen, die mit einer 1×1-Platte (Grundfarbe) + Viertel-/Halbkreis-Fliese (zweite Farbe)
 * das Foto deutlich genauer treffen als mit einem einfarbigen Stein.
 * @param subRgb  Float32Array RGB, (cols·S) × (rows·S) Teilpixel
 * @param grid    Farbindizes (wird bei Bedarf geändert: Grundfarbe kann wechseln)
 * @param strength 0..100 (0 = aus)
 * @returns {{overlay: Uint8Array, overlayColor: Uint8Array, count: number}}
 */
export function computeOverlays(subRgb, grid, cols, rows, S, strength, blocked = null, { keep: keepMax = null } = {}) {
  const n = cols * rows;
  const overlay = new Uint8Array(n), overlayColor = new Uint8Array(n);
  if (strength <= 0) return { overlay, overlayColor, count: 0 };
  const lab = colorLab();
  const W = cols * S, SS = S * S;
  const t = strength / 100;
  // Anteil des Fehlers, der höchstens übrig bleiben darf (Grafik: streng, nur fast exakte Treffer)
  const keep = keepMax ?? 0.8 - 0.4 * t;
  const minGain = 150 - 120 * t;   // Mindestgewinn je Teilpixel (ΔE², 150 ≈ ΔE 12 … 30 ≈ ΔE 5,5)
  const minSpread = 200 - 120 * t; // Mindest-Streuung in der Zelle (ΔE², ≈ ΔE 14 … 9)
  const masks = SMALL_CODES.map(c => [c, overlayMask(c, S)]);
  const sub = new Array(SS);
  let count = 0;
  const src = Uint8Array.from(grid);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, A = src[i];
    if (blocked && blocked[i]) continue;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const o = ((y * S + sy) * W + x * S + sx) * 3;
      sub[sy * S + sx] = rgbToLab(subRgb[o], subRgb[o + 1], subRgb[o + 2]);
    }
    const LA = lab[A];
    let e1 = 0;
    for (let s = 0; s < SS; s++) e1 += dist2(sub[s], LA);
    if (e1 / SS < minGain) continue;
    // Nur Zellen mit echter Kante im Foto (Streuung der Teilpixel), nicht bloß Farbstufen im Verlauf
    const mean = [0, 0, 0];
    for (let s = 0; s < SS; s++) { mean[0] += sub[s][0] / SS; mean[1] += sub[s][1] / SS; mean[2] += sub[s][2] / SS; }
    let spread = 0;
    for (let s = 0; s < SS; s++) spread += dist2(sub[s], mean) / SS;
    if (spread < minSpread) continue;
    // Kandidaten: Farben der 8 Nachbarn
    const cand = new Set();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if ((dx || dy) && nx >= 0 && ny >= 0 && nx < cols && ny < rows && src[ny * cols + nx] !== A) cand.add(src[ny * cols + nx]);
    }
    let best = null, bestE = e1 * keep;
    for (const B of cand) {
      const LB = lab[B];
      if (dist2(LA, LB) < MIN_CONTRAST2) continue;
      for (const [base, top, Lb, Lt] of [[A, B, LA, LB], [B, A, LB, LA]]) {
        for (const [code, m] of masks) {
          let e = 0;
          for (let s = 0; s < SS && e < bestE; s++) {
            const f = m[s], g = 1 - f;
            e += (sub[s][0] - (f * Lt[0] + g * Lb[0])) ** 2 + (sub[s][1] - (f * Lt[1] + g * Lb[1])) ** 2 + (sub[s][2] - (f * Lt[2] + g * Lb[2])) ** 2;
          }
          if (e < bestE) { bestE = e; best = { base, top, code }; }
        }
      }
    }
    if (best && (e1 - bestE) / SS >= minGain) {
      grid[i] = best.base; overlay[i] = best.code; overlayColor[i] = best.top; count++;
    }
  }
  return { overlay, overlayColor, count };
}

// ---------- Große Formteile (2×2) ----------
/**
 * Setzt 2×2-Formteile (Dreieck, Viertelkreis) dort, wo sie die Kontur deutlich besser treffen
 * als vier einfarbige Steine. Das Formteil hat die Farbe T; jede der vier Platten darunter bekommt
 * die Farbe, die ihre freie Ecke am besten trifft. Kein Teil über eine Abschnittsgrenze.
 * Gierig nach Gewinn, ohne Überlappung. Ändert grid (Plattenfarben).
 * @param subRgb  Float32Array RGB, (cols·S) × (rows·S) Teilpixel (Foto oder Scherenschnitt)
 * @param strength 0..100 (0 = aus)
 * @param blocked optional Uint8Array: Zellen, die frei bleiben müssen
 */
export function fitBigPieces(subRgb, grid, cols, rows, S, strength, blocked = null) {
  const n = cols * rows, overlay = new Uint8Array(n), overlayColor = new Uint8Array(n);
  if (strength <= 0) return { overlay, overlayColor, count: 0 };
  const lab = colorLab(), W = cols * S, T2 = 2 * S, A = T2 * T2;
  const t = strength / 100;
  const minGain = 140 - 80 * t; // Mindestgewinn je Teilpixel (ΔE²)
  const T2_ = 2 * S, cellOfS = new Uint8Array(T2_ * T2_);
  for (let s = 0; s < cellOfS.length; s++) cellOfS[s] = ((s / T2_ | 0) >= S ? 2 : 0) + ((s % T2_) >= S ? 1 : 0);
  // je Formteil: Maske, freie Teilpixel je Zelle, Zelle mit der größten freien Fläche
  const masks = BIG_CODES.map(c => {
    const m = overlayMask(c, S), cnt = [0, 0, 0, 0];
    for (let s = 0; s < m.length; s++) if (m[s] < 0.5) cnt[cellOfS[s]]++;
    return [c, m, cnt, cnt.indexOf(Math.max(...cnt))];
  });
  const outErr = new Float64Array(4 * 64);
  // Lab je Teilpixel einmal vorab (gleiche RGB-Werte teilen sich das Ergebnis)
  const labAll = new Float32Array(subRgb.length), labCache = new Map();
  for (let o = 0; o < subRgb.length; o += 3) {
    const key = (Math.round(subRgb[o]) << 16) | (Math.round(subRgb[o + 1]) << 8) | Math.round(subRgb[o + 2]);
    let l = labCache.get(key);
    if (!l) { l = rgbToLab(subRgb[o], subRgb[o + 1], subRgb[o + 2]); labCache.set(key, l); }
    labAll[o] = l[0]; labAll[o + 1] = l[1]; labAll[o + 2] = l[2];
  }
  const cands = [];
  const sec = v => Math.floor(v / SECTION);
  const px = new Array(A);
  for (let y = 0; y + 1 < rows; y++) for (let x = 0; x + 1 < cols; x++) {
    if (sec(x) !== sec(x + 1) || sec(y) !== sec(y + 1)) continue;
    const cells = [y * cols + x, y * cols + x + 1, (y + 1) * cols + x, (y + 1) * cols + x + 1];
    if (blocked && cells.some(c => blocked[c])) continue;
    // Farbkandidaten: 4×4-Umgebung
    const colors = new Set();
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) colors.add(grid[ny * cols + nx]);
    }
    if (colors.size < 2) continue;
    for (let sy = 0; sy < T2; sy++) for (let sx = 0; sx < T2; sx++) px[sy * T2 + sx] = ((y * S + sy) * W + x * S + sx) * 3;
    const cl = [...colors];
    // d[c][s] = Abstand Teilpixel s zu Farbe c
    const d = cl.map(c => {
      const L = lab[c], a = new Float32Array(A);
      for (let s = 0; s < A; s++) { const o = px[s]; a[s] = (labAll[o] - L[0]) ** 2 + (labAll[o + 1] - L[1]) ** 2 + (labAll[o + 2] - L[2]) ** 2; }
      return a;
    });
    let plain = 0;
    const gi = cells.map(c => cl.indexOf(grid[c]));
    for (let s = 0; s < A; s++) plain += d[gi[cellOfS[s]]][s];
    if (plain / A < minGain) continue;
    let best = null;
    const K = cl.length;
    for (const [code, m, cnt, k0] of masks) {
      // Pro Zelle: Fehler der freien Teilpixel je Grundfarbe
      outErr.fill(0, 0, 4 * K);
      for (let s = 0; s < A; s++) if (m[s] < 0.5) { const o = cellOfS[s] * K; for (let c = 0; c < K; c++) outErr[o + c] += d[c][s]; }
      let baseErr = 0;
      const bases = [0, 1, 2, 3].map(k => {
        if (!cnt[k]) return grid[cells[k]];
        let bc = 0; for (let c = 1; c < K; c++) if (outErr[k * K + c] < outErr[k * K + bc]) bc = c;
        baseErr += outErr[k * K + bc]; return cl[bc];
      });
      for (let ti = 0; ti < K; ti++) {
        // Kontrast zur Grundfarbe der Ecke, die am meisten frei bleibt
        if (dist2(lab[cl[ti]], lab[bases[k0]]) < MIN_CONTRAST2) continue;
        let e = baseErr;
        const dt = d[ti];
        for (let s = 0; s < A; s++) if (m[s] >= 0.5) e += dt[s];
        if (!best || e < best.err) best = { code, top: cl[ti], bases, err: e };
      }
    }
    if (!best) continue;
    const gain = plain - best.err;
    if (gain / A >= minGain) cands.push({ ...best, gain, cells });
  }
  cands.sort((a, b) => b.gain - a.gain);
  const used = new Uint8Array(n);
  let count = 0;
  for (const c of cands) {
    if (c.cells.some(i => used[i])) continue;
    c.cells.forEach((i, k) => { used[i] = 1; grid[i] = c.bases[k]; overlay[i] = k ? OVERLAY_COVERED : c.code; });
    overlayColor[c.cells[0]] = c.top;
    count++;
  }
  return { overlay, overlayColor, count };
}

// ---------- Teile zusammenstellen ----------
/**
 * Zerlegt eine Reihe der Länge L in Fliesen 1×4/1×3/1×2/1×1 (wenig Teile, möglichst keine 1×1).
 */
export function splitRun(L) {
  const out = [];
  while (L > 0) {
    if (L === 5) { out.push(3, 2); break; }
    if (L === 1) { out.push(1); break; }
    const l = L >= 4 ? 4 : L; out.push(l); L -= l;
  }
  return out;
}

/**
 * Liste aller Teile des Mosaiks.
 * Elemente: {kind: 'stud'|'long'|'overlay', x, y, w, h, part, colorIndex, code?}
 * Zelle mit halber Noppe = Platte 1×1 (Grundfarbe) + Overlay-Fliese.
 */
export function buildElements(project) {
  const { cols, rows, grid } = project;
  const shapes = project.shapes || new Uint8Array(cols * rows).fill(SHAPE_INDEX[project.part] ?? 0);
  const overlay = project.overlay, overlayColor = project.overlayColor;
  const height = project.height;
  const same = (i, j) => grid[j] === grid[i] && (!height || height[j] === height[i]); // gleiche Farbe und Ebene
  const els = [], tops = [];
  const used = new Uint8Array(cols * rows);
  const mergeable = i => shapes[i] === SHAPE_TILE && !(overlay && overlay[i]);
  // Fliesen laufen entlang einer Kante: an einer reinen senkrechten Kante nicht waagrecht zusammenfassen
  const diff = (i, j) => j >= 0 && j < grid.length && !same(i, j);
  const vEdgeOnly = i => {
    const x = i % cols;
    const v = (x > 0 && diff(i, i - 1)) || (x < cols - 1 && diff(i, i + 1));
    return v && !diff(i, i - cols) && !diff(i, i + cols);
  };
  const hMergeable = i => mergeable(i) && !vEdgeOnly(i);
  if (project.longTiles) {
    // waagrecht, ohne über Abschnittsgrenzen zu gehen
    for (let y = 0; y < rows; y++) for (let sx = 0; sx < cols; sx += SECTION) {
      const end = Math.min(cols, sx + SECTION);
      for (let x = sx; x < end;) {
        const i = y * cols + x;
        if (!hMergeable(i)) { x++; continue; }
        let L = 1;
        while (x + L < end && hMergeable(i + L) && same(i, i + L)) L++;
        if (L >= 2) {
          let px = x;
          for (const l of splitRun(L)) {
            if (l >= 2) {
              els.push({ kind: 'long', x: px, y, w: l, h: 1, part: LONG_TILES[l], colorIndex: grid[i] });
              for (let k = 0; k < l; k++) used[i + (px - x) + k] = 1;
            }
            px += l;
          }
        }
        x += L;
      }
    }
    // übrig gebliebene Einzel-Fliesen senkrecht zusammenfassen
    for (let x = 0; x < cols; x++) for (let sy = 0; sy < rows; sy += SECTION) {
      const end = Math.min(rows, sy + SECTION);
      for (let y = sy; y < end;) {
        const i = y * cols + x;
        if (used[i] || !mergeable(i)) { y++; continue; }
        let L = 1;
        while (y + L < end && !used[i + L * cols] && mergeable(i + L * cols) && same(i, i + L * cols)) L++;
        if (L >= 2) {
          let py = y;
          for (const l of splitRun(L)) {
            if (l >= 2) {
              els.push({ kind: 'long', x, y: py, w: 1, h: l, part: LONG_TILES[l], colorIndex: grid[i] });
              for (let k = 0; k < l; k++) used[(py + k) * cols + x] = 1;
            }
            py += l;
          }
        }
        y += L;
      }
    }
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    if (used[i]) continue;
    const ov = overlay ? overlay[i] : 0;
    const key = ov ? 'plate' : SHAPE_KEYS[shapes[i]];
    els.push({ kind: 'stud', x, y, w: 1, h: 1, part: { key, ...STUD_PARTS[key] }, colorIndex: grid[i], ...(ov ? { under: true } : {}) });
    if (ov && ov !== OVERLAY_COVERED) {
      const sz = overlaySize(ov);
      tops.push({ kind: 'overlay', x, y, w: sz, h: sz, part: OVERLAY_PARTS[overlayKind(ov)], colorIndex: overlayColor[i], code: ov });
    }
  }
  return els.concat(tops); // Formteile zuletzt: liegen über den Platten
}

/** Zählt Teile je (Teil, Farbe). */
export function countParts(elements) {
  const m = new Map();
  for (const e of elements) {
    const k = `${e.part.blId}|${e.colorIndex}`;
    const it = m.get(k) || { part: e.part, colorIndex: e.colorIndex, count: 0 };
    it.count++; m.set(k, it);
  }
  return [...m.values()];
}

export { SHAPE_PLATE };
