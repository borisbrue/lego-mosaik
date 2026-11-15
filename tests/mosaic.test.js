import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab, deltaE2000, boxDownsample, preparePalette, quantize, floodFill, adjustPixels } from '../js/mosaic.js';
import { LEGO_COLORS } from '../js/colors.js';
import { buildOrderList, orderListToBrickLinkXml, orderListToCsv } from '../js/orderlist.js';
import { buildLegend, buildInstructionsHtml } from '../js/instructions.js';

test('LEGO-Farbtabelle ist eindeutig und vollständig', () => {
  const lego = new Set(), bl = new Set();
  for (const c of LEGO_COLORS) {
    assert.match(c.hex, /^#[0-9A-F]{6}$/i);
    assert.ok(!lego.has(c.legoId), `doppelte LEGO-ID ${c.legoId}`);
    assert.ok(!bl.has(c.blId), `doppelte BrickLink-ID ${c.blId}`);
    lego.add(c.legoId); bl.add(c.blId);
  }
  assert.ok(LEGO_COLORS.length < 256, 'Grid nutzt Uint8Array');
});

test('CIEDE2000 Referenzwert (Sharma et al.)', () => {
  const d = deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]);
  assert.ok(Math.abs(d - 2.0425) < 1e-3, `got ${d}`);
  assert.equal(deltaE2000([50, 10, 10], [50, 10, 10]), 0);
});

test('rgbToLab: Weiß und Schwarz', () => {
  const w = rgbToLab(255, 255, 255), k = rgbToLab(0, 0, 0);
  assert.ok(Math.abs(w[0] - 100) < 0.01 && Math.abs(w[1]) < 0.01);
  assert.ok(Math.abs(k[0]) < 0.01);
});

test('boxDownsample mittelt Blöcke', () => {
  const w = 4, h = 2, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, v = x < 2 ? 0 : 200;
    data.set([v, v, v, 255], i);
  }
  const out = boxDownsample(data, w, h, 2, 1);
  assert.deepEqual(Array.from(out), [0, 0, 0, 200, 200, 200]);
});

test('quantize wählt die nächste LEGO-Farbe', () => {
  const pal = preparePalette([{ hex: '#FFFFFF' }, { hex: '#05131D' }, { hex: '#C91A09' }]);
  const px = Float32Array.from([250, 250, 250, 10, 10, 10, 200, 30, 20]);
  assert.deepEqual(Array.from(quantize(px, 3, 1, pal)), [0, 1, 2]);
});

test('Dithering erzeugt Mischmuster für Mittelgrau', () => {
  const pal = preparePalette([{ hex: '#FFFFFF' }, { hex: '#000000' }]);
  const px = new Float32Array(16 * 16 * 3).fill(128);
  const q = quantize(px, 16, 16, pal, { dither: 1 });
  const whites = q.filter(v => v === 0).length;
  assert.ok(whites > 60 && whites < 196, `whites=${whites}`);
});

test('adjustPixels klemmt Werte', () => {
  const px = Float32Array.from([250, 10, 128]);
  adjustPixels(px, { brightness: 60, contrast: 60, saturation: 100 });
  for (const v of px) assert.ok(v >= 0 && v <= 255);
});

test('floodFill füllt nur zusammenhängende Fläche', () => {
  const g = Uint8Array.from([1, 1, 2, 1, 2, 2, 2, 1, 1]);
  const changed = floodFill(g, 3, 3, 0, 5);
  assert.deepEqual(Array.from(g), [5, 5, 2, 5, 2, 2, 2, 1, 1]);
  assert.equal(changed.length, 3);
});

test('Bestellliste, BrickLink-XML und CSV', () => {
  const white = LEGO_COLORS.findIndex(c => c.legoId === 1), black = LEGO_COLORS.findIndex(c => c.legoId === 26);
  const grid = new Uint8Array(32 * 16).fill(white);
  grid.fill(black, 0, 100);
  const list = buildOrderList({ cols: 32, rows: 16, grid, part: 'plate-round', sparePercent: 10, baseColorId: 26 });
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0].needed, 412);
  assert.equal(list.items[0].qty, 412 + 42);
  assert.equal(list.base.qty, 2);
  const xml = orderListToBrickLinkXml(list);
  assert.match(xml, /<ITEMID>4073<\/ITEMID>\s*<COLOR>1<\/COLOR>\s*<MINQTY>454<\/MINQTY>/);
  assert.match(xml, /<ITEMID>91405<\/ITEMID>\s*<COLOR>11<\/COLOR>\s*<MINQTY>2<\/MINQTY>/);
  const csv = orderListToCsv(list);
  assert.equal(csv.trim().split('\r\n').length, 4);
});

test('Anleitung: eine Seite pro Abschnitt + Deckblatt', () => {
  const grid = new Uint8Array(48 * 32).map((_, i) => i % 3);
  const legend = buildLegend(grid);
  assert.equal(legend.entries.length, 3);
  const html = buildInstructionsHtml({ cols: 48, rows: 32, grid, part: 'tile' }, 'Test <x>');
  assert.equal((html.match(/class="page /g) || []).length, 1 + 6);
  assert.ok(html.includes('Test &lt;x&gt;'));
});
