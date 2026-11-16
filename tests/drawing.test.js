import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { overlayKind, overlaySize, OVERLAY_COVERED } from '../js/parts.js';
import { newShape, contains, snapShape, bounds, hitTest, applyDrawing } from '../js/drawing.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), RED = ci(21);
const base = (cols, rows) => ({ cols, rows, grid: new Uint8Array(cols * rows).fill(WHITE) });

test('contains: Grundformen', () => {
  const r = newShape('rect', 5, 5, 21); // 4×4
  assert.ok(contains(r, 3.1, 3.1)); assert.ok(!contains(r, 2.9, 5));
  const c = newShape('ellipse', 5, 5, 21);
  assert.ok(contains(c, 5, 3.1)); assert.ok(!contains(c, 3.2, 3.2));
  const t = newShape('triangle', 5, 5, 21);
  assert.ok(contains(t, 5, 3.2)); assert.ok(!contains(t, 3.5, 3.5)); assert.ok(contains(t, 3.5, 6.9));
  const rt = newShape('rtriangle', 5, 5, 21);
  assert.ok(contains(rt, 3.2, 6.8)); assert.ok(!contains(rt, 6.8, 3.2));
  const h = newShape('half', 5, 5, 21); // 4×2, gerade Kante unten
  assert.ok(contains(h, 5, 5.9)); assert.ok(contains(h, 5, 4.1)); assert.ok(!contains(h, 3.2, 4.2));
  r.rot = 45;
  assert.ok(contains(r, 5, 2.4), 'gedreht: Spitze oben'); assert.ok(!contains(r, 3.2, 3.2));
});

test('snapShape: ganze Noppen, Rand auf Noppengrenzen', () => {
  const s = snapShape({ ...newShape('ellipse', 5.3, 7.8, 21), w: 2.4, h: 2.6 });
  assert.deepEqual([s.w, s.h, s.cx, s.cy], [2, 3, 5, 7.5]);
  const r = snapShape({ ...newShape('rect', 5.3, 5.2, 21), w: 3, h: 2, rot: 90 });
  assert.deepEqual([r.cx, r.cy], [5, 5.5], 'gedreht: Breite wirkt senkrecht');
});

test('bounds und hitTest', () => {
  const a = newShape('rect', 4, 4, 21, 2), b = newShape('ellipse', 10, 6, 1, 2);
  const bb = bounds([a, b]);
  assert.deepEqual([bb.x0, bb.y0, bb.x1, bb.y1], [3, 3, 11, 7]);
  assert.equal(hitTest([a, b], 10, 6), b);
  assert.equal(hitTest([a, b], 7, 7), null);
});

test('applyDrawing: Kreis mit 2 Noppen auf dem Raster = vier Viertelkreise', () => {
  const s = snapShape(newShape('ellipse', 6, 6, 21, 2));
  const out = applyDrawing(base(12, 12), [s]);
  const codes = [...out.overlay].filter(Boolean);
  assert.equal(codes.length, 4);
  assert.ok(codes.every(c => overlayKind(c) === 0));
  assert.equal(out.overlayColor[5 * 12 + 5], RED);
  assert.equal(out.touched.reduce((a, b) => a + b, 0), 4);
});

test('applyDrawing: ausgerichtetes Rechteck füllt genau seine Noppen, ohne Formteile', () => {
  const s = snapShape({ ...newShape('rect', 6, 6, 21), w: 4, h: 2 });
  const out = applyDrawing(base(12, 12), [s]);
  let red = 0;
  for (let i = 0; i < 144; i++) if (out.grid[i] === RED) red++;
  assert.equal(red, 8);
  assert.equal([...out.overlay].filter(Boolean).length, 0);
});

test('applyDrawing: um 45° gedrehtes Quadrat nutzt 2×2-Dreiecke an den schrägen Kanten', () => {
  const s = snapShape({ ...newShape('rect', 8.3, 7.9, 21), w: 6, h: 6, rot: 45 });
  assert.ok(Math.abs(s.w - 4 * Math.SQRT2) < 1e-9);
  const out = applyDrawing(base(16, 16), [s]);
  const big = [...out.overlay].filter(c => c && c !== OVERLAY_COVERED && overlaySize(c) === 2 && overlayKind(c) === 2);
  assert.ok(big.length >= 2, `Dreiecke: ${big.length}`);
});

test('applyDrawing: Ebene und Reihenfolge (obere Form gewinnt), Grundebene bleibt unverändert', () => {
  const b = base(10, 10);
  const a = { ...snapShape(newShape('rect', 5, 5, 21)), level: 2 };
  const top = snapShape({ ...newShape('rect', 5, 5, 1), w: 2, h: 2 });
  const out = applyDrawing(b, [a, top]);
  assert.equal(out.grid[4 * 10 + 4], WHITE, 'obere weiße Form');
  assert.equal(out.grid[3 * 10 + 3], RED);
  assert.equal(out.height[3 * 10 + 3], 2);
  assert.ok(b.grid.every(v => v === WHITE));
});

test('applyDrawing: Oberfläche je Form (eckige Fliese) überschreibt die Mosaik-Steinform', async () => {
  const { SHAPE_INDEX } = await import('../js/parts.js');
  const s = { ...snapShape(newShape('rect', 5, 5, 21, 2)), surface: 'tile' };
  const out = applyDrawing(base(10, 10), [s], { shapeIndex: SHAPE_INDEX['plate-round'] });
  assert.equal(out.shapes[4 * 10 + 4], SHAPE_INDEX.tile);
  const plain = applyDrawing(base(10, 10), [{ ...s, surface: null }], { shapeIndex: SHAPE_INDEX['plate-round'] });
  assert.equal(plain.shapes[4 * 10 + 4], SHAPE_INDEX['plate-round']);
});
