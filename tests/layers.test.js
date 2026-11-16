import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { SHAPE_TILE } from '../js/parts.js';
import { planRisers, countRisers, autoDepth } from '../js/layers.js';
import { buildElements } from '../js/pieces.js';
import { buildOrderList, orderListToBrickLinkXml } from '../js/orderlist.js';
import { buildInstructionsHtml } from '../js/instructions.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), BLACK = ci(26), RED = ci(21);

/** Prüft: jede Zelle mit height ≥ k ist auf Stufe k genau einmal bedeckt, sonst gar nicht. */
function assertCover(p, risers) {
  const { cols, rows, height } = p;
  for (let level = 1; level <= 3; level++) {
    const cov = new Uint8Array(cols * rows);
    for (const r of risers.filter(r => r.level === level)) {
      assert.ok(Math.floor(r.x / 16) === Math.floor((r.x + r.w - 1) / 16), 'Platte über Abschnittsgrenze (x)');
      assert.ok(Math.floor(r.y / 16) === Math.floor((r.y + r.h - 1) / 16), 'Platte über Abschnittsgrenze (y)');
      for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cov[y * cols + x]++;
    }
    for (let i = 0; i < cols * rows; i++) assert.equal(cov[i], height[i] >= level ? 1 : 0, `Stufe ${level}, Zelle ${i}`);
  }
}

test('planRisers: lückenlos je Stufe, große Platten, nichts über Abschnittsgrenzen', () => {
  const cols = 37, rows = 52, n = cols * rows, height = new Uint8Array(n);
  for (let y = 5; y < 40; y++) for (let x = 3; x < 30; x++) height[y * cols + x] = 1;
  for (let y = 10; y < 20; y++) for (let x = 10; x < 22; x++) height[y * cols + x] = 2;
  height[45 * cols + 33] = 3;
  const p = { cols, rows, grid: new Uint8Array(n).fill(WHITE), height, riserColorId: 26 };
  const risers = planRisers(p);
  assertCover(p, risers);
  assert.ok(risers.every(r => r.colorIndex === BLACK));
  assert.ok(risers.filter(r => r.level === 1).length < 30, `Stufe 1: ${risers.filter(r => r.level === 1).length} Platten`);
});

test('planRisers: „wie Oberfläche“ hält Farben getrennt', () => {
  const cols = 8, rows = 4, n = cols * rows, grid = new Uint8Array(n), height = new Uint8Array(n).fill(1);
  for (let i = 0; i < n; i++) grid[i] = i % cols < 3 ? RED : WHITE;
  const p = { cols, rows, grid, height, riserColorId: 'match' };
  const risers = planRisers(p);
  assertCover(p, risers);
  for (const r of risers) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) assert.equal(grid[y * cols + x], r.colorIndex);
  assert.deepEqual(countRisers(risers).map(c => c.count).reduce((a, b) => a + b), risers.length);
});

test('planRisers: ohne Ebenen keine Sockel', () => {
  assert.deepEqual(planRisers({ cols: 4, rows: 4, grid: new Uint8Array(16), height: new Uint8Array(16) }), []);
  assert.deepEqual(planRisers({ cols: 4, rows: 4, grid: new Uint8Array(16) }), []);
});

test('autoDepth: Motiv vor einfarbigem Hintergrund kommt nach vorne, Rand bleibt flach', () => {
  const cols = 12, rows = 12, grid = new Uint8Array(cols * rows).fill(BLACK);
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) grid[y * cols + x] = WHITE;
  assert.ok(autoDepth(grid, cols, rows, 0).every(v => v === 0));
  const h = autoDepth(grid, cols, rows, 50);
  assert.ok(h[5 * cols + 5] >= 1, 'Motiv erhöht');
  assert.equal(h[0], 0);
  assert.equal(h[11 * cols + 11], 0);
  for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) assert.equal(h[y * cols + x], h[5 * cols + 5], 'ganze Fläche gleich hoch');
});

test('Lange Fliesen gehen nicht über eine Stufenkante', () => {
  // 4×2, gleiche Farbe; untere Zeile eine Ebene höher → je Zeile eine 1×4, nichts senkrecht über die Stufe
  const cols = 4, rows = 2, grid = new Uint8Array(8).fill(WHITE), height = Uint8Array.from([0, 0, 0, 0, 1, 1, 1, 1]);
  const els = buildElements({ cols, rows, grid, height, shapes: new Uint8Array(8).fill(SHAPE_TILE), longTiles: true });
  assert.deepEqual(els.map(e => [e.kind, e.x, e.y, e.w, e.h]), [['long', 0, 0, 4, 1], ['long', 0, 1, 4, 1]]);
  const flat = buildElements({ cols, rows, grid, height: new Uint8Array(8), shapes: new Uint8Array(8).fill(SHAPE_TILE), longTiles: true });
  assert.equal(flat.length, 2);
});

test('Bestellliste und Anleitung enthalten die Sockel', () => {
  const cols = 16, rows = 16, n = cols * rows, grid = new Uint8Array(n).fill(WHITE), height = new Uint8Array(n);
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) height[y * cols + x] = y < 8 ? 2 : 1;
  const p = { cols, rows, grid, height, riserColorId: 26, part: 'plate-round', includeBase: true, baseColorId: 26 };
  const list = buildOrderList(p);
  assert.ok(list.totalRisers > 0);
  assert.equal(list.totalRisers, planRisers(p).length);
  assert.match(orderListToBrickLinkXml(list), /<ITEMID>3035<\/ITEMID>/); // 4×8 als Sockel
  const html = buildInstructionsHtml(p);
  assert.ok(html.includes('Ebene +1 · Sockel') && html.includes('Ebene +2 · Sockel'));
  assert.ok(html.includes('#7b2fbe'));
});
