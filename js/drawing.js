// Malmodus: geometrische Formen (Vektoren) als Ebene über dem Mosaik. Die Formen bleiben frei
// verschieb-, skalier- und drehbar; bei jeder Änderung werden sie fein gerastert und je Noppe in
// die Platte oder das Formteil übersetzt, das die Form am besten trifft. DOM-frei, getestet.
import { LEGO_COLORS } from './colors.js';
import { hexToRgb } from './mosaic.js';
import { OVERLAY_COVERED, overlaySize, SHAPE_PLATE, SHAPE_INDEX } from './parts.js';
import { computeOverlays, fitBigPieces, overlayMask, SMALL_CODES } from './pieces.js';

export const DRAW_KINDS = {
  rect: 'Rechteck', ellipse: 'Kreis / Ellipse', triangle: 'Dreieck', rtriangle: 'Rechtwinkliges Dreieck', half: 'Halbkreis',
};
const S = 4; // Teilpixel je Noppe und Richtung
const indexByLegoId = new Map(LEGO_COLORS.map((c, i) => [c.legoId, i]));
const RGB = LEGO_COLORS.map(c => hexToRgb(c.hex));
const MASKS = SMALL_CODES.map(c => Uint8Array.from(overlayMask(c, S), v => (v >= 0.5 ? 1 : 0)));
const CURVED = new Set(['ellipse', 'half']);

let nextId = 1;
const newId = () => `s${Date.now().toString(36)}${(nextId++).toString(36)}`;

/** Neue Form, Maße in Noppen, Mitte (cx, cy), Drehung in Grad. */
export function newShape(kind, cx, cy, colorId, size = 4) {
  return { id: newId(), kind, cx, cy, w: size, h: kind === 'half' ? size / 2 : size, rot: 0, colorId, level: null, surface: null, group: null };
}
export const cloneShape = (s, dx = 0, dy = 0) => ({ ...s, id: newId(), cx: s.cx + dx, cy: s.cy + dy });

/** Punkt (Noppen) ins lokale, normierte System der Form: u, v ∈ [-1, 1] über die Breite/Höhe. */
function local(s, x, y) {
  const a = (-s.rot * Math.PI) / 180, dx = x - s.cx, dy = y - s.cy;
  return [((dx * Math.cos(a) - dy * Math.sin(a)) * 2) / s.w, ((dx * Math.sin(a) + dy * Math.cos(a)) * 2) / s.h];
}

/** Liegt der Punkt (in Noppen) in der Form? */
export function contains(s, x, y) {
  const [u, v] = local(s, x, y);
  return insideUV(s.kind, u, v);
}

/** Treffertest im normierten System der Form. */
function insideUV(kind, u, v) {
  if (u < -1 || u > 1 || v < -1 || v > 1) return false;
  switch (kind) {
    case 'ellipse': return u * u + v * v <= 1;
    case 'triangle': return Math.abs(u) <= (v + 1) / 2;          // Spitze oben
    case 'rtriangle': return u <= v;                              // rechter Winkel unten links
    case 'half': return u * u + ((v - 1) / 2) ** 2 <= 1;          // gerade Kante unten
    default: return true;                                         // Rechteck
  }
}

/** Ecken des gedrehten Rahmens (Noppen): oben links, oben rechts, unten rechts, unten links. */
export function corners(s) {
  const a = (s.rot * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
    const lx = (u * s.w) / 2, ly = (v * s.h) / 2;
    return [s.cx + lx * c - ly * n, s.cy + lx * n + ly * c];
  });
}

/** Achsparalleler Rahmen mehrerer Formen. */
export function bounds(items) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of items) for (const [x, y] of corners(s)) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/**
 * Am Raster ausrichten: Maße auf ganze Noppen; bei Drehung um Vielfache von 90° liegt der Rand
 * auf Noppengrenzen (gerade Ausdehnung → Mitte auf einer Grenze, ungerade → auf einer Noppenmitte).
 * Ein Kreis mit 2 Noppen wird so zu vier passenden Viertelkreisen.
 */
export function snapShape(s) {
  s.rot = ((s.rot % 360) + 360) % 360;
  if (s.rot % 90 === 45) {
    // 45°: Seiten als Vielfache von √2 – dann liegen die Ecken auf Rasterpunkten und die schrägen
    // Kanten laufen genau durch die Diagonalen von 2×2-Feldern (passend für die 2×2-Dreiecke)
    const r2 = Math.SQRT2;
    s.w = Math.max(1, Math.round(s.w / r2)) * r2; s.h = Math.max(1, Math.round(s.h / r2)) * r2;
    const half = Math.round((s.w + s.h) / r2) % 2 ? 0.5 : 0; // Ecke auf ganzer Noppe
    s.cx = Math.round(s.cx - half) + half; s.cy = Math.round(s.cy - half) + half;
    return s;
  }
  s.w = Math.max(1, Math.round(s.w));
  s.h = Math.max(1, Math.round(s.h));
  if (s.rot % 90 === 0) {
    const quarter = (s.rot / 90) % 2 === 1, ex = quarter ? s.h : s.w, ey = quarter ? s.w : s.h;
    s.cx = ex % 2 ? Math.floor(s.cx) + 0.5 : Math.round(s.cx);
    s.cy = ey % 2 ? Math.floor(s.cy) + 0.5 : Math.round(s.cy);
  } else {
    s.cx = Math.round(s.cx * 2) / 2; s.cy = Math.round(s.cy * 2) / 2;
  }
  return s;
}

/** Oberste Form unter einem Punkt (Noppen) oder null. */
export function hitTest(items, x, y) {
  for (let k = items.length - 1; k >= 0; k--) if (contains(items[k], x, y)) return items[k];
  return null;
}

/**
 * Formen über eine Grundebene legen.
 * @param base {cols, rows, grid, shapes, overlay, overlayColor, height} – wird nicht verändert
 * @param items Formen (spätere liegen oben)
 * @param opts.shapeIndex Steinform (SHAPE_KEYS-Index) für bemalte Noppen, opts.strength Formteile 0..100
 * @returns neue Raster {grid, shapes, overlay, overlayColor, height} und touched (bemalte Noppen)
 */
export function applyDrawing(base, items, { shapeIndex = 0, strength = 60 } = {}) {
  const { cols, rows } = base, n = cols * rows, W = cols * S, H = rows * S;
  const grid = Uint8Array.from(base.grid);
  const shapes = base.shapes ? Uint8Array.from(base.shapes) : new Uint8Array(n).fill(shapeIndex);
  const overlay = base.overlay ? Uint8Array.from(base.overlay) : new Uint8Array(n);
  const overlayColor = base.overlayColor ? Uint8Array.from(base.overlayColor) : new Uint8Array(n);
  const height = base.height ? Uint8Array.from(base.height) : new Uint8Array(n);
  const touched = new Uint8Array(n);
  if (!items.length) return { grid, shapes, overlay, overlayColor, height, touched };
  // Teilpixel → oberste Form
  const own = new Int16Array(W * H).fill(-1);
  items.forEach((s, k) => {
    const b = bounds([s]);
    const X0 = Math.max(0, Math.floor(b.x0 * S)), X1 = Math.min(W, Math.ceil(b.x1 * S));
    const Y0 = Math.max(0, Math.floor(b.y0 * S)), Y1 = Math.min(H, Math.ceil(b.y1 * S));
    // Drehung einmal vorberechnen (der Test läuft für jedes Teilpixel)
    const a = (-s.rot * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), fw = 2 / s.w, fh = 2 / s.h;
    for (let Y = Y0; Y < Y1; Y++) {
      const dy = (Y + 0.5) / S - s.cy;
      for (let X = X0; X < X1; X++) {
        const dx = (X + 0.5) / S - s.cx;
        if (insideUV(s.kind, (dx * ca - dy * sa) * fw, (dx * sa + dy * ca) * fh)) { own[Y * W + X] = k; touched[((Y / S) | 0) * cols + ((X / S) | 0)] = 1; }
      }
    }
  });
  // Formteile der Grundebene entfernen, die eine bemalte Noppe berühren
  for (let i = 0; i < n; i++) {
    const code = overlay[i];
    if (!code || code === OVERLAY_COVERED) continue;
    const size = overlaySize(code), cells = size === 2 ? [i, i + 1, i + cols, i + cols + 1] : [i];
    if (cells.some(c => touched[c])) for (const c of cells) overlay[c] = 0;
  }
  // Vorlage: Formfarbe oder Grundfarbe je Teilpixel; Noppenfarbe = Mehrheit
  const template = new Float32Array(W * H * 3), counts = new Uint16Array(256), blocked = new Uint8Array(n).fill(1);
  // Nachbarn bemalter Noppen dürfen unter ein 2×2-Formteil (z. B. Dreieck an einer schrägen Kante)
  for (let i = 0; i < n; i++) {
    if (!touched[i] || overlay[i]) continue;
    const x = i % cols, y = (i / cols) | 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy, j = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || overlay[j]) continue;
      blocked[j] = 0;
      if (touched[j]) continue;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) template.set(RGB[base.grid[j]], ((ny * S + sy) * W + nx * S + sx) * 3);
    }
  }
  const levelCnt = new Map(), allowTop = new Uint8Array(n).fill(255), itemCnt = new Map(), curved = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!touched[i]) continue;
    const x = i % cols, y = (i / cols) | 0, seen = [];
    levelCnt.clear();
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const p = (y * S + sy) * W + x * S + sx, k = own[p];
      const c = k >= 0 ? indexByLegoId.get(items[k].colorId) ?? base.grid[i] : base.grid[i];
      template.set(RGB[c], p * 3);
      if (!counts[c]) seen.push(c);
      counts[c]++;
      if (k >= 0 && items[k].level != null) levelCnt.set(items[k].level, (levelCnt.get(items[k].level) || 0) + 1);
      if (k >= 0) itemCnt.set(k, (itemCnt.get(k) || 0) + 1);
    }
    // Formteile hier nur in der Farbe der obersten Form in der Noppe (deren Kante sieht man): so wölbt
    // sich die Kante immer mit der Form nach außen und nie als Delle hinein
    let topK = -1;
    for (const k of itemCnt.keys()) if (k > topK) topK = k;
    itemCnt.clear();
    if (topK >= 0) { allowTop[i] = indexByLegoId.get(items[topK].colorId) ?? 255; curved[i] = CURVED.has(items[topK].kind) ? 1 : 0; }
    let best = seen[0];
    for (const c of seen) if (counts[c] > counts[best]) best = c;
    for (const c of seen) counts[c] = 0;
    grid[i] = best;
    // Oberfläche: eigene Steinform der Form (z. B. eckige Fliesen für Pixel) oder wie das Mosaik
    shapes[i] = topK >= 0 && items[topK].surface in SHAPE_INDEX ? SHAPE_INDEX[items[topK].surface] : shapeIndex;
    for (const [lv, k] of levelCnt) if (k * 2 > S * S) height[i] = lv;
  }
  // Inneres einfarbiger Flächen sperren (Noppe einfarbig, alle 8 Nachbarn gleiche Farbe): dort passt
  // kein Formteil, und die Suche bleibt auch bei großen Formen schnell
  for (let i = 0; i < n; i++) {
    if (blocked[i]) continue;
    const x = i % cols, y = (i / cols) | 0, c = grid[i];
    let same = true;
    for (let dy = -1; dy <= 1 && same; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[ny * cols + nx] !== c) { same = false; break; }
    }
    if (!same) continue;
    const o0 = (y * S * W + x * S) * 3, r = template[o0], g = template[o0 + 1], b = template[o0 + 2];
    for (let sy = 0; sy < S && same; sy++) for (let sx = 0; sx < S; sx++) {
      const o = ((y * S + sy) * W + x * S + sx) * 3;
      if (template[o] !== r || template[o + 1] !== g || template[o + 2] !== b) { same = false; break; }
    }
    if (same && r === RGB[c][0] && g === RGB[c][1] && b === RGB[c][2]) blocked[i] = 1;
  }
  // Formteile: zuerst 2×2 (Dreieck, Viertelkreis), dann 1×1 – nur auf bemalten Noppen, nur fast exakte Treffer
  const big = fitBigPieces(template, grid, cols, rows, S, strength, blocked, { allowTop, keepByKind: [0.3, 0.3, 0.3, 0.15] });
  for (let i = 0; i < n; i++) if (big.overlay[i]) { overlay[i] = big.overlay[i]; overlayColor[i] = big.overlayColor[i]; blocked[i] = 1; }
  idealizeCurves(template, grid, cols, rows, blocked, curved, allowTop);
  const small = computeOverlays(template, grid, cols, rows, S, strength, blocked, { keep: 0.3, allowTop });
  for (let i = 0; i < n; i++) if (small.overlay[i]) { overlay[i] = small.overlay[i]; overlayColor[i] = small.overlayColor[i]; }
  for (let i = 0; i < n; i++) if (overlay[i] && !base.overlay?.[i]) { shapes[i] = SHAPE_PLATE; touched[i] = 1; }
  return { grid, shapes, overlay, overlayColor, height, touched };
}

/**
 * Runde Kanten (Kreis, Halbkreis): je Randnoppe die baubare Form wählen, die dem idealen Bogen am
 * nächsten kommt – einfarbig oder Viertel-/Halbkreis in der Farbe der Form. Formteile sind dabei
 * bevorzugt (Faktor 0,6): Ein Kreis mit Viertelkreisen am Rand wirkt runder als eine Treppe.
 * Schreibt das Ergebnis exakt in die Vorlage, damit die Formteil-Suche es sicher findet.
 */
function idealizeCurves(template, grid, cols, rows, blocked, curved, allowTop) {
  const W = cols * S, SS = S * S, idx = new Uint8Array(SS), cnt = new Map();
  for (let i = 0; i < cols * rows; i++) {
    if (blocked[i] || !curved[i] || allowTop[i] === 255) continue;
    const x = i % cols, y = (i / cols) | 0, T = allowTop[i];
    // Teilpixel: Formfarbe ja/nein; häufigste andere Farbe ist die Grundplatte
    cnt.clear();
    let nT = 0;
    for (let k = 0; k < SS; k++) {
      const o = ((y * S + (k / S | 0)) * W + x * S + (k % S)) * 3;
      const c = closest(template[o], template[o + 1], template[o + 2]);
      idx[k] = c === T ? 1 : 0;
      if (c === T) nT++; else cnt.set(c, (cnt.get(c) || 0) + 1);
    }
    if (!nT || nT === SS) continue;
    let B = -1, bn = 0;
    for (const [c, v] of cnt) if (v > bn) { bn = v; B = c; }
    let best = nT * 2 >= SS ? 'T' : 'B', bestE = Math.min(nT, SS - nT);
    for (const m of MASKS) {
      let e = 0;
      for (let k = 0; k < SS; k++) if (m[k] !== idx[k]) e++;
      if (e * 0.6 < bestE) { bestE = e * 0.6; best = m; }
    }
    for (let k = 0; k < SS; k++) {
      const o = ((y * S + (k / S | 0)) * W + x * S + (k % S)) * 3;
      const top = best === 'T' || (best !== 'B' && best[k]);
      template.set(RGB[top ? T : B], o);
    }
    // Noppenfarbe = Mehrheit (die Formteil-Suche nimmt ihre Kandidaten aus den Nachbarfarben)
    let nTop = 0;
    if (best === 'T') nTop = SS; else if (best !== 'B') for (let k = 0; k < SS; k++) nTop += best[k];
    grid[i] = nTop * 2 >= SS ? T : B;
  }
}

const closest = (r, g, b) => {
  let best = 0, bd = Infinity;
  for (let c = 0; c < RGB.length; c++) {
    const d = (RGB[c][0] - r) ** 2 + (RGB[c][1] - g) ** 2 + (RGB[c][2] - b) ** 2;
    if (d < bd) { bd = d; best = c; if (!d) break; }
  }
  return best;
};
