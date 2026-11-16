import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { preparePalette, reducePalette, sizeScale, detailWeights } from '../js/mosaic.js';
import { simplify } from '../js/pieces.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), BLACK = ci(26), DGRAY = ci(199);

test('sizeScale: A4 halb, ab A2 voll, nie unter 0.35', () => {
  assert.ok(Math.abs(sizeScale(26, 37) - 0.5) < 0.02);
  assert.equal(sizeScale(52, 74), 1);
  assert.equal(sizeScale(96, 96), 1);
  assert.equal(sizeScale(8, 8), 0.35);
});

test('detailWeights: Kanten zählen mehr als ruhige Flächen', () => {
  const cols = 5, rows = 1, px = new Float32Array(15);
  px.set([255, 255, 255], 3 * 3); // weißer Punkt an x = 3, Rest schwarz
  const w = detailWeights(px, cols, rows);
  assert.equal(w[0], 1);
  assert.equal(w[3], 4);
  assert.equal(w[2], 4);
});

test('simplify mit Kontrastschutz: kleines, deutlich abgesetztes Detail bleibt, ähnliches verschwindet', () => {
  const cols = 6, rows = 6;
  const make = c => { const g = new Uint8Array(36).fill(BLACK); g[14] = g[15] = c; return g; };
  const a = make(WHITE);
  simplify(a, cols, rows, 5, { keepContrast: 50, keepMin: 2 });
  assert.equal(a[14], WHITE, 'weiß auf schwarz bleibt');
  const b = make(DGRAY);
  simplify(b, cols, rows, 5, { keepContrast: 50, keepMin: 2 });
  assert.equal(b[14], BLACK, 'dunkelgrau auf schwarz wird verschmolzen');
  const c = make(WHITE);
  simplify(c, cols, rows, 5);
  assert.equal(c[14], BLACK, 'ohne Schutz wie bisher');
});

test('reducePalette: Detailgewichte retten die Farbe eines kleinen Details', () => {
  const prepared = preparePalette(LEGO_COLORS);
  // 200 Zellen: 120 schwarz, 75 dunkelblau-grau, 5 rot (das Detail)
  const n = 200, px = new Float32Array(n * 3), weights = new Float32Array(n).fill(1);
  for (let i = 0; i < n; i++) px.set(i < 120 ? [12, 14, 18] : i < 195 ? [60, 70, 95] : [200, 25, 10], i * 3);
  const plain = reducePalette(px, prepared, 2).map(k => LEGO_COLORS[k].legoId);
  for (let i = 195; i < n; i++) weights[i] = 40;
  const weighted = reducePalette(px, prepared, 2, new Set(), weights).map(k => LEGO_COLORS[k].legoId);
  assert.ok(!plain.includes(21), `ohne Gewicht kein Rot: ${plain}`);
  assert.ok(weighted.includes(21), `mit Gewicht Rot: ${weighted}`);
});
