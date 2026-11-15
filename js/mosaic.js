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
      // Nur bei klar getrennten Gruppen eingreifen
      if (!n0 || !n1 || (c0[0] - c1[0]) ** 2 + (c0[1] - c1[1]) ** 2 + (c0[2] - c1[2]) ** 2 < 900) continue;
      const dom = n0 >= n1 ? c0 : c1, o = (r * cols + c) * 3;
      for (let k = 0; k < 3; k++) out[o + k] += dominance * (dom[k] - out[o + k]);
    }
  }
  return out;
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
