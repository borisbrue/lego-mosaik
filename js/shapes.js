// Formen einrasten: In flachen Grafiken geschlossene Objekte finden (Knöpfe, Steuerkreuz, Symbole)
// und jedes so leicht verschieben und skalieren, dass seine Kanten auf Noppengrenzen fallen.
// Dann wird ein Kreuz zu einem sauberen Kreuz und ein Kreis zu einem Kreis aus passenden Formteilen,
// statt halb getroffene Zellen in Mischformen zu zerlegen. Arbeitet auf dem Teilraster
// (S×S Teilpixel je Noppe, Farbindizes). DOM-frei, getestet.
import { components, overlayMask, SMALL_CODES, simplify } from './pieces.js';

// Skalierungen: grob in 0,1er-Schritten, danach ±0,05 um den besten Wert
const COARSE = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];

/**
 * @param g  Uint8Array Farbindex je Teilpixel (W × H), wird nicht verändert
 * @param S  Teilpixel je Noppe
 * @param opts.minCells kleinstes Objekt (Fläche in Noppen), opts.maxShare größtes Objekt (Anteil am Bild)
 * @returns {{g: Uint8Array, cells: Uint8Array, objects: Array}} – g: neues Teilraster,
 *          cells: 1 = Noppe gehört zu einem eingerasteten Objekt (dort sind Formteile sinnvoll)
 */
export function snapObjects(g0, W, H, S, { minCells = 1, maxShare = 0.12, maxCells = 400 } = {}) {
  const cols = W / S, rows = H / S;
  // Sprenkel (JPEG, Farbe zwischen zwei LEGO-Farben) kleiner als eine halbe Noppe verschmelzen,
  // sonst zerfällt eine Fläche in Flecken und wird nicht als Form erkannt
  const g = Uint8Array.from(g0);
  simplify(g, W, H, (S * S) >> 1);
  const { label, sizes } = components(g, W, H);
  const nComp = sizes.length;
  // Begrenzungsrahmen je Fläche
  const x0 = new Int32Array(nComp).fill(W), y0 = new Int32Array(nComp).fill(H), x1 = new Int32Array(nComp).fill(-1), y1 = new Int32Array(nComp).fill(-1);
  const color = new Uint8Array(nComp);
  for (let i = 0; i < W * H; i++) {
    const l = label[i], x = i % W, y = (i / W) | 0;
    color[l] = g[i];
    if (x < x0[l]) x0[l] = x; if (x > x1[l]) x1[l] = x;
    if (y < y0[l]) y0[l] = y; if (y > y1[l]) y1[l] = y;
  }
  const SS = S * S, maxArea = Math.min(maxShare * W * H, maxCells * SS), minArea = minCells * SS;
  // Objekte = Löcher in einfarbigen Flächen (beliebig viele Farben darin): grauer Kreis mit Kreuz,
  // Mulde mit zwei Knöpfen … Eine dünne Umrandung, die von Inhalten durchbrochen wird, stört so nicht.
  const cand = [];
  for (let l = 0; l < nComp; l++) {
    if (sizes[l] < 4 * SS) continue;
    const bw = x1[l] - x0[l] + 1, bh = y1[l] - y0[l] + 1;
    if (bw * bh - sizes[l] < minArea) continue;
    for (const hole of holes(l, label, W, x0[l], y0[l], bw, bh)) {
      if (hole.area < minArea || hole.area > maxArea) continue;
      cand.push({ ...hole, bg: color[l] });
    }
  }
  // Nur äußerste Objekte: was in einem anderen Objekt liegt, wandert mit ihm
  cand.sort((a, b) => b.area - a.area);
  const owner = new Int32Array(W * H).fill(-1), objects = [];
  for (const c of cand) {
    let inside = false;
    for (let yy = 0; yy < c.h && !inside; yy++) for (let xx = 0; xx < c.w; xx++) {
      if (c.mask[yy * c.w + xx] && owner[(c.y + yy) * W + c.x + xx] >= 0) { inside = true; break; }
    }
    if (inside) continue;
    const id = objects.length;
    for (let yy = 0; yy < c.h; yy++) for (let xx = 0; xx < c.w; xx++) if (c.mask[yy * c.w + xx]) owner[(c.y + yy) * W + c.x + xx] = id;
    objects.push(c);
  }
  const out = Uint8Array.from(g), cells = new Uint8Array(cols * rows);
  for (let id = 0; id < objects.length; id++) {
    const o = objects[id];
    const best = bestFit(o, g, W, S);
    Object.assign(o, best);
    // alte Fläche mit der Umgebungsfarbe füllen …
    for (let yy = 0; yy < o.h; yy++) for (let xx = 0; xx < o.w; xx++) if (o.mask[yy * o.w + xx]) out[(o.y + yy) * W + o.x + xx] = o.bg;
    // … und das Objekt eingerastet neu zeichnen – nur auf eigener Fläche oder Umgebungsfarbe
    raster(o, g, W, best.s, best.dx, best.dy, (X, Y, c) => {
      if (X < 0 || Y < 0 || X >= W || Y >= H) return;
      const i = Y * W + X;
      if (owner[i] !== id && g[i] !== o.bg) return;
      out[i] = c;
      if (c !== o.bg) cells[((Y / S) | 0) * cols + ((X / S) | 0)] = 1;
    });
  }
  const discs = snapDiscs(out, W, H, S, cells);
  return { g: out, cells, objects, discs };
}

/**
 * Kreise erkennen (einfarbig, ohne Löcher, fast quadratisch, füllt ≈ π/4 des Rahmens) und durch einen
 * idealen Kreis mit ganzzahligem Durchmesser in Noppen ersetzen, genau aufs Raster gesetzt:
 * gerader Durchmesser auf Noppengrenzen, ungerader auf eine Noppenmitte. Dann ergeben 2 Noppen einen
 * Kreis aus vier Viertelkreis-Fliesen. Ändert g und cells in place.
 */
export function snapDiscs(g, W, H, S, cells) {
  const cols = W / S;
  const { label, sizes } = components(g, W, H);
  const n = sizes.length;
  const x0 = new Int32Array(n).fill(W), y0 = new Int32Array(n).fill(H), x1 = new Int32Array(n).fill(-1), y1 = new Int32Array(n).fill(-1);
  for (let i = 0; i < W * H; i++) {
    const l = label[i], x = i % W, y = (i / W) | 0;
    if (x < x0[l]) x0[l] = x; if (x > x1[l]) x1[l] = x; if (y < y0[l]) y0[l] = y; if (y > y1[l]) y1[l] = y;
  }
  const found = [];
  // Prüft die Pixel von Fläche l im Rahmen (bx0..bx1, by0..by1) auf Kreisform
  const tryDisc = (l, bx0, by0, bx1, by1) => {
    let ax0 = W, ay0 = H, ax1 = -1, ay1 = -1, cnt = 0;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) if (label[y * W + x] === l) {
      cnt++; if (x < ax0) ax0 = x; if (x > ax1) ax1 = x; if (y < ay0) ay0 = y; if (y > ay1) ay1 = y;
    }
    const w = ax1 - ax0 + 1, h = ay1 - ay0 + 1;
    if (!cnt || Math.min(w, h) < 0.75 * S || Math.max(w, h) > 12 * S) return null;
    if (Math.abs(w - h) > Math.max(1, 0.2 * Math.max(w, h))) return null;
    const fill = cnt / (w * h);
    if (fill < 0.66 || fill > 0.9) return null;
    return { cx: (ax0 + ax1 + 1) / 2, cy: (ay0 + ay1 + 1) / 2, d: Math.max(1, Math.round((w + h) / 2 / S)), box: [ax0, ay0, ax1, ay1] };
  };
  for (let l = 0; l < n; l++) {
    const w = x1[l] - x0[l] + 1, h = y1[l] - y0[l] + 1;
    if (Math.min(w, h) < 0.75 * S || Math.max(w, h) > 24 * S) continue;
    if (x0[l] === 0 || y0[l] === 0 || x1[l] === W - 1 || y1[l] === H - 1) continue;
    // Umgebungsfarbe: häufigster Nachbar außerhalb
    const cnt = new Map();
    let c = -1;
    for (let y = y0[l]; y <= y1[l]; y++) for (let x = x0[l]; x <= x1[l]; x++) {
      const i = y * W + x;
      if (label[i] !== l) continue;
      c = g[i];
      for (const j of [i - 1, i + 1, i - W, i + W]) if (label[j] !== l) cnt.set(g[j], (cnt.get(g[j]) || 0) + 1);
    }
    let bg = -1, bn = 0, tot = 0;
    for (const [k, v] of cnt) { tot += v; if (v > bn) { bn = v; bg = k; } }
    if (bn < 0.5 * tot) continue;
    let discs = [];
    const one = tryDisc(l, x0[l], y0[l], x1[l], y1[l]);
    if (one) discs = [one];
    else if (w / h > 1.6 && w / h < 2.5) { // zwei Kreise nebeneinander, die sich berühren
      const m = x0[l] + (w >> 1);
      discs = [tryDisc(l, x0[l], y0[l], m - 1, y1[l]), tryDisc(l, m, y0[l], x1[l], y1[l])];
    } else if (h / w > 1.6 && h / w < 2.5) { // übereinander
      const m = y0[l] + (h >> 1);
      discs = [tryDisc(l, x0[l], y0[l], x1[l], m - 1), tryDisc(l, x0[l], m, x1[l], y1[l])];
    }
    if (!discs.length || discs.some(d => !d)) continue;
    found.push({ l, c, bg, discs });
  }
  for (const f of found) {
    // alte Fläche mit der Umgebung füllen, dazu den Saum aus Kantenglättung (schmale Fremdfarben am Rand)
    const ex0 = Math.max(0, x0[f.l] - 1), ey0 = Math.max(0, y0[f.l] - 1), ex1 = Math.min(W - 1, x1[f.l] + 1), ey1 = Math.min(H - 1, y1[f.l] + 1);
    const cnt = new Map();
    for (let y = ey0; y <= ey1; y++) for (let x = ex0; x <= ex1; x++) { const c = g[y * W + x]; cnt.set(c, (cnt.get(c) || 0) + 1); }
    for (let y = ey0; y <= ey1; y++) for (let x = ex0; x <= ex1; x++) {
      const i = y * W + x;
      if (label[i] === f.l || (g[i] !== f.bg && cnt.get(g[i]) < 0.3 * sizes[f.l])) g[i] = f.bg;
    }
  }
  const out = [];
  for (const f of found) for (const dsc of f.discs) {
    const snapC = v => (dsc.d % 2 ? Math.round((v - S / 2) / S) * S + S / 2 : Math.round(v / S) * S);
    const cx = snapC(dsc.cx), cy = snapC(dsc.cy), r = (dsc.d * S) / 2;
    // Je Noppe die baubare Form wählen, die dem idealen Kreis am nächsten kommt:
    // voll, leer oder ein Viertel-/Halbkreis in passender Drehung – und genau so malen.
    const masks = pieceMasks(S), SS = S * S, ideal = new Uint8Array(SS);
    for (let Y = Math.floor((cy - r) / S) * S; Y < cy + r; Y += S) for (let X = Math.floor((cx - r) / S) * S; X < cx + r; X += S) {
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      let cov = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const v = (X + sx + 0.5 - cx) ** 2 + (Y + sy + 0.5 - cy) ** 2 <= r * r ? 1 : 0;
        ideal[sy * S + sx] = v; cov += v;
      }
      // Formteile bevorzugt (Faktor 0,6): ein Kreis mit Viertelkreisen am Rand wirkt runder als ein Achteck
      let best = 'empty', bestE = cov;
      if ((SS - cov) * 0.6 < bestE) { best = 'full'; bestE = (SS - cov) * 0.6; }
      for (const m of masks) {
        let e = 0;
        for (let k = 0; k < SS; k++) if (m[k] !== ideal[k]) e++;
        if (e * 0.6 < bestE) { bestE = e * 0.6; best = m; }
      }
      if (best === 'empty') continue;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const i = (Y + sy) * W + X + sx;
        if (g[i] !== f.bg && label[i] !== f.l) continue; // nichts anderes übermalen
        if (best === 'full' || best[sy * S + sx]) g[i] = f.c;
      }
      cells[(Y / S) * cols + X / S] = 1;
    }
    out.push({ color: f.c, d: dsc.d, cx, cy });
  }
  return out;
}

/**
 * Löcher der Fläche l: zusammenhängende Gebiete aus anderen Farben, die ringsum von l umschlossen
 * sind. Je Loch: Rahmen (x, y, w, h), Maske und Fläche in Teilpixeln.
 */
function holes(l, label, W, bx, by, bw, bh) {
  const ew = bw + 2, eh = bh + 2, mark = new Int32Array(ew * eh); // 0 = offen, -1 = Fläche l / außen
  const wall = (ex, ey) => ex > 0 && ey > 0 && ex <= bw && ey <= bh && label[(by + ey - 1) * W + bx + ex - 1] === l;
  for (let ey = 0; ey < eh; ey++) for (let ex = 0; ex < ew; ex++) if (wall(ex, ey)) mark[ey * ew + ex] = -1;
  const stack = [];
  const flood = (start, v) => {
    const pts = [];
    mark[start] = v; stack.push(start);
    while (stack.length) {
      const e = stack.pop(), ex = e % ew, ey = (e / ew) | 0;
      pts.push(e);
      if (ex > 0 && !mark[e - 1]) { mark[e - 1] = v; stack.push(e - 1); }
      if (ex < ew - 1 && !mark[e + 1]) { mark[e + 1] = v; stack.push(e + 1); }
      if (ey > 0 && !mark[e - ew]) { mark[e - ew] = v; stack.push(e - ew); }
      if (ey < eh - 1 && !mark[e + ew]) { mark[e + ew] = v; stack.push(e + ew); }
    }
    return pts;
  };
  flood(0, -1); // Außenraum
  const out = [];
  for (let e = 0; e < ew * eh; e++) {
    if (mark[e]) continue;
    const pts = flood(e, out.length + 1);
    let hx0 = ew, hy0 = eh, hx1 = 0, hy1 = 0;
    for (const p of pts) { const ex = p % ew, ey = (p / ew) | 0; if (ex < hx0) hx0 = ex; if (ex > hx1) hx1 = ex; if (ey < hy0) hy0 = ey; if (ey > hy1) hy1 = ey; }
    const w = hx1 - hx0 + 1, h = hy1 - hy0 + 1, mask = new Uint8Array(w * h);
    for (const p of pts) mask[((p / ew | 0) - hy0) * w + (p % ew) - hx0] = 1;
    out.push({ x: bx + hx0 - 1, y: by + hy0 - 1, w, h, mask, area: pts.length });
  }
  return out;
}

/** Objekt mit Skalierung s um den Mittelpunkt und Verschiebung (dx, dy) Teilpixel rastern. */
function raster(o, g, W, s, dx, dy, put, S = 1) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  // auf ganze Noppen erweitert, damit angeschnittene Noppen vollständig zählen
  const X0 = Math.floor((cx + dx - (o.w / 2) * s - 1) / S) * S, X1 = Math.ceil((cx + dx + (o.w / 2) * s + 1) / S) * S;
  const Y0 = Math.floor((cy + dy - (o.h / 2) * s - 1) / S) * S, Y1 = Math.ceil((cy + dy + (o.h / 2) * s + 1) / S) * S;
  for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) {
    const sx = Math.floor(cx + (X + 0.5 - cx - dx) / s) - o.x, sy = Math.floor(cy + (Y + 0.5 - cy - dy) / s) - o.y;
    const inside = sx >= 0 && sy >= 0 && sx < o.w && sy < o.h && o.mask[sy * o.w + sx];
    put(X, Y, inside ? g[(o.y + sy) * W + o.x + sx] : o.bg);
  }
}

/** Binäre Masken der 1×1-Formteile (Viertel-, Halbkreis in allen Drehungen) je Teilraster-Größe. */
const maskCache = new Map();
function pieceMasks(S) {
  if (!maskCache.has(S)) maskCache.set(S, SMALL_CODES.map(c => Uint8Array.from(overlayMask(c, S), v => (v >= 0.5 ? 1 : 0))));
  return maskCache.get(S);
}

/**
 * Fehler einer Noppe (Teilpixel-Farben): Teilpixel, die nicht zur besten LEGO-Darstellung passen –
 * entweder einfarbig oder ein 1×1-Formteil (Teil in einer Farbe, Platte darunter in einer anderen).
 */
function cellError(px, masks, cntA, cntB) {
  const SS = px.length, first = px[0];
  let pure = true;
  for (let k = 1; k < SS; k++) if (px[k] !== first) { pure = false; break; }
  if (pure) return 0;
  // einfarbig: häufigste Farbe (Zähler danach nur für die benutzten Farben zurücksetzen)
  let mx = 0;
  for (let k = 0; k < SS; k++) { const v = ++cntA[px[k]]; if (v > mx) mx = v; }
  for (let k = 0; k < SS; k++) cntA[px[k]] = 0;
  let best = SS - mx;
  for (const m of masks) {
    let ma = 0, mb = 0;
    for (let k = 0; k < SS; k++) {
      if (m[k]) { const v = ++cntA[px[k]]; if (v > ma) ma = v; } else { const v = ++cntB[px[k]]; if (v > mb) mb = v; }
    }
    for (let k = 0; k < SS; k++) { cntA[px[k]] = 0; cntB[px[k]] = 0; }
    const e = SS - ma - mb;
    if (e < best) best = e;
  }
  return best;
}

/**
 * Beste Lage: Verschiebung (bis ± halbe Noppe) und Skalierung, bei der sich das Objekt am genauesten
 * aus LEGO-Teilen bauen lässt (einfarbige Noppen oder passende Viertel-/Halbkreise).
 */
function bestFit(o, g, W, S) {
  const coarse = fitScales(o, g, W, S, COARSE, null);
  return fitScales(o, g, W, S, [coarse.s - 0.05, coarse.s + 0.05].filter(v => v >= 0.65 && v <= 1.35), coarse);
}

function fitScales(o, g, W, S, scales, best) {
  const half = S / 2, SS = S * S, masks = pieceMasks(S);
  const cntA = new Uint16Array(256), cntB = new Uint16Array(256), px = new Uint8Array(SS);
  for (const s of scales) for (let dy = -half; dy < half; dy++) for (let dx = -half; dx < half; dx++) {
    const { buf, bw, bh, area } = rasterBuf(o, g, W, s, dx, dy, S);
    if (!area) continue;
    let err = 0;
    for (let cy = 0; cy < bh; cy += S) for (let cx = 0; cx < bw; cx += S) {
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) px[sy * S + sx] = buf[(cy + sy) * bw + cx + sx];
      err += cellError(px, masks, cntA, cntB);
    }
    const score = err / area + 0.25 * Math.abs(s - 1) + 0.004 * (Math.abs(dx) + Math.abs(dy));
    if (!best || score < best.score) best = { s, dx, dy, score };
  }
  return best;
}

/** Wie raster, aber direkt in einen Puffer (auf ganze Noppen ausgerichtet) – für die Suche. */
function rasterBuf(o, g, W, s, dx, dy, S) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
  const X0 = Math.floor((cx + dx - (o.w / 2) * s - 1) / S) * S, X1 = Math.ceil((cx + dx + (o.w / 2) * s + 1) / S) * S;
  const Y0 = Math.floor((cy + dy - (o.h / 2) * s - 1) / S) * S, Y1 = Math.ceil((cy + dy + (o.h / 2) * s + 1) / S) * S;
  const bw = X1 - X0, bh = Y1 - Y0, buf = new Uint8Array(bw * bh).fill(o.bg);
  const inv = 1 / s;
  let area = 0;
  for (let Y = Y0; Y < Y1; Y++) {
    const sy = Math.floor(cy + (Y + 0.5 - cy - dy) * inv) - o.y;
    if (sy < 0 || sy >= o.h) continue;
    for (let X = X0; X < X1; X++) {
      const sx = Math.floor(cx + (X + 0.5 - cx - dx) * inv) - o.x;
      if (sx < 0 || sx >= o.w || !o.mask[sy * o.w + sx]) continue;
      const c = g[(o.y + sy) * W + o.x + sx];
      buf[(Y - Y0) * bw + X - X0] = c;
      if (c !== o.bg) area++;
    }
  }
  return { buf, bw, bh, area };
}
