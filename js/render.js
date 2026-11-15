import { LEGO_COLORS } from './colors.js';

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

export function renderMosaic(ctx, { cols, rows, grid }, cell, shape) {
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    drawCell(ctx, x * cell, y * cell, cell, LEGO_COLORS[grid[y * cols + x]].hex, shape);
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
