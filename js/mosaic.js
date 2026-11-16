// Reine Bildverarbeitung (ohne DOM) – testbar mit Node.

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// CIEDE2000-Farbabstand
export function deltaE2000(l1, l2) {
  const [L1, a1, b1] = l1, [L2, a2, b2] = l2;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (b, a) => { if (a === 0 && b === 0) return 0; const v = Math.atan2(b, a) / rad; return v < 0 ? v + 360 : v; };
  const h1p = h(b1, a1p), h2p = h(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lmp = (L1 + L2) / 2, Cmp = (C1p + C2p) / 2;
  let hmp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hmp += h1p + h2p < 360 ? 360 : -360;
    hmp /= 2;
  }
  const T = 1 - 0.17 * Math.cos((hmp - 30) * rad) + 0.24 * Math.cos(2 * hmp * rad)
    + 0.32 * Math.cos((3 * hmp + 6) * rad) - 0.2 * Math.cos((4 * hmp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2);
  const Sc = 1 + 0.045 * Cmp, Sh = 1 + 0.015 * Cmp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/**
 * Mittelt ein RGBA-Bild (Breite w, Höhe h) blockweise auf cols×rows Zellen.
 * Liefert Float32Array mit 3 Werten (RGB) pro Zelle. Transparenz wird mit Weiß hinterlegt.
 */
export function boxDownsample(data, w, h, cols, rows) {
  const out = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      let sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4;
        for (let x = x0; x < x1; x++, i += 4) {
          const a = data[i + 3] / 255;
          sr += data[i] * a + 255 * (1 - a);
          sg += data[i + 1] * a + 255 * (1 - a);
          sb += data[i + 2] * a + 255 * (1 - a);
          n++;
        }
      }
      const o = (r * cols + c) * 3;
      out[o] = sr / n; out[o + 1] = sg / n; out[o + 2] = sb / n;
    }
  }
  return out;
}

/**
 * Unscharf maskieren auf RGBA-Daten (in place): Bild + amount · (Bild − Weichzeichnung).
 * Weichzeichnung = zweifacher Box-Blur mit Radius r (≈ Gauß).
 */
export function unsharpMask(data, w, h, amount, r) {
  if (amount <= 0 || r < 1) return data;
  const n = w * h;
  const ch = new Float32Array(n), tmp = new Float32Array(n);
  const blurH = (src, dst) => {
    for (let y = 0; y < h; y++) {
      let s = 0; const row = y * w;
      for (let x = -r; x <= r; x++) s += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        dst[row + x] = s / (2 * r + 1);
        s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
  };
  const blurV = (src, dst) => {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += src[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        dst[y * w + x] = s / (2 * r + 1);
        s += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
  };
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) ch[i] = data[i * 4 + c];
    const orig = Float32Array.from(ch);
    blurH(ch, tmp); blurV(tmp, ch); blurH(ch, tmp); blurV(tmp, ch);
    for (let i = 0; i < n; i++) data[i * 4 + c] = clamp(orig[i] + amount * (orig[i] - ch[i]));
  }
  return data;
}

/**
 * Wie boxDownsample, schiebt den Zellwert aber Richtung der größeren von zwei Farbgruppen
 * (2-Means je Zelle). Dadurch kippt eine Kantenzelle zur dominanten Seite statt zu einem
 * Mischton zu verschwimmen. dominance 0..1 (0 = reiner Mittelwert).
 */
export function dominantDownsample(data, w, h, cols, rows, dominance) {
  const out = boxDownsample(data, w, h, cols, rows);
  if (dominance <= 0) return out;
  const base = Float32Array.from(out);
  // Mittelwert der 8 Nachbarzellen: das Umfeld, gegen das sich ein Merkmal abheben muss
  const around = (r, c) => {
    const m = [0, 0, 0]; let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const y = r + dy, x = c + dx;
      if ((!dx && !dy) || y < 0 || x < 0 || y >= rows || x >= cols) continue;
      const o = (y * cols + x) * 3; m[0] += base[o]; m[1] += base[o + 1]; m[2] += base[o + 2]; n++;
    }
    return m.map(v => v / n);
  };
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const px = [];
  for (let r = 0; r < rows; r++) {
    const y0 = Math.floor((r * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((r + 1) * h) / rows));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((c + 1) * w) / cols));
      px.length = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4, a = data[i + 3] / 255;
        px.push([data[i] * a + 255 * (1 - a), data[i + 1] * a + 255 * (1 - a), data[i + 2] * a + 255 * (1 - a)]);
      }
      if (px.length < 4) continue;
      // Startzentren: hellstes und dunkelstes Pixel
      let lo = px[0], hi = px[0];
      for (const p of px) { const s = p[0] + p[1] + p[2]; if (s < lo[0] + lo[1] + lo[2]) lo = p; if (s > hi[0] + hi[1] + hi[2]) hi = p; }
      let c0 = lo.slice(), c1 = hi.slice(), n0 = 0, n1 = 0;
      for (let it = 0; it < 4; it++) {
        const s0 = [0, 0, 0], s1 = [0, 0, 0]; n0 = 0; n1 = 0;
        for (const p of px) {
          const d0 = (p[0] - c0[0]) ** 2 + (p[1] - c0[1]) ** 2 + (p[2] - c0[2]) ** 2;
          const d1 = (p[0] - c1[0]) ** 2 + (p[1] - c1[1]) ** 2 + (p[2] - c1[2]) ** 2;
          if (d0 <= d1) { s0[0] += p[0]; s0[1] += p[1]; s0[2] += p[2]; n0++; } else { s1[0] += p[0]; s1[1] += p[1]; s1[2] += p[2]; n1++; }
        }
        if (n0) c0 = s0.map(v => v / n0);
        if (n1) c1 = s1.map(v => v / n1);
      }
      // Adaptiv: je deutlicher die zwei Gruppen getrennt sind (Schrift, Fenster, harte Kanten),
      // desto stärker zählt die dominante Gruppe. Weiche Flächen (Haut, Verläufe) bleiben Mittelwert.
      if (!n0 || !n1) continue;
      const sep = Math.sqrt((c0[0] - c1[0]) ** 2 + (c0[1] - c1[1]) ** 2 + (c0[2] - c1[2]) ** 2);
      const f = Math.min(1, Math.max(0, (sep - 40) / 70));
      if (!f) continue;
      const wt = f * f * (3 - 2 * f) * dominance;
      // Größere Gruppe gewinnt – außer die kleinere füllt ≥ 30 % und hebt sich stärker vom Umfeld ab
      // (dünne Schrift, Fenster, Lichter): dann ist sie das Merkmal der Zelle.
      let dom = n0 >= n1 ? c0 : c1;
      const minor = n0 >= n1 ? c1 : c0, minorShare = Math.min(n0, n1) / (n0 + n1);
      if (minorShare >= 0.3) { const env = around(r, c); if (d2(minor, env) > d2(dom, env)) dom = minor; }
      const o = (r * cols + c) * 3;
      for (let k = 0; k < 3; k++) out[o + k] += wt * (dom[k] - out[o + k]);
    }
  }
  return out;
}

/**
 * Kantenerhaltendes Glätten auf dem Zellraster (bilateral, 3×3): ähnliche Nachbarn werden
 * gemittelt, deutlich andere nicht. Nimmt Rauschen aus Flächen, ohne Konturen aufzuweichen.
 * @param strength 0..1
 */
export function smoothCells(px, cols, rows, strength) {
  if (strength <= 0) return px;
  const sigma = 14 + 30 * strength, inv = 1 / (2 * sigma * sigma);
  const iters = strength > 0.5 ? 2 : 1;
  // Gewichte als Tabelle über d/16 (d = quadrierter RGB-Abstand, max. 3·255²)
  const lut = new Float32Array(12200);
  for (let k = 0; k < lut.length; k++) lut[k] = Math.exp(-(k * 16 + 8) * inv);
  let src = px;
  for (let it = 0; it < iters; it++) {
    const out = new Float32Array(src.length);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const o = (y * cols + x) * 3;
      let wr = 0, sr = 0, sg = 0, sb = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const q = (ny * cols + nx) * 3;
        const d = (src[q] - src[o]) ** 2 + (src[q + 1] - src[o + 1]) ** 2 + (src[q + 2] - src[o + 2]) ** 2;
        const w = lut[(d / 16) | 0] * (dx && dy ? 0.5 : 1);
        wr += w; sr += w * src[q]; sg += w * src[q + 1]; sb += w * src[q + 2];
      }
      out[o] = sr / wr; out[o + 1] = sg / wr; out[o + 2] = sb / wr;
    }
    src = out;
  }
  px.set(src);
  return px;
}

/** Helligkeit (-100..100), Kontrast (-100..100), Sättigung (-100..100) anwenden (in place). */
export function adjustPixels(px, { brightness = 0, contrast = 0, saturation = 0 } = {}) {
  const b = brightness * 2.55;
  const cf = (259 * (contrast * 2.55 + 255)) / (255 * (259 - contrast * 2.55));
  const s = 1 + saturation / 100;
  for (let i = 0; i < px.length; i += 3) {
    let r = px[i] + b, g = px[i + 1] + b, bl = px[i + 2] + b;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; bl = cf * (bl - 128) + 128;
    const l = 0.299 * r + 0.587 * g + 0.114 * bl;
    r = l + (r - l) * s; g = l + (g - l) * s; bl = l + (bl - l) * s;
    px[i] = clamp(r); px[i + 1] = clamp(g); px[i + 2] = clamp(bl);
  }
  return px;
}

const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Bereitet eine Palette (Array von {hex}) für das Matching vor. */
export function preparePalette(colors) {
  return colors.map(c => {
    const rgb = hexToRgb(c.hex);
    return { rgb, lab: rgbToLab(...rgb) };
  });
}

export function nearestColor(lab, prepared) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < prepared.length; i++) {
    const d = deltaE2000(lab, prepared[i].lab);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Ordnet jeder Zelle die nächstliegende Palettenfarbe zu.
 * @param px Float32Array RGB pro Zelle
 * @param dither 0..1 Stärke des Floyd-Steinberg-Ditherings
 * @returns Uint8Array mit Palettenindizes
 */
export function quantize(px, cols, rows, prepared, { dither = 0 } = {}) {
  const work = Float32Array.from(px);
  const out = new Uint8Array(cols * rows);
  const cache = new Map();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, o = i * 3;
      const r = clamp(work[o]), g = clamp(work[o + 1]), b = clamp(work[o + 2]);
      const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
      let idx = cache.get(key);
      if (idx === undefined) { idx = nearestColor(rgbToLab(r, g, b), prepared); cache.set(key, idx); }
      out[i] = idx;
      if (dither > 0) {
        const p = prepared[idx].rgb;
        const er = (r - p[0]) * dither, eg = (g - p[1]) * dither, eb = (b - p[2]) * dither;
        const spread = (dx, dy, f) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= cols || ny >= rows) return;
          const j = (ny * cols + nx) * 3;
          work[j] += er * f; work[j + 1] += eg * f; work[j + 2] += eb * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
  }
  return out;
}

/** Zählt Steine pro Farbe. grid enthält Indizes in `colors`. */
export function countColors(grid, nColors) {
  const counts = new Array(nColors).fill(0);
  for (const v of grid) counts[v]++;
  return counts;
}

/** Füllt zusammenhängende Fläche gleicher Farbe (4er-Nachbarschaft). Gibt geänderte Indizes zurück. */
export function floodFill(grid, cols, rows, start, value) {
  const target = grid[start];
  if (target === value) return [];
  const changed = [];
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (grid[i] !== target) continue;
    grid[i] = value; changed.push(i);
    const x = i % cols, y = (i / cols) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < cols - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - cols);
    if (y < rows - 1) stack.push(i + cols);
  }
  return changed;
}

/**
 * Wählt die n LEGO-Farben, mit denen sich das Bild am besten darstellen lässt.
 * Start mit allen erlaubten Farben; dann wird immer die Farbe entfernt, deren Wegfall den
 * Fehler am wenigsten erhöht (Fehler = ΔE2000², große Abweichungen zählen stark – so überleben
 * auch kleine, aber markante Farben wie Augen oder Schrift).
 * @param px Float32Array RGB je Zelle
 * @param prepared vorbereitete Palette (preparePalette)
 * @param pinned Set von Indizes in `prepared`, die bleiben müssen
 * @returns aufsteigend sortierte Indizes in `prepared`
 */
export function reducePalette(px, prepared, n, pinned = new Set()) {
  const k = prepared.length;
  if (n <= 0 || n >= k) return prepared.map((_, i) => i);
  // Gleiche Zellfarben zusammenfassen (Gewicht = Anzahl), sonst wird es bei großen Formaten langsam
  const groups = new Map();
  for (let i = 0; i < px.length; i += 3) {
    // Gruppen auf 32 Stufen je Kanal: genau genug für die Auswahl, aber viel schneller
    const key = (Math.round(px[i] / 8) << 10) | (Math.round(px[i + 1] / 8) << 5) | Math.round(px[i + 2] / 8);
    const g = groups.get(key);
    if (g) { g.r += px[i]; g.g += px[i + 1]; g.b += px[i + 2]; g.w++; } else groups.set(key, { r: px[i], g: px[i + 1], b: px[i + 2], w: 1 });
  }
  const G = [...groups.values()].map(g => ({ r: g.r / g.w, g: g.g / g.w, b: g.b / g.w, w: g.w })), m = G.length;
  const D = new Float32Array(m * k);
  G.forEach((g, a) => {
    const lab = rgbToLab(clamp(g.r), clamp(g.g), clamp(g.b));
    for (let c = 0; c < k; c++) { const d = deltaE2000(lab, prepared[c].lab); D[a * k + c] = d * d; }
  });
  const alive = new Uint8Array(k).fill(1);
  let count = k;
  const best = new Int32Array(m), second = new Int32Array(m);
  const refresh = () => {
    for (let a = 0; a < m; a++) {
      let b1 = -1, b2 = -1;
      for (let c = 0; c < k; c++) {
        if (!alive[c]) continue;
        const d = D[a * k + c];
        if (b1 < 0 || d < D[a * k + b1]) { b2 = b1; b1 = c; } else if (b2 < 0 || d < D[a * k + b2]) b2 = c;
      }
      best[a] = b1; second[a] = b2;
    }
  };
  while (count > Math.max(n, pinned.size)) {
    refresh();
    const cost = new Float64Array(k);
    for (let a = 0; a < m; a++) if (second[a] >= 0) cost[best[a]] += G[a].w * (D[a * k + second[a]] - D[a * k + best[a]]);
    let drop = -1;
    for (let c = 0; c < k; c++) if (alive[c] && !pinned.has(c) && (drop < 0 || cost[c] < cost[drop])) drop = c;
    if (drop < 0) break;
    alive[drop] = 0; count--;
  }
  // Tauschen: gierige Entfernung kann Farbfamilien komplett verlieren (Rot, Orange, Dunkelorange
  // ersetzen sich gegenseitig, bis alle weg sind). Jede gewählte Farbe gegen jede verworfene probieren.
  const total = set => {
    let e = 0;
    for (let a = 0; a < m; a++) { let d = Infinity; for (const c of set) if (D[a * k + c] < d) d = D[a * k + c]; e += G[a].w * d; }
    return e;
  };
  let chosen = [...alive.keys()].filter(c => alive[c]), err = total(chosen);
  for (let pass = 0, improved = true; improved && pass < 4; pass++) {
    improved = false;
    for (let s = 0; s < chosen.length; s++) {
      if (pinned.has(chosen[s])) continue;
      for (let c = 0; c < k; c++) {
        if (chosen.includes(c)) continue;
        const trial = chosen.slice(); trial[s] = c;
        const e = total(trial);
        if (e < err * 0.999) { chosen = trial; err = e; improved = true; }
      }
    }
  }
  return chosen.sort((a, b) => a - b);
}
