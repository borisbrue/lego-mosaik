import { LEGO_COLORS } from './colors.js';
import { STUD_PARTS, SHAPE_KEYS, SHAPE_INDEX } from './parts.js';
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
  if (s >= 6) { ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = s * 0.12; ctx.shadowOffsetX = s * 0.04; ctx.shadowOffsetY = s * 0.06; }
  ctx.fillStyle = hex; ctx.fill(path);
  ctx.shadowColor = 'transparent';
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

const shapeOf = (p, i) => STUD_PARTS[SHAPE_KEYS[p.shapes ? p.shapes[i] : SHAPE_INDEX[p.part] ?? 0]].shape;

/** Eine Zelle ohne Zusammenfassen zu langen Fliesen (schnell, für den Editor). */
export function drawCellOf(ctx, p, i, cell) {
  const x = (i % p.cols) * cell, y = ((i / p.cols) | 0) * cell;
  const ov = p.overlay ? p.overlay[i] : 0;
  drawCell(ctx, x, y, cell, LEGO_COLORS[p.grid[i]].hex, ov ? 'square' : shapeOf(p, i));
  if (ov) drawOverlay(ctx, x, y, cell, LEGO_COLORS[p.overlayColor[i]].hex, ov);
}

export function renderMosaic(ctx, p, cell) {
  for (const e of buildElements(p)) {
    const hex = LEGO_COLORS[e.colorIndex].hex, x = e.x * cell, y = e.y * cell;
    if (e.kind === 'stud') drawCell(ctx, x, y, cell, hex, e.part.shape);
    else if (e.kind === 'long') drawLong(ctx, x, y, e.w, e.h, cell, hex);
    else drawOverlay(ctx, x, y, cell, hex, e.code);
  }
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
