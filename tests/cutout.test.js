import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { OVERLAY_COVERED, overlayKind, overlaySize, SHAPE_TILE } from '../js/parts.js';
import { preparePalette, hexToRgb } from '../js/mosaic.js';
import { modeFilter, cutout, cellsFromCutout, cutoutRgb } from '../js/cutout.js';
import { fitBigPieces, buildElements, countParts, overlayMask } from '../js/pieces.js';
import { buildInstructionsHtml } from '../js/instructions.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), BLACK = ci(26), RED = ci(21);
const rgbOf = c => hexToRgb(LEGO_COLORS[c].hex);

test('modeFilter glättet Zacken und entfernt Einzelpixel, große Flächen bleiben', () => {
  const W = 8, H = 8, g = new Uint8Array(W * H).fill(BLACK);
  for (let y = 0; y < H; y++) for (let x = 4; x < W; x++) g[y * W + x] = WHITE;
  g[2 * W + 1] = WHITE;           // Einzelpixel links
  g[5 * W + 4] = BLACK;           // Zacke in der Kante
  modeFilter(g, W, H, 1);
  assert.equal(g[2 * W + 1], BLACK);
  assert.equal(g[5 * W + 4], WHITE);
  assert.equal(g[0], BLACK); assert.equal(g[W - 1], WHITE);
});

test('cutout: verrauschtes Zweifarbbild wird zu zwei glatten Flächen', () => {
  const W = 40, H = 40, sub = new Float32Array(W * H * 3);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 70;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const inside = (x - 20) ** 2 + (y - 20) ** 2 < 144;
    const base = inside ? [230, 230, 230] : [20, 20, 30];
    sub.set(base.map(v => Math.max(0, Math.min(255, v + rnd()))), (y * W + x) * 3);
  }
  const idx = [WHITE, BLACK, RED];
  const g = cutout(sub, W, H, idx, preparePalette(idx.map(i => LEGO_COLORS[i])), 50);
  assert.deepEqual(new Set(g), new Set([WHITE, BLACK]));
  assert.equal(g[20 * W + 20], WHITE);
  assert.equal(g[0], BLACK);
  // keine Inseln: genau eine weiße Fläche
  let whites = 0; for (const v of g) if (v === WHITE) whites++;
  assert.ok(Math.abs(whites - Math.PI * 144) < 60, `Fläche ${whites}`);
});

test('cellsFromCutout nimmt die Mehrheit je Zelle; cutoutRgb liefert LEGO-Farben', () => {
  const S = 2, g = Uint8Array.from([WHITE, WHITE, BLACK, BLACK, WHITE, BLACK, BLACK, BLACK]); // 4×2 Teilpixel = 2×1 Zellen
  assert.deepEqual(Array.from(cellsFromCutout(g, 2, 1, S)), [WHITE, BLACK]);
  assert.deepEqual(Array.from(cutoutRgb(Uint8Array.from([RED])).slice(0, 3)), rgbOf(RED));
});

/** Vorlage: weißes Dreieck (Diagonale) auf schwarzem Grund, S Teilpixel je Zelle. */
function diagonal(cols, rows, S, ax, ay) {
  const W = cols * S, sub = new Float32Array(W * rows * S * 3), grid = new Uint8Array(cols * rows).fill(BLACK);
  for (let y = 0; y < rows * S; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / S - ax, v = (y + 0.5) / S - ay;
    const inTri = u >= 0 && v >= 0 && u < 2 && v < 2 && u + v <= 2;
    sub.set(rgbOf(inTri ? WHITE : BLACK), (y * W + x) * 3);
  }
  grid[ay * cols + ax] = WHITE;
  return { sub, grid };
}

test('fitBigPieces setzt an einer 45°-Kante ein 2×2-Dreieck, Abdeckung korrekt', () => {
  const cols = 6, rows = 6, S = 4;
  const { sub, grid } = diagonal(cols, rows, S, 2, 2);
  const { overlay, overlayColor, count } = fitBigPieces(sub, grid, cols, rows, S, 60);
  assert.equal(count, 1);
  const a = 2 * cols + 2;
  assert.equal(overlayKind(overlay[a]), 2);
  assert.equal(overlaySize(overlay[a]), 2);
  assert.equal(overlayColor[a], WHITE);
  for (const i of [a + 1, a + cols, a + cols + 1]) assert.equal(overlay[i], OVERLAY_COVERED);
  assert.equal(grid[a + cols + 1], BLACK, 'freie Ecke: schwarze Platte');
});

test('fitBigPieces: keine Formteile zwischen ähnlichen Farben, nicht über Abschnittsgrenzen', () => {
  const cols = 6, rows = 6, S = 4;
  // Nougat-Dreieck auf Mittelnougat (ΔE ≈ 12) → zu wenig Kontrast für ein Formteil
  const NOUGAT = ci(18), MNOUGAT = ci(312);
  const { sub, grid } = diagonal(cols, rows, S, 2, 2);
  for (let i = 0; i < sub.length; i += 3) sub.set(rgbOf(sub[i] > 200 ? NOUGAT : MNOUGAT), i);
  grid.fill(MNOUGAT); grid[2 * cols + 2] = NOUGAT;
  assert.equal(fitBigPieces(sub, grid, cols, rows, S, 100).count, 0);
  // Dreieck genau auf der Abschnittsgrenze x = 15|16
  const big = diagonal(20, 4, S, 15, 1);
  assert.equal(fitBigPieces(big.sub, big.grid, 20, 4, S, 100).overlay[1 * 20 + 15], 0);
});

test('buildElements/Anleitung: 2×2-Formteil = 4 Platten + 1 Formteil', () => {
  const cols = 4, rows = 4, n = 16, grid = new Uint8Array(n).fill(BLACK), overlay = new Uint8Array(n), overlayColor = new Uint8Array(n);
  overlay[5] = 1 + 2 * 4; overlay[6] = overlay[9] = overlay[10] = OVERLAY_COVERED; overlayColor[5] = WHITE;
  grid[10] = RED;
  const p = { cols, rows, grid, shapes: new Uint8Array(n).fill(SHAPE_TILE), overlay, overlayColor, longTiles: true, part: 'tile' };
  const els = buildElements(p);
  const tops = els.filter(e => e.kind === 'overlay');
  assert.equal(tops.length, 1);
  assert.deepEqual([tops[0].w, tops[0].h, tops[0].part.blId], [2, 2, '35787']);
  assert.equal(els[els.length - 1].kind, 'overlay', 'Formteile zuletzt (liegen oben)');
  const plates = els.filter(e => e.kind === 'stud' && e.part.key === 'plate');
  assert.deepEqual(plates.map(e => e.y * cols + e.x).sort((a, b) => a - b), [5, 6, 9, 10]);
  assert.ok(!els.some(e => e.kind === 'long' && e.y >= 1 && e.y <= 2 && e.x <= 2 && e.x + e.w > 1), 'keine lange Fliese über Formteil-Zellen');
  assert.equal(countParts(els).find(c => c.part.blId === '35787').count, 1);
  const html = buildInstructionsHtml(p);
  assert.ok(html.includes('Fliese 2×2 dreieckig') && html.includes('Formteile (1×)'));
  // Maske: Dreieck bedeckt die Hälfte der 2×2-Fläche
  const m = overlayMask(1 + 2 * 4, 4), area = m.reduce((a, b) => a + b, 0) / m.length;
  assert.ok(Math.abs(area - 0.5) < 0.02, `area=${area}`);
});
