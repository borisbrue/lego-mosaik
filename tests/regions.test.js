import test from 'node:test';
import assert from 'node:assert/strict';
import { LEGO_COLORS } from '../js/colors.js';
import { preparePalette, reducePalette } from '../js/mosaic.js';
import { segment, regionAt, regionAnchor, applyRegionOps } from '../js/regions.js';

const ci = legoId => LEGO_COLORS.findIndex(c => c.legoId === legoId);
const WHITE = ci(1), BLACK = ci(26), RED = ci(21);
const fill = (px, i, rgb) => px.set(rgb, i * 3);

test('reducePalette: behält die Farben, die das Bild braucht – auch eine kleine, markante', () => {
  const prepared = preparePalette(LEGO_COLORS);
  // 100 Zellen: 60 fast schwarz, 36 fast weiß, 4 knallrot
  const px = new Float32Array(100 * 3);
  for (let i = 0; i < 100; i++) fill(px, i, i < 60 ? [12, 14, 18] : i < 96 ? [245, 245, 245] : [200, 25, 10]);
  const keep = reducePalette(px, prepared, 3);
  assert.equal(keep.length, 3);
  assert.deepEqual(new Set(keep), new Set([BLACK, WHITE, RED]));
  const two = reducePalette(px, prepared, 2);
  assert.deepEqual(new Set(two), new Set([BLACK, WHITE]));
});

test('reducePalette: festgehaltene Farben bleiben, n ≥ Palette gibt alles zurück', () => {
  const prepared = preparePalette(LEGO_COLORS);
  const px = new Float32Array(10 * 3);
  for (let i = 0; i < 10; i++) fill(px, i, [12, 14, 18]);
  const keep = reducePalette(px, prepared, 2, new Set([RED]));
  assert.ok(keep.includes(RED) && keep.includes(BLACK), JSON.stringify(keep));
  assert.equal(reducePalette(px, prepared, 0).length, LEGO_COLORS.length);
  assert.equal(reducePalette(px, prepared, 99).length, LEGO_COLORS.length);
});

/** 12×8: dunkler Hintergrund, helles Rechteck, roter Balken unten. */
function scene() {
  const cols = 12, rows = 8, px = new Float32Array(cols * rows * 3), grid = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x;
    const inBox = x >= 2 && x < 6 && y >= 2 && y < 5, bar = y === 7;
    fill(px, i, inBox ? [240, 240, 240] : bar ? [200, 20, 10] : [10 + (x % 2) * 6, 12, 20]); // leichtes Rauschen im Hintergrund
    grid[i] = inBox ? WHITE : bar ? RED : BLACK;
  }
  return { cols, rows, px, grid };
}

test('segment: findet Hintergrund, Rechteck und Balken als eigene Bereiche', () => {
  const { cols, rows, px } = scene();
  const seg = segment(px, cols, rows, 50);
  assert.equal(seg.regions.length, 3, JSON.stringify(seg.regions.map(r => r.size)));
  assert.equal(seg.regions[0].size, 96 - 12 - 12);
  const box = regionAt(seg, cols, rows, 3.5 / cols, 3.5 / rows);
  assert.equal(seg.regions[box].size, 12);
  const a = regionAnchor(seg, cols, rows, box);
  assert.equal(regionAt(seg, cols, rows, a.x, a.y), box);
  for (let i = 0; i < seg.label.length; i++) assert.ok(seg.label[i] >= 0 && seg.label[i] < seg.regions.length);
});

test('applyRegionOps: ausblenden füllt mit der Umgebungsfarbe, umfärben und Ebene', () => {
  const { cols, rows, px, grid } = scene();
  const seg = segment(px, cols, rows, 50);
  const box = { x: 3.5 / cols, y: 3.5 / rows }, bar = { x: 0.5, y: 7.5 / rows };
  const g = Uint8Array.from(grid);
  const { hidden, levels } = applyRegionOps(g, cols, rows, seg, [{ ...box, hide: true, level: 2 }, { ...bar, color: WHITE }]);
  assert.equal(g[3 * cols + 3], BLACK);
  assert.equal(hidden[3 * cols + 3], 1);
  assert.equal(hidden[0], 0);
  assert.equal(levels[3 * cols + 3], 2);
  assert.equal(levels[0], -1);
  assert.equal(g[7 * cols + 5], WHITE);
  assert.equal(g[0], BLACK);
});
