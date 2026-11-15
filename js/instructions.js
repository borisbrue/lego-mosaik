import { LEGO_COLORS } from './colors.js';
import { SECTION as SEC, STUD_MM } from './parts.js';
import { hexToRgb } from './mosaic.js';
import { planSubstructure } from './substructure.js';
import { buildElements, countParts, overlayPath, overlayLabelPoints } from './pieces.js';

export function textColorFor(hex) {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000' : '#fff';
}

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** Ordnet jeder verwendeten Farbe eine Nummer zu (häufigste = 1). `items` = Farbindizes (Raster oder Teile). */
export function buildLegend(items) {
  const counts = new Map();
  for (const v of items) counts.set(v, (counts.get(v) || 0) + 1);
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
  if (project.overlay && cell >= 4) {
    for (let i = 0; i < cols * rows; i++) if (project.overlay[i]) {
      s += `<path d="${overlayPath(project.overlay[i])}" transform="translate(${(i % cols) * cell} ${((i / cols) | 0) * cell}) scale(${cell})" fill="${LEGO_COLORS[project.overlayColor[i]].hex}"/>`;
    }
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

/** Zeichnet ein Teil als SVG; Ursprung (ox, oy), Zellgröße cell. */
function elementSvg(e, ox, oy, cell, legend, baseColorOf) {
  const c = LEGO_COLORS[e.colorIndex], txt = textColorFor(c.hex), sym = legend.symbol.get(e.colorIndex);
  const x = ox + e.x * cell, y = oy + e.y * cell;
  const label = (tx, ty, fs, fill, v) => `<text x="${tx}" y="${ty}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="bold" fill="${fill}">${v}</text>`;
  if (e.kind === 'long') {
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="${e.w * cell - 1}" height="${e.h * cell - 1}" rx="0.6" fill="${c.hex}" stroke="#333" stroke-width="0.5"/>`
      + label(x + cell / 2, y + cell / 2, 4.6, txt, sym); // im ersten Feld: liegt nie auf einer 4er-Linie
  }
  if (e.kind === 'overlay') {
    const base = baseColorOf(e), pts = overlayLabelPoints(e.code);
    return `<path d="${overlayPath(e.code)}" transform="translate(${x} ${y}) scale(${cell})" fill="${c.hex}" stroke="#000" stroke-width="${0.45 / cell}"/>`
      + label(x + pts.top[0] * cell, y + pts.top[1] * cell, 3.6, txt, sym)
      + label(x + pts.base[0] * cell, y + pts.base[1] * cell, 2.6, textColorFor(LEGO_COLORS[base].hex), legend.symbol.get(base));
  }
  const round = e.part.shape.startsWith('round'), stud = !e.part.shape.endsWith('flat');
  let s = round
    ? `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${cell * 0.46}" fill="${c.hex}" stroke="#555" stroke-width="0.3"/>`
    : `<rect x="${x + 0.4}" y="${y + 0.4}" width="${cell - 0.8}" height="${cell - 0.8}" fill="${c.hex}" stroke="#555" stroke-width="0.3"/>`;
  if (stud) s += `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${cell * 0.3}" fill="none" stroke="${txt}" stroke-opacity=".35" stroke-width="0.4"/>`;
  return s + label(x + cell / 2, y + cell / 2, 4.6, txt, sym);
}

function sectionSvg(project, sx, sy, legend, elements) {
  const { cols, rows, grid } = project;
  const cell = 10, pad = 12;
  const w = Math.min(SEC, cols - sx * SEC), h = Math.min(SEC, rows - sy * SEC);
  const W = w * cell + pad, H = h * cell + pad;
  const x0 = sx * SEC, y0 = sy * SEC;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="section-svg">`;
  for (let i = 0; i < w; i++) s += `<text x="${pad + i * cell + cell / 2}" y="${pad - 3}" font-size="4.5" text-anchor="middle" font-family="sans-serif" fill="#555">${i + 1}</text>`;
  for (let j = 0; j < h; j++) s += `<text x="${pad - 3}" y="${pad + j * cell + cell / 2}" font-size="4.5" text-anchor="end" dominant-baseline="central" font-family="sans-serif" fill="#555">${j + 1}</text>`;
  s += `<rect x="${pad}" y="${pad}" width="${w * cell}" height="${h * cell}" fill="#fafafa"/>`;
  const baseColorOf = e => grid[e.y * cols + e.x];
  for (const e of elements) s += elementSvg(e, pad - x0 * cell, pad - y0 * cell, cell, legend, baseColorOf);
  // Hilfslinien alle 4 Noppen
  for (let i = 4; i < w; i += 4) s += `<line x1="${pad + i * cell}" y1="${pad}" x2="${pad + i * cell}" y2="${pad + h * cell}" stroke="#000" stroke-width="0.8"/>`;
  for (let j = 4; j < h; j += 4) s += `<line x1="${pad}" y1="${pad + j * cell}" x2="${pad + w * cell}" y2="${pad + j * cell}" stroke="#000" stroke-width="0.8"/>`;
  s += `<rect x="${pad}" y="${pad}" width="${w * cell}" height="${h * cell}" fill="none" stroke="#000" stroke-width="1.2"/>`;
  return s + '</svg>';
}

/** Kleines Symbol je Teil für die Teile-Legende. */
function partIcon(e) {
  const cell = 10, w = e.kind === 'long' ? e.w * cell : cell;
  const demo = { ...e, x: 0, y: 0, h: 1, colorIndex: e.colorIndex };
  const legend = { symbol: new Map([[e.colorIndex, '']]) };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${cell}" class="part-icon" style="width:${w / 10 * 1.4}em">`
    + (e.kind === 'overlay' ? `<rect width="${cell}" height="${cell}" fill="#bbb"/>` : '')
    + elementSvg(demo, 0, 0, cell, legend, () => e.colorIndex) + '</svg>';
}

function partsList(elements, legend) {
  return countParts(elements)
    .sort((a, b) => a.part.label.localeCompare(b.part.label) || legend.symbol.get(a.colorIndex) - legend.symbol.get(b.colorIndex))
    .map(({ part, colorIndex, count }) => `<li>${chip({ color: LEGO_COLORS[colorIndex], symbol: legend.symbol.get(colorIndex) })} <span>${count}×</span> <small>${esc(part.label)}</small></li>`).join('');
}

/** Plan einer Unterbau-Lage, von oben gesehen. `under` = Platten der anderen Lage (gestrichelt). */
function layerSvg(cols, rows, plates, under = []) {
  const cell = 10, pad = 14;
  const W = cols * cell + pad, H = rows * cell + pad;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="layer-svg">`;
  for (let i = 0; i < cols; i += 4) s += `<text x="${pad + i * cell + cell / 2}" y="${pad - 4}" font-size="6" text-anchor="middle" font-family="sans-serif" fill="#555">${i + 1}</text>`;
  for (let j = 0; j < rows; j += 4) s += `<text x="${pad - 3}" y="${pad + j * cell + cell / 2}" font-size="6" text-anchor="end" dominant-baseline="central" font-family="sans-serif" fill="#555">${j + 1}</text>`;
  plates.forEach((p, n) => {
    const x = pad + p.x * cell, y = pad + p.y * cell, w = p.w * cell, h = p.h * cell;
    const fs = Math.max(5, Math.min(18, Math.min(w, h) * 0.38, w / 4.2));
    s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${n % 2 ? '#e4e8ee' : '#f4f6f8'}" stroke="#000" stroke-width="1.6"/>`;
    s += `<text x="${x + w / 2}" y="${y + h / 2}" font-size="${fs}" text-anchor="middle" dominant-baseline="central" font-family="sans-serif" font-weight="bold" fill="#222">${p.w}×${p.h}</text>`;
  });
  if (under.length) {
    s += `<g fill="none" stroke="#d01012" stroke-width="1" stroke-dasharray="4 3">`;
    for (const p of under) s += `<rect x="${pad + p.x * cell}" y="${pad + p.y * cell}" width="${p.w * cell}" height="${p.h * cell}"/>`;
    s += '</g>';
  }
  return s + '</svg>';
}

function layerPage(title, intro, cols, rows, plates, under) {
  const counts = new Map();
  for (const p of plates) counts.set(p.part, (counts.get(p.part) || 0) + 1);
  const list = [...counts.entries()].sort((a, b) => b[0].a * b[0].b - a[0].a * a[0].b)
    .map(([part, n]) => `<li><strong>${n}×</strong> ${esc(part.label)} <small>(BL ${esc(part.blId)})</small></li>`).join('');
  return `<section class="page layer-page">
    <h2>${title}</h2>
    <p class="meta">${intro}</p>
    <div class="layer-grid">${layerSvg(cols, rows, plates, under)}</div>
    <ul class="section-parts">${list}</ul>
  </section>`;
}

function chip(entry) {
  const c = entry.color;
  return `<span class="chip" style="background:${c.hex};color:${textColorFor(c.hex)}">${entry.symbol}</span>`;
}

/** Erzeugt die komplette Bauanleitung als HTML (druckfertig, eine Seite je Abschnitt). */
export function buildInstructionsHtml(project, title = 'Mein LEGO-Mosaik') {
  const { cols, rows } = project;
  const elements = buildElements(project);
  const legend = buildLegend(elements.map(e => e.colorIndex));
  const nsx = Math.ceil(cols / SEC), nsy = Math.ceil(rows / SEC);
  const sub = planSubstructure(cols, rows);
  const overlays = elements.filter(e => e.kind === 'overlay').length;

  // Teile-Legende: ein Beispiel je Teilart
  const kinds = new Map();
  for (const e of elements) if (!kinds.has(e.part.blId)) kinds.set(e.part.blId, e);
  const partCounts = new Map();
  for (const e of elements) partCounts.set(e.part.blId, (partCounts.get(e.part.blId) || 0) + 1);
  const gray = LEGO_COLORS.findIndex(c => c.legoId === 194);
  const partLegend = [...kinds.values()].map(e => `<li>${partIcon({ ...e, colorIndex: gray >= 0 ? gray : 0, w: e.kind === 'long' ? Math.max(e.w, e.h) : 1 })} <span>${esc(e.part.label)}</span> <small>BL ${esc(e.part.blId)} · ${partCounts.get(e.part.blId)}×</small></li>`).join('');

  let html = `<section class="page cover">
    <h1>${esc(title)}</h1>
    <p class="meta">${cols} × ${rows} Noppen · ${(cols * STUD_MM / 10).toFixed(1)} × ${(rows * STUD_MM / 10).toFixed(1)} cm · ${elements.length} Mosaikteile · Unterbau aus ${sub.total} Platten</p>
    <div class="cover-preview">${previewSvg(project, { cell: 6 })}</div>
    <h2>Farblegende</h2>
    <table class="legend"><thead><tr><th>Nr.</th><th>Farbe</th><th>LEGO-Farbe (ID)</th><th>BrickLink-Farbe (ID)</th><th>Teile</th></tr></thead><tbody>
    ${legend.entries.map(e => `<tr><td>${chip(e)}</td><td>${esc(e.color.de)}</td><td>${esc(e.color.legoName)} (${e.color.legoId})</td><td>${esc(e.color.blName)} (${e.color.blId})</td><td>${e.count}</td></tr>`).join('')}
    </tbody></table>
    <h2>Teile</h2>
    <ul class="part-legend">${partLegend}</ul>
    <h2>So baust du</h2>
    <ol class="howto">
      <li><strong>Unterbau, Lage 1:</strong> Lege die ${sub.bottom.length} Platten der unteren Lage mit den Noppen nach oben wie im Plan aus.</li>
      <li><strong>Unterbau, Lage 2:</strong> Setze die ${sub.top.length} Platten der oberen Lage darauf und drücke sie gut fest. Die Fugen der beiden Lagen liegen versetzt, so hält der Unterbau als eine Fläche zusammen.</li>
      <li><strong>Mosaik:</strong> Baue die ${nsx * nsy} Abschnitte (je ${SEC}×${SEC} Noppen) nacheinander auf den Unterbau. Nummer 1 ist oben links, es geht zeilenweise nach rechts. Jedes Feld zeigt die Farbnummer aus der Legende und die Form des Teils: Kreis = rund, Quadrat = eckig, Ring = mit Noppe, ohne Ring = glatte Fliese. Längliche Felder sind 1×2- bis 1×4-Fliesen. Spalten stehen oben, Zeilen links, dicke Linien teilen das Raster in 4×4-Blöcke.</li>
      ${overlays ? `<li><strong>Halbe Noppen (${overlays}×):</strong> Felder mit Viertel- oder Halbkreis bekommen zuerst eine eckige Platte 1×1 in der Farbe der kleinen Zahl, darauf die Fliese in der Farbe der großen Zahl, genau so gedreht wie gezeichnet. Diese Teile stehen eine Plattenhöhe über den anderen.</li>` : ''}
    </ol>
  </section>`;

  html += layerPage('Unterbau · Lage 1 (unten)',
    `${sub.bottom.length} Platten, von oben gesehen, Noppen nach oben. Rot gestrichelt: Fugen von Lage 2.`,
    cols, rows, sub.bottom, sub.top);
  html += layerPage('Unterbau · Lage 2 (oben)',
    `${sub.top.length} Platten, kommen auf Lage 1. Auf diese Lage setzt du die Mosaiksteine.`,
    cols, rows, sub.top);

  for (let sy = 0; sy < nsy; sy++) for (let sx = 0; sx < nsx; sx++) {
    const n = sy * nsx + sx + 1;
    const w = Math.min(SEC, cols - sx * SEC), h = Math.min(SEC, rows - sy * SEC);
    const inSec = elements.filter(e => e.x >= sx * SEC && e.x < sx * SEC + w && e.y >= sy * SEC && e.y < sy * SEC + h);
    html += `<section class="page section-page">
      <header><h2>Abschnitt ${n} <small>von ${nsx * nsy}</small></h2>
      <div class="locator">${previewSvg(project, { cell: 2, highlight: n - 1 })}</div></header>
      <p class="meta">Spalte ${sx + 1}, Reihe ${sy + 1} · Noppen ${sx * SEC + 1}–${sx * SEC + w} (horizontal), ${sy * SEC + 1}–${sy * SEC + h} (vertikal)</p>
      <div class="section-grid">${sectionSvg(project, sx, sy, legend, inSec)}</div>
      <ul class="section-parts">${partsList(inSec, legend)}</ul>
    </section>`;
  }
  return html;
}
