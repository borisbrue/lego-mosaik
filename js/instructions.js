import { LEGO_COLORS } from './colors.js';
import { STUD_PARTS, BASE_PART, STUD_MM } from './parts.js';
import { hexToRgb } from './mosaic.js';

const SEC = BASE_PART.size;

export function textColorFor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Ordnet jeder verwendeten Farbe eine Nummer zu (häufigste = 1). */
export function buildLegend(grid) {
  const counts = new Map();
  for (const v of grid) counts.set(v, (counts.get(v) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const symbol = new Map();
  sorted.forEach(([ci], i) => symbol.set(ci, i + 1));
  return { symbol, entries: sorted.map(([ci, n], i) => ({ colorIndex: ci, color: LEGO_COLORS[ci], count: n, symbol: i + 1 })) };
}

function previewSvg(project, { cell = 6, sectionLines = true, highlight = -1 } = {}) {
  const { cols, rows, grid } = project;
  const w = cols * cell, h = rows * cell;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" class="preview-svg" shape-rendering="crispEdges">`;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    s += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}" fill="${LEGO_COLORS[grid[y * cols + x]].hex}"/>`;
  }
  if (sectionLines) {
    const sx = Math.ceil(cols / SEC), sy = Math.ceil(rows / SEC);
    for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      const n = j * sx + i + 1;
      const x = i * SEC * cell, y = j * SEC * cell;
      const sw = Math.min(SEC, cols - i * SEC) * cell, sh = Math.min(SEC, rows - j * SEC) * cell;
      const hl = n - 1 === highlight;
      s += `<rect x="${x}" y="${y}" width="${sw}" height="${sh}" fill="${hl ? 'rgba(255,255,0,.35)' : 'none'}" stroke="${hl ? '#ff0' : '#fff'}" stroke-width="${hl ? cell * 0.6 : cell * 0.25}"/>`;
      if (highlight < 0) s += `<text x="${x + sw / 2}" y="${y + sh / 2}" font-size="${cell * 5}" text-anchor="middle" dominant-baseline="central" fill="#fff" stroke="#000" stroke-width="${cell * 0.4}" paint-order="stroke" font-family="sans-serif" font-weight="bold">${n}</text>`;
    }
  }
  return s + '</svg>';
}

function sectionSvg(project, sx, sy, legend) {
  const { cols, rows, grid } = project;
  const cell = 10, pad = 12;
  const w = Math.min(SEC, cols - sx * SEC), h = Math.min(SEC, rows - sy * SEC);
  const W = w * cell + pad, H = h * cell + pad;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="section-svg">`;
  for (let i = 0; i < w; i++) s += `<text x="${pad + i * cell + cell / 2}" y="${pad - 3}" font-size="4.5" text-anchor="middle" font-family="sans-serif" fill="#555">${i + 1}</text>`;
  for (let j = 0; j < h; j++) s += `<text x="${pad - 3}" y="${pad + j * cell + cell / 2}" font-size="4.5" text-anchor="end" dominant-baseline="central" font-family="sans-serif" fill="#555">${j + 1}</text>`;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const ci = grid[(sy * SEC + j) * cols + sx * SEC + i];
    const c = LEGO_COLORS[ci];
    const x = pad + i * cell, y = pad + j * cell;
    s += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${c.hex}" stroke="#888" stroke-width="0.3"/>`;
    s += `<text x="${x + cell / 2}" y="${y + cell / 2}" font-size="4.6" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="bold" fill="${textColorFor(c.hex)}">${legend.symbol.get(ci)}</text>`;
  }
  // Hilfslinien alle 4 Noppen
  for (let i = 4; i < w; i += 4) s += `<line x1="${pad + i * cell}" y1="${pad}" x2="${pad + i * cell}" y2="${pad + h * cell}" stroke="#000" stroke-width="0.8"/>`;
  for (let j = 4; j < h; j += 4) s += `<line x1="${pad}" y1="${pad + j * cell}" x2="${pad + w * cell}" y2="${pad + j * cell}" stroke="#000" stroke-width="0.8"/>`;
  s += `<rect x="${pad}" y="${pad}" width="${w * cell}" height="${h * cell}" fill="none" stroke="#000" stroke-width="1.2"/>`;
  return s + '</svg>';
}

function chip(entry) {
  const c = entry.color;
  return `<span class="chip" style="background:${c.hex};color:${textColorFor(c.hex)}">${entry.symbol}</span>`;
}

/** Erzeugt die komplette Bauanleitung als HTML (druckfertig, eine Seite je Abschnitt). */
export function buildInstructionsHtml(project, title = 'Mein LEGO-Mosaik') {
  const { cols, rows, grid, part } = project;
  const legend = buildLegend(grid);
  const p = STUD_PARTS[part];
  const nsx = Math.ceil(cols / SEC), nsy = Math.ceil(rows / SEC);
  const total = cols * rows;

  let html = `<section class="page cover">
    <h1>${esc(title)}</h1>
    <p class="meta">${cols} × ${rows} Noppen · ${(cols * STUD_MM / 10).toFixed(1)} × ${(rows * STUD_MM / 10).toFixed(1)} cm · ${total} × ${esc(p.label)} · ${nsx * nsy} × ${esc(BASE_PART.label)}</p>
    <div class="cover-preview">${previewSvg(project, { cell: 6 })}</div>
    <h2>Farblegende</h2>
    <table class="legend"><thead><tr><th>Nr.</th><th>Farbe</th><th>LEGO-Farbe (ID)</th><th>BrickLink-Farbe (ID)</th><th>Anzahl</th></tr></thead><tbody>
    ${legend.entries.map(e => `<tr><td>${chip(e)}</td><td>${esc(e.color.de)}</td><td>${esc(e.color.legoName)} (${e.color.legoId})</td><td>${esc(e.color.blName)} (${e.color.blId})</td><td>${e.count}</td></tr>`).join('')}
    </tbody></table>
    <h2>So baust du</h2>
    <ol class="howto">
      <li>Lege die ${nsx * nsy} Grundplatten (${BASE_PART.size}×${BASE_PART.size}) wie in der Übersicht nummeriert aus: Nummer 1 ist oben links, es geht zeilenweise nach rechts.</li>
      <li>Baue jeden Abschnitt nach seiner Seite. Jedes Feld zeigt die Farbnummer aus der Legende. Spalten (1–${SEC}) stehen oben, Zeilen links. Dicke Linien teilen das Raster in 4×4-Blöcke.</li>
      <li>Setze die fertigen Abschnitte zusammen und verbinde sie auf der Rückseite, z. B. mit Platten 2×4 über den Fugen.</li>
    </ol>
  </section>`;

  for (let sy = 0; sy < nsy; sy++) for (let sx = 0; sx < nsx; sx++) {
    const n = sy * nsx + sx + 1;
    const counts = new Map();
    const w = Math.min(SEC, cols - sx * SEC), h = Math.min(SEC, rows - sy * SEC);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const ci = grid[(sy * SEC + j) * cols + sx * SEC + i];
      counts.set(ci, (counts.get(ci) || 0) + 1);
    }
    const parts = [...counts.entries()].sort((a, b) => legend.symbol.get(a[0]) - legend.symbol.get(b[0]))
      .map(([ci, cnt]) => `<li>${chip({ color: LEGO_COLORS[ci], symbol: legend.symbol.get(ci) })} <span>${cnt}×</span> <small>${esc(LEGO_COLORS[ci].de)}</small></li>`).join('');
    html += `<section class="page section-page">
      <header><h2>Abschnitt ${n} <small>von ${nsx * nsy}</small></h2>
      <div class="locator">${previewSvg(project, { cell: 2, highlight: n - 1 })}</div></header>
      <p class="meta">Spalte ${sx + 1}, Reihe ${sy + 1} · Noppen ${sx * SEC + 1}–${sx * SEC + w} (horizontal), ${sy * SEC + 1}–${sy * SEC + h} (vertikal)</p>
      <div class="section-grid">${sectionSvg(project, sx, sy, legend)}</div>
      <ul class="section-parts">${parts}</ul>
    </section>`;
  }
  return html;
}
