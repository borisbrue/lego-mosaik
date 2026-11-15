import test from 'node:test';
import assert from 'node:assert/strict';
import { planSubstructure, decompose, PLATES } from '../js/substructure.js';
import { paperStuds } from '../js/parts.js';

/** Prüft eine Lage: jede Noppe genau einmal belegt, nur existierende Platten. */
function assertCovers(plates, W, H, name) {
  const cov = new Uint8Array(W * H);
  for (const p of plates) {
    assert.ok(p.part, `${name}: keine LEGO-Platte ${p.w}×${p.h}`);
    assert.deepEqual([Math.min(p.w, p.h), Math.max(p.w, p.h)], [p.part.a, p.part.b]);
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) {
      assert.ok(x < W && y < H, `${name}: Platte ragt über den Rand`);
      cov[y * W + x]++;
    }
  }
  assert.ok(cov.every(v => v === 1), `${name}: Lücke oder Überlappung`);
}

/** Durchgehende Linien, über die keine Platte beider Lagen hinwegreicht (Knickkanten). */
function hingeLines(plates, W, H) {
  const out = [];
  for (let y = 1; y < H; y++) if (!plates.some(p => p.y < y && y < p.y + p.h)) out.push(`y=${y}`);
  for (let x = 1; x < W; x++) if (!plates.some(p => p.x < x && x < p.x + p.w)) out.push(`x=${x}`);
  return out;
}

test('Papierformate: Noppen passen ins Papiermaß, Verhältnis ≈ 1:√2', () => {
  assert.deepEqual(paperStuds('A4'), { cols: 26, rows: 37 });
  assert.deepEqual(paperStuds('A3'), { cols: 37, rows: 52 });
  assert.deepEqual(paperStuds('A2', 'landscape'), { cols: 74, rows: 52 });
  for (const f of ['A4', 'A3', 'A2', 'A1', 'A0']) {
    const { cols, rows } = paperStuds(f);
    assert.ok(Math.abs(rows / cols - Math.SQRT2) < 0.03, `${f}: ${cols}×${rows}`);
  }
});

test('decompose: wenigste Teile, große zuerst, meidet verbotene Fugen', () => {
  assert.deepEqual(decompose(37, [16, 8, 4, 1]).parts, [16, 16, 4, 1]);
  assert.equal(decompose(5, [16, 2]), null);
  const r = decompose(32, [16, 8], new Set([16]));
  assert.ok(!r.parts.slice(0, -1).reduce((acc, l) => (acc.push((acc.at(-1) || 0) + l), acc), []).includes(16));
});

test('Plattenkatalog ohne Dubletten', () => {
  assert.equal(new Set(PLATES.map(p => p.blId)).size, PLATES.length);
  assert.equal(new Set(PLATES.map(p => p.key)).size, PLATES.length);
});

const SIZES = [[26, 37], [37, 26], [37, 52], [52, 74], [74, 52], [74, 105], [105, 148], [48, 48], [64, 96], [9, 11], [8, 8], [17, 33]];
for (const [W, H] of SIZES) {
  test(`Unterbau ${W}×${H}: lückenlos, zwei Lagen, keine Knickkante`, () => {
    const s = planSubstructure(W, H);
    assertCovers(s.top, W, H, 'Lage 2');
    assertCovers(s.bottom, W, H, 'Lage 1');
    assert.equal(s.total, s.top.length + s.bottom.length);
    assert.equal(s.counts.reduce((n, c) => n + c.total, 0), s.total);
    if (W > 16 || H > 16) assert.deepEqual(hingeLines([...s.top, ...s.bottom], W, H), []);
  });
}

test('Unterbau A3: Fugen der beiden Lagen liegen nie übereinander', () => {
  const { cols, rows } = paperStuds('A3');
  const s = planSubstructure(cols, rows);
  const edges = layer => {
    const e = new Set();
    for (const p of layer) {
      if (p.y > 0) for (let x = p.x; x < p.x + p.w; x++) e.add(`h${x},${p.y}`);
      if (p.x > 0) for (let y = p.y; y < p.y + p.h; y++) e.add(`v${p.x},${y}`);
    }
    return e;
  };
  const top = edges(s.top), bottom = edges(s.bottom);
  assert.equal([...top].filter(e => bottom.has(e)).length, 0);
});
