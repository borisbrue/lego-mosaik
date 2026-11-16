import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { overlayKind } from '../js/parts.js';
import { snapObjects } from '../js/shapes.js';
import { cellsFromCutout, cutoutRgb } from '../js/cutout.js';
import { computeOverlays } from '../js/pieces.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), BLACK = ci(26), ORANGE = ci(106), GREY = ci(194);
const S = 4;

/** Teilraster cols×rows Noppen, gefüllt mit bg; paint(x, y) in Teilpixeln liefert Farbe oder null. */
function canvas(cols, rows, bg, paint) {
  const W = cols * S, H = rows * S, g = new Uint8Array(W * H).fill(bg);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const c = paint(x + 0.5, y + 0.5); if (c != null) g[y * W + x] = c; }
  return { g, W, H };
}

test('Kreis zwischen den Noppen wird zu einem Kreis aus vier Viertelkreisen', () => {
  const cols = 10, rows = 10;
  // Durchmesser 1,8 Noppen, Mitte um 0,3 Noppen neben einer Noppengrenze
  const { g, W, H } = canvas(cols, rows, WHITE, (x, y) => ((x - 21.2) ** 2 + (y - 18.8) ** 2 <= 3.6 ** 2 ? ORANGE : null));
  const snap = snapObjects(g, W, H, S);
  assert.equal(snap.discs.length, 1);
  assert.equal(snap.discs[0].d, 2);
  assert.ok(snap.discs[0].cx % S === 0 && snap.discs[0].cy % S === 0, 'Mitte auf einer Noppengrenze');
  const grid = cellsFromCutout(snap.g, cols, rows, S);
  const blocked = Uint8Array.from(snap.cells, v => (v ? 0 : 1));
  const { overlay, count } = computeOverlays(cutoutRgb(snap.g), grid, cols, rows, S, 35, blocked, { keep: 0.3 });
  assert.equal(count, 4);
  for (let i = 0; i < overlay.length; i++) if (overlay[i]) assert.equal(overlayKind(overlay[i]), 0, 'Viertelkreis');
});

test('Kreuz mit 1,5 Noppen breiten Armen rastet sauber ein: nur einfarbige Noppen, keine Formteile', () => {
  const cols = 14, rows = 14, c = 27.0, arm = 3, len = 9; // Teilpixel: Arme 6 breit (1,5 Noppen), Mitte versetzt
  const { g, W, H } = canvas(cols, rows, WHITE, (x, y) => {
    if ((x - c) ** 2 + (y - c) ** 2 <= 12 ** 2) {
      if ((Math.abs(x - c) <= arm && Math.abs(y - c) <= len) || (Math.abs(y - c) <= arm && Math.abs(x - c) <= len)) return BLACK;
      return GREY;
    }
    return null;
  });
  const snap = snapObjects(g, W, H, S);
  assert.equal(snap.objects.length, 1);
  // jede Noppe des Kreuzes ist einfarbig schwarz oder frei von Schwarz
  let mixed = 0, black = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    let n = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) if (snap.g[(y * S + sy) * W + x * S + sx] === BLACK) n++;
    if (n && n < S * S) mixed++;
    if (n === S * S) black++;
  }
  assert.equal(mixed, 0, 'keine halb getroffenen Noppen');
  // Kreuz aus 1 oder 2 Noppen breiten Armen, symmetrisch
  const grid = cellsFromCutout(snap.g, cols, rows, S);
  const cells = [];
  for (let i = 0; i < grid.length; i++) if (grid[i] === BLACK) cells.push([i % cols, (i / cols) | 0]);
  const xs = cells.map(p => p[0]), ys = cells.map(p => p[1]);
  assert.equal(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 'gleich breit wie hoch');
  assert.ok(black >= 5);
});

test('ohne geschlossene Formen bleibt das Raster unverändert', () => {
  const cols = 6, rows = 4;
  const { g, W, H } = canvas(cols, rows, WHITE, x => (x < 12 ? BLACK : null)); // Fläche am Rand
  const snap = snapObjects(g, W, H, S);
  assert.deepEqual(Array.from(snap.g), Array.from(g));
  assert.equal(snap.objects.length + snap.discs.length, 0);
});
