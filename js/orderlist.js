import { LEGO_COLORS } from './colors.js';
import { STUD_PARTS } from './parts.js';
import { planSubstructure } from './substructure.js';
import { countColors } from './mosaic.js';

/**
 * Erstellt die Bestellliste.
 * @param project {cols, rows, grid (Indizes in LEGO_COLORS), part, sparePercent, baseColorId, includeBase}
 * @returns {{items, base: Array, totalStuds, totalPlates}} – base = Platten des Unterbaus (beide Lagen)
 */
export function buildOrderList(project) {
  const { cols, rows, grid, part, sparePercent = 0, baseColorId = 26, includeBase = true } = project;
  const p = STUD_PARTS[part];
  const counts = countColors(grid, LEGO_COLORS.length);
  const items = [];
  counts.forEach((n, i) => {
    if (!n) return;
    const c = LEGO_COLORS[i];
    const spare = sparePercent > 0 ? Math.max(1, Math.ceil((n * sparePercent) / 100)) : 0;
    items.push({ colorIndex: i, color: c, part: p, needed: n, spare, qty: n + spare });
  });
  items.sort((a, b) => b.needed - a.needed);
  let base = [];
  if (includeBase) {
    const color = LEGO_COLORS.find(c => c.legoId === baseColorId) || LEGO_COLORS[1];
    base = planSubstructure(cols, rows).counts
      .map(({ part, total }) => ({ color, part, needed: total, spare: 0, qty: total }));
  }
  const totalStuds = items.reduce((s, it) => s + it.qty, 0);
  const totalPlates = base.reduce((s, it) => s + it.qty, 0);
  return { items, base, totalStuds, totalPlates };
}

const csvEscape = v => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function orderListToCsv(list) {
  const header = ['Teil', 'BrickLink-Teil', 'LEGO-Design-ID', 'Farbe (DE)', 'LEGO-Farbe', 'LEGO-Farb-ID', 'BrickLink-Farbe', 'BrickLink-Farb-ID', 'Benötigt', 'Reserve', 'Bestellmenge'];
  const rows = [...list.items, ...list.base].map(it => [
    it.part.label, it.part.blId, it.part.designId, it.color.de, it.color.legoName, it.color.legoId,
    it.color.blName, it.color.blId, it.needed, it.spare, it.qty,
  ]);
  return '﻿' + [header, ...rows].map(r => r.map(csvEscape).join(';')).join('\r\n');
}

/** BrickLink-Wanted-List-XML (Upload unter "Wanted" → "Upload"). */
export function orderListToBrickLinkXml(list) {
  // Gleiches Teil in gleicher Farbe (z. B. Platte 1×1 als Mosaikstein und im Unterbau) zusammenfassen
  const merged = new Map();
  for (const it of [...list.items, ...list.base]) {
    const k = `${it.part.blId}|${it.color.blId}`;
    const m = merged.get(k);
    if (m) m.qty += it.qty; else merged.set(k, { part: it.part, color: it.color, qty: it.qty });
  }
  const items = [...merged.values()].map(it =>
    `  <ITEM>\n    <ITEMTYPE>P</ITEMTYPE>\n    <ITEMID>${it.part.blId}</ITEMID>\n    <COLOR>${it.color.blId}</COLOR>\n    <MINQTY>${it.qty}</MINQTY>\n    <CONDITION>N</CONDITION>\n  </ITEM>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${items}\n</INVENTORY>\n`;
}
