import { LEGO_COLORS } from './colors.js';
import { STUD_PARTS, SHAPE_KEYS, SHAPE_INDEX, OVERLAY_COVERED, overlaySize } from './parts.js';
import { buildElements, overlayPath } from './pieces.js';

const pathCache = new Map();
const unitPath = code => {
  if (!pathCache.has(code)) pathCache.set(code, typeof Path2D !== 'undefined' ? new Path2D(overlayPath(code)) : null);
  return pathCache.get(code);
};

/** Zeichnet eine einzelne Zelle (Noppe) im Look des gewählten Teils. */
export function drawCell(ctx, x, y, s, hex, shape) {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y, s, s);
  const round = shape === 'round' || shape === 'round-flat';
  const flat = shape === 'square-flat' || shape === 'round-flat';
  ctx.fillStyle = hex;
  if (round) {
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.47, 0, Math.PI * 2); ctx.fill();
  } else {
    const g = Math.max(0.5, s * 0.04);
    ctx.fillRect(x + g, y + g, s - 2 * g, s - 2 * g);
  }
  if (s < 6) return;
  if (!flat) {
    // Noppe mit Licht und Schatten
    const r = s * 0.3;
    ctx.beginPath(); ctx.arc(x + s / 2 + s * 0.03, y + s / 2 + s * 0.04, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, r, 0, Math.PI * 2);
    ctx.fillStyle = hex; ctx.fill();
    ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, r, Math.PI * 1.05, Math.PI * 1.6);
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = Math.max(1, s * 0.06); ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(255,255,255,.12)';
    if (round) { ctx.beginPath(); ctx.arc(x + s * 0.42, y + s * 0.4, s * 0.25, 0, Math.PI * 2); ctx.fill(); }
    else ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.5, s * 0.12);
  }
}

/** Halbe Noppe (Viertel-/Halbkreis-Fliese) über der Zelle, mit Schatten für die höhere Lage. */
export function drawOverlay(ctx, x, y, s, hex, code) {
  const path = unitPath(code);
  if (!path) return;
  ctx.save();
  ctx.translate(x, y); ctx.scale(s, s);
  if (s >= 6) { // Schatten als versetzte Fläche (shadowBlur ist bei vielen Teilen zu langsam)
    ctx.save(); ctx.translate(0.04, 0.06); ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fill(path); ctx.restore();
  }
  ctx.fillStyle = hex; ctx.fill(path);
  if (s >= 6) { ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.lineWidth = 1 / s; ctx.stroke(path); }
  ctx.restore();
}

/** Lange Fliese über w×h Zellen. */
export function drawLong(ctx, x, y, w, h, s, hex) {
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(x, y, w * s, h * s);
  const g = Math.max(0.5, s * 0.04);
  ctx.fillStyle = hex;
  ctx.fillRect(x + g, y + g, w * s - 2 * g, h * s - 2 * g);
  if (s < 6) return;
  ctx.fillStyle = 'rgba(255,255,255,.12)';
  if (w >= h) ctx.fillRect(x + s * 0.12, y + s * 0.12, w * s - s * 0.6, s * 0.12);
  else ctx.fillRect(x + s * 0.12, y + s * 0.12, s * 0.12, h * s - s * 0.6);
}

export const shapeOf = (p, i) => STUD_PARTS[SHAPE_KEYS[p.shapes ? p.shapes[i] : SHAPE_INDEX[p.part] ?? 0]].shape;

/** Eine Zelle ohne Zusammenfassen zu langen Fliesen (schnell, für den Editor). */
export function drawCellOf(ctx, p, i, cell) {
  const x = (i % p.cols) * cell, y = ((i / p.cols) | 0) * cell;
  const ov = p.overlay ? p.overlay[i] : 0;
  drawCell(ctx, x, y, cell, LEGO_COLORS[p.grid[i]].hex, ov ? 'square' : shapeOf(p, i));
  if (ov && ov !== OVERLAY_COVERED) drawOverlay(ctx, x, y, cell * overlaySize(ov), LEGO_COLORS[p.overlayColor[i]].hex, ov);
}

export function renderMosaic(ctx, p, cell) {
  for (const e of buildElements(p)) {
    const hex = LEGO_COLORS[e.colorIndex].hex, x = e.x * cell, y = e.y * cell;
    if (e.kind === 'stud') drawCell(ctx, x, y, cell, hex, e.part.shape);
    else if (e.kind === 'long') drawLong(ctx, x, y, e.w, e.h, cell, hex);
    else drawOverlay(ctx, x, y, cell * e.w, hex, e.code);
  }
  if (p.height) drawRelief(ctx, p, cell);
}

/**
 * Ebenen sichtbar machen: Licht von oben links. Eine höhere Zelle wirft Schatten auf die
 * tiefere Nachbarzelle rechts/unten; an der Kante oben/links bekommt sie eine Lichtkante.
 */
export function drawRelief(ctx, p, cell) {
  const { cols, rows, height } = p;
  if (!height.some(Boolean)) return;
  ctx.save();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const i = y * cols + x, h = height[i];
    if (!h) continue;
    const X = x * cell, Y = y * cell;
    const lower = (nx, ny) => nx >= 0 && ny >= 0 && nx < cols && ny < rows ? h - height[ny * cols + nx] : 0;
    const dr = lower(x + 1, y), db = lower(x, y + 1), dl = lower(x - 1, y), dt = lower(x, y - 1);
    if (dr > 0) { const w = cell * Math.min(0.6, 0.22 * dr); const g = ctx.createLinearGradient(X + cell, 0, X + cell + w, 0); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(X + cell, Y, w, cell); }
    if (db > 0) { const w = cell * Math.min(0.6, 0.22 * db); const g = ctx.createLinearGradient(0, Y + cell, 0, Y + cell + w); g.addColorStop(0, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(X, Y + cell, cell, w); }
    const lw = Math.max(1, cell * 0.12);
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    if (dl > 0) ctx.fillRect(X, Y, lw, cell);
    if (dt > 0) ctx.fillRect(X, Y, cell, lw);
  }
  ctx.restore();
}

export function drawSectionLines(ctx, cols, rows, cell, every = 16) {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = Math.max(1, cell * 0.08);
  ctx.setLineDash([cell * 0.5, cell * 0.3]);
  ctx.beginPath();
  for (let x = every; x < cols; x += every) { ctx.moveTo(x * cell, 0); ctx.lineTo(x * cell, rows * cell); }
  for (let y = every; y < rows; y += every) { ctx.moveTo(0, y * cell); ctx.lineTo(cols * cell, y * cell); }
  ctx.stroke(); ctx.restore();
}
