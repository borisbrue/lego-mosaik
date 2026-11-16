// Unterbau aus echten LEGO-Platten für beliebige Mosaikgrößen.
//
// Zwei Lagen:
//   Lage 1 (unten)  – verbindet die Platten der oberen Lage über ihre Fugen hinweg.
//   Lage 2 (oben)   – trägt die Mosaiksteine.
// Jede Lage besteht aus waagrechten Streifen ("Bändern"); jedes Band wird mit Platten
// gleicher Höhe gefüllt. Die Aufteilung wird per dynamischer Programmierung gesucht:
// möglichst wenige Platten, und in Lage 1 möglichst keine Fuge über einer Fuge von Lage 2.

/** Verfügbare LEGO-Platten (Breite ≤ Länge). blId = BrickLink-Teilenummer. */
export const PLATES = [
  [1, 1, '3024'], [1, 2, '3023'], [1, 3, '3623'], [1, 4, '3710'], [1, 6, '3666'], [1, 8, '3460'], [1, 10, '4477'], [1, 12, '60479'],
  [2, 2, '3022'], [2, 3, '3021'], [2, 4, '3020'], [2, 6, '3795'], [2, 8, '3034'], [2, 10, '3832'], [2, 12, '2445'], [2, 14, '91988'], [2, 16, '4282'],
  [4, 4, '3031'], [4, 6, '3032'], [4, 8, '3035'], [4, 10, '3030'], [4, 12, '3029'],
  [6, 6, '3958'], [6, 8, '3036'], [6, 10, '3033'], [6, 12, '3028'], [6, 14, '3456'], [6, 16, '3027'], [6, 24, '3026'],
  [8, 8, '41539'], [8, 16, '92438'],
  [16, 16, '91405'],
].map(([a, b, blId]) => ({ key: `${a}x${b}`, a, b, blId, designId: blId, label: `Platte ${a}×${b}` }));

const plateByDims = new Map();
for (const p of PLATES) { plateByDims.set(`${p.a}x${p.b}`, p); plateByDims.set(`${p.b}x${p.a}`, p); }
export const plateFor = (w, h) => plateByDims.get(`${w}x${h}`);

/** Längen, die es für eine Bandhöhe h als Platte gibt. */
const lengthsFor = h => [...new Set(PLATES.flatMap(p => (p.a === h ? [p.b] : p.b === h ? [p.a] : [])))].sort((a, b) => b - a);
const BAND_HEIGHTS = [...new Set(PLATES.map(p => p.a))].sort((a, b) => b - a); // 16, 8, 6, 4, 2, 1

const PENALTY_SEAM = 20;     // Fuge in Lage 1 direkt über einer senkrechten Fuge von Lage 2
const PENALTY_HINGE = 1000;  // durchgehende waagrechte Fuge in beiden Lagen (Knickkante)

/**
 * Zerlegt die Länge L in Teilstücke aus `lengths` (absteigend sortiert).
 * Kosten: 1 je Stück + Strafe für jede Teilungsstelle in `forbidden`.
 * Bei Gleichstand gewinnt das größte Stück vorne (Reste landen hinten).
 * @returns {{cost:number, parts:number[]}|null}
 */
export function decompose(L, lengths, forbidden = new Set(), penalty = PENALTY_SEAM, pieceCost = () => 1) {
  const dp = new Float64Array(L + 1).fill(Infinity);
  dp[L] = 0;
  for (let x = L - 1; x >= 0; x--) {
    for (const l of lengths) {
      const e = x + l;
      if (e > L || dp[e] === Infinity) continue;
      const c = dp[e] + pieceCost(l, x) + (e < L && forbidden.has(e) ? penalty : 0);
      if (c < dp[x]) dp[x] = c;
    }
  }
  if (dp[0] === Infinity) return null;
  const parts = [];
  for (let x = 0; x < L;) {
    for (const l of lengths) {
      const e = x + l;
      if (e > L || dp[e] === Infinity) continue;
      const c = dp[e] + pieceCost(l, x) + (e < L && forbidden.has(e) ? penalty : 0);
      if (Math.abs(c - dp[x]) < 1e-9) { parts.push(l); x = e; break; }
    }
  }
  return { cost: dp[0], parts };
}

/**
 * Plant eine Lage für W × H Noppen.
 * @param seamsAt (y0, y1) => Set senkrechter Fugen-x der anderen Lage im Bereich [y0, y1)
 * @param hinges  Set waagrechter Fugen-y der anderen Lage
 */
function planLayer(W, H, seamsAt = () => new Set(), hinges = new Set()) {
  const fillCache = new Map();
  const fill = (y0, h) => {
    const k = `${y0}|${h}`;
    if (!fillCache.has(k)) fillCache.set(k, decompose(W, lengthsFor(h), seamsAt(y0, y0 + h)));
    return fillCache.get(k);
  };
  // Bänder: DP über y, Kosten eines Bandes = Plattenzahl seiner Füllung
  const bandCost = (h, y) => { const f = fill(y, h); return f ? f.cost : Infinity; };
  const bands = decompose(H, BAND_HEIGHTS, hinges, PENALTY_HINGE, bandCost);
  if (!bands) throw new Error(`Kein Unterbau für ${W}×${H} gefunden`);
  const plates = [];
  let y = 0;
  for (const h of bands.parts) {
    let x = 0;
    for (const w of fill(y, h).parts) {
      plates.push({ x, y, w, h, part: plateFor(w, h) });
      x += w;
    }
    y += h;
  }
  return plates;
}

/** Fugen einer Lage: senkrechte Fugen je Bereich und waagrechte Bandgrenzen. */
function seamsOf(plates, W, H) {
  const hinges = new Set();
  for (const p of plates) if (p.y > 0) hinges.add(p.y);
  const seamsAt = (y0, y1) => {
    const s = new Set();
    for (const p of plates) if (p.y < y1 && p.y + p.h > y0 && p.x + p.w < W) s.add(p.x + p.w);
    return s;
  };
  return { hinges, seamsAt };
}

/**
 * Plant den kompletten Unterbau.
 * @returns {{top: Plate[], bottom: Plate[], counts: {part, top, bottom, total}[], total: number}}
 */
const planCache = new Map();
/** Wie planSubstructureUncached, aber je Größe nur einmal berechnet. */
export function planSubstructure(cols, rows) {
  const k = `${cols}x${rows}`;
  if (!planCache.has(k)) { if (planCache.size > 20) planCache.clear(); planCache.set(k, planSubstructureUncached(cols, rows)); }
  return planCache.get(k);
}

function planSubstructureUncached(cols, rows) {
  // Waagrechte und senkrechte Bänder probieren, die Variante mit weniger Platten gewinnt.
  // (Bei ungerader Breite passen z. B. keine 16×16-Platten in waagrechte Bänder.)
  const plan = (W, H) => {
    const top = planLayer(W, H);
    const { hinges, seamsAt } = seamsOf(top, W, H);
    return { top, bottom: planLayer(W, H, seamsAt, hinges) };
  };
  const flip = ps => ps.map(p => ({ x: p.y, y: p.x, w: p.h, h: p.w, part: p.part }));
  const a = plan(cols, rows), b = plan(rows, cols);
  const useB = b.top.length + b.bottom.length < a.top.length + a.bottom.length;
  const top = useB ? flip(b.top) : a.top, bottom = useB ? flip(b.bottom) : a.bottom;
  const byKey = new Map();
  const add = (layer, name) => {
    for (const p of layer) {
      const e = byKey.get(p.part.key) || { part: p.part, top: 0, bottom: 0, total: 0 };
      e[name]++; e.total++;
      byKey.set(p.part.key, e);
    }
  };
  add(top, 'top'); add(bottom, 'bottom');
  const counts = [...byKey.values()].sort((a, b) => b.part.a * b.part.b - a.part.a * a.part.b);
  return { top, bottom, counts, total: top.length + bottom.length };
}
