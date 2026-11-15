import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { SHAPE_INDEX, SHAPE_TILE, SECTION, overlayCode } from '../js/parts.js';
import {
  overlayContains, overlayMask, overlayPath, despeckle, autoShapes, computeOverlays, splitRun, buildElements, countParts,
} from '../js/pieces.js';
import { dominantDownsample, unsharpMask, hexToRgb } from '../js/mosaic.js';
import { buildOrderList } from '../js/orderlist.js';
import { buildInstructionsHtml } from '../js/instructions.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), BLACK = ci(26), RED = ci(21);

test('Viertelkreis: Fläche ≈ π/4, Drehung verschiebt die Ecke', () => {
  const m = overlayMask(overlayCode(0, 0), 8);
  const area = m.reduce((a, b) => a + b, 0) / 64;
  assert.ok(Math.abs(area - Math.PI / 4) < 0.02, `area=${area}`);
  assert.ok(overlayContains(overlayCode(0, 0), 0.05, 0.05) && !overlayContains(overlayCode(0, 0), 0.95, 0.95));
  assert.ok(overlayContains(overlayCode(0, 1), 0.95, 0.05) && !overlayContains(overlayCode(0, 1), 0.05, 0.95));
  assert.ok(overlayContains(overlayCode(0, 2), 0.95, 0.95));
  assert.ok(overlayContains(overlayCode(0, 3), 0.05, 0.95));
});

test('Halbkreis: Fläche = ½ + π/8, Pfad ist gültig', () => {
  const m = overlayMask(overlayCode(1, 0), 8);
  const area = m.reduce((a, b) => a + b, 0) / 64;
  assert.ok(Math.abs(area - (0.5 + Math.PI / 8)) < 0.02, `area=${area}`);
  for (let r = 0; r < 4; r++) assert.match(overlayPath(overlayCode(1, r)), /^M[\d. ]+ L[\d. ]+ L[\d. ]+ A0\.5 0\.5 0 0 1 [\d. ]+ Z$/);
});

test('splitRun: wenig Teile, keine unnötigen 1×1', () => {
  assert.deepEqual(splitRun(1), [1]);
  assert.deepEqual(splitRun(5), [3, 2]);
  assert.deepEqual(splitRun(7), [4, 3]);
  assert.deepEqual(splitRun(9), [4, 3, 2]);
  for (let L = 2; L <= 40; L++) {
    const p = splitRun(L);
    assert.equal(p.reduce((a, b) => a + b, 0), L);
    assert.ok(!p.includes(1), `L=${L}: ${p}`);
  }
});

test('despeckle entfernt einzelne Ausreißer, lässt Linien stehen', () => {
  const g = new Uint8Array(25).fill(WHITE);
  g[12] = BLACK;                       // einzelner Punkt
  assert.equal(despeckle(g, 5, 5), 1);
  assert.equal(g[12], WHITE);
  const line = new Uint8Array(25).fill(WHITE);
  for (let x = 0; x < 5; x++) line[10 + x] = BLACK; // waagrechte Linie
  assert.equal(despeckle(line, 5, 5), 0);
});

test('autoShapes: Konturen eckig, Flächen rund', () => {
  const cols = 6, rows = 4, g = new Uint8Array(cols * rows).fill(WHITE);
  for (let y = 0; y < rows; y++) for (let x = 3; x < cols; x++) g[y * cols + x] = BLACK;
  const s = autoShapes(g, cols, rows, { area: 'plate-round', edge: 'tile', sensitivity: 50 });
  for (let y = 0; y < rows; y++) {
    assert.deepEqual(Array.from(s.slice(y * cols, y * cols + cols)),
      [0, 0, 1, 1, 0, 0].map(e => (e ? SHAPE_TILE : SHAPE_INDEX['plate-round'])));
  }
  assert.ok(autoShapes(g, cols, rows, { area: 'plate', edge: 'same' }).every(v => v === SHAPE_INDEX.plate));
});

test('autoShapes: Farbstufe in einem weichen Verlauf ist keine Kontur', () => {
  // Foto: Grauverlauf 100 → 140 über 8 Zellen; LEGO-Farben springen in der Mitte
  const cols = 8, rows = 1, g = new Uint8Array(8), src = new Float32Array(8 * 3);
  for (let x = 0; x < 8; x++) { const v = 100 + x * 5; src.set([v, v, v], x * 3); g[x] = x < 4 ? ci(199) : ci(194); }
  const s = autoShapes(g, cols, rows, { area: 'plate-round', edge: 'tile', sensitivity: 50 }, src);
  assert.ok(s.every(v => v === SHAPE_INDEX['plate-round']), Array.from(s).join());
  // echte Kante im Foto → Kontur
  src.set([20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 20], 0);
  const s2 = autoShapes(g, cols, rows, { area: 'plate-round', edge: 'tile', sensitivity: 50 }, src);
  assert.equal(s2[3], SHAPE_TILE); assert.equal(s2[4], SHAPE_TILE); assert.equal(s2[0], SHAPE_INDEX['plate-round']);
});

test('computeOverlays erkennt eine diagonale Kante und setzt passende Viertelkreise', () => {
  // 4×4 Zellen, S = 4: schwarz unterhalb der Diagonale x + y < 4 (in Zellen) → Kanten auf der Diagonale
  const cols = 4, rows = 4, S = 4, W = cols * S, H = rows * S;
  const sub = new Float32Array(W * H * 3);
  const grid = new Uint8Array(cols * rows);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // Kreis um die obere linke Ecke mit Radius 2 Zellen: innen schwarz, außen weiß
    const inside = (x + 0.5) ** 2 + (y + 0.5) ** 2 <= (2 * S) ** 2;
    sub.set(inside ? [5, 19, 29] : [255, 255, 255], (y * W + x) * 3);
  }
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let dark = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) dark += sub[((y * S + sy) * W + x * S + sx) * 3] < 128 ? 1 : 0;
    grid[y * cols + x] = dark > S * S / 2 ? BLACK : WHITE;
  }
  const off = computeOverlays(sub, Uint8Array.from(grid), cols, rows, S, 0);
  assert.equal(off.count, 0);
  const g = Uint8Array.from(grid);
  const r = computeOverlays(sub, g, cols, rows, S, 80);
  assert.ok(r.count >= 1, `count=${r.count}`);
  for (let i = 0; i < r.overlay.length; i++) if (r.overlay[i]) assert.notEqual(g[i], r.overlayColor[i]);
  // Zelle (1,1) liegt auf dem Kreisbogen: sichtbar muss oben links schwarz, unten rechts weiß sein
  const i11 = 1 * cols + 1, code = r.overlay[i11];
  assert.ok(code, 'Zelle (1,1) ohne halbe Noppe');
  const visible = (x, y) => (overlayContains(code, x, y) ? r.overlayColor[i11] : g[i11]);
  assert.equal(visible(0.05, 0.05), BLACK);
  assert.equal(visible(0.95, 0.95), WHITE);
  // ganz innen und ganz außen bleibt alles einfarbig
  assert.equal(r.overlay[0], 0);
  assert.equal(r.overlay[cols * rows - 1], 0);
});

test('buildElements: lange Fliesen, keine über Abschnittsgrenzen, Overlay = Platte + Fliese', () => {
  const cols = 20, rows = 2, n = cols * rows;
  const grid = new Uint8Array(n).fill(RED);
  const shapes = new Uint8Array(n).fill(SHAPE_TILE);
  const overlay = new Uint8Array(n), overlayColor = new Uint8Array(n);
  overlay[cols + 19] = overlayCode(0, 2); overlayColor[cols + 19] = BLACK;
  const els = buildElements({ cols, rows, grid, shapes, overlay, overlayColor, longTiles: true });
  for (const e of els) {
    if (e.kind === 'long') assert.equal(Math.floor(e.x / SECTION), Math.floor((e.x + e.w - 1) / SECTION), 'über Abschnittsgrenze');
  }
  // Zelle unter jedem Teil genau einmal belegt (Overlays liegen zusätzlich oben)
  const cov = new Uint8Array(n);
  for (const e of els) if (e.kind !== 'overlay') for (let y = e.y; y < e.y + e.h; y++) for (let x = e.x; x < e.x + e.w; x++) cov[y * cols + x]++;
  assert.ok(cov.every(v => v === 1));
  const parts = countParts(els);
  const by = bl => parts.filter(p => p.part.blId === bl).reduce((a, p) => a + p.count, 0);
  assert.equal(by('25269'), 1);      // Viertelkreis
  assert.equal(by('3024'), 1);       // Platte 1×1 darunter
  // Reihe 1: Abschnitt 1 = 16 → 4× 1×4, Abschnitt 2 = 4 → 1× 1×4
  // Reihe 2: Abschnitt 1 = 16 → 4× 1×4, Abschnitt 2 = 3 (letzte Zelle hat Overlay) → 1× 1×3
  assert.equal(by('2431'), 9);
  assert.equal(by('63864'), 1);
});

test('Bestellliste zählt Overlays und lange Fliesen', () => {
  const cols = 8, rows = 1, n = 8;
  const grid = new Uint8Array(n).fill(WHITE);
  const shapes = new Uint8Array(n).fill(SHAPE_TILE);
  const overlay = new Uint8Array(n), overlayColor = new Uint8Array(n);
  overlay[0] = overlayCode(1, 0); overlayColor[0] = BLACK;
  const list = buildOrderList({ cols, rows, grid, shapes, overlay, overlayColor, longTiles: true, includeBase: false });
  const got = Object.fromEntries(list.items.map(it => [`${it.part.blId}/${it.color.legoId}`, it.needed]));
  // Zelle 0: Platte 1×1 weiß + Halbkreis schwarz; Zellen 1–7: 1×4 + 1×3 weiß
  assert.deepEqual(got, { '3024/1': 1, '24246/26': 1, '2431/1': 1, '63864/1': 1 });
});

test('Anleitung zeigt halbe Noppen und Teile-Legende', () => {
  const cols = 16, rows = 16, n = 256;
  const grid = new Uint8Array(n).fill(WHITE);
  const overlay = new Uint8Array(n), overlayColor = new Uint8Array(n);
  overlay[17] = overlayCode(0, 1); overlayColor[17] = BLACK;
  const html = buildInstructionsHtml({ cols, rows, grid, shapes: new Uint8Array(n), overlay, overlayColor, part: 'plate-round' });
  assert.ok(html.includes('Halbe Noppen (1×)'));
  assert.ok(html.includes('Fliese 1×1 Viertelkreis'));
  assert.ok(html.includes('class="part-legend"'));
});

test('Schärfen: dominantDownsample kippt Kantenzelle zur Mehrheit', () => {
  // 1 Zelle aus 4×4 Pixeln: 12 schwarz, 4 weiß
  const w = 4, h = 4, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < 16; i++) data.set(i < 12 ? [0, 0, 0, 255] : [255, 255, 255, 255], i * 4);
  const avg = dominantDownsample(data, w, h, 1, 1, 0)[0];
  const dom = dominantDownsample(data, w, h, 1, 1, 1)[0];
  assert.ok(Math.abs(avg - 63.75) < 0.01);
  assert.ok(dom < 1, `dom=${dom}`);
});

test('unsharpMask erhöht den Kontrast an einer Kante', () => {
  const w = 10, h = 1, data = new Uint8ClampedArray(w * 4);
  for (let x = 0; x < w; x++) { const v = x < 5 ? 100 : 150; data.set([v, v, v, 255], x * 4); }
  unsharpMask(data, w, h, 1, 1);
  assert.ok(data[4 * 4] < 100 && data[5 * 4] > 150, `${data[16]} / ${data[20]}`);
  assert.equal(data[3], 255);
});

test('hexToRgb Hilfsfunktion', () => assert.deepEqual(hexToRgb('#FF8000'), [255, 128, 0]));
