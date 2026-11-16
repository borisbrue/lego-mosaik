import { LEGO_COLORS, PALETTE_PRESETS } from './colors.js';
import { STUD_PARTS, STUD_MM, SECTION, PAPER_FORMATS, paperStuds, SHAPE_KEYS, SHAPE_INDEX, SHAPE_PLATE, overlayCode } from './parts.js';
import { autoShapes, computeOverlays, simplify, buildElements, overlayPath } from './pieces.js';
import { autoDepth, planRisers } from './layers.js';
import { segment, regionAt, regionAnchor, regionGroup, applyRegionOps } from './regions.js';
import { planSubstructure } from './substructure.js';
import { boxDownsample, dominantDownsample, unsharpMask, smoothCells, reducePalette, adjustPixels, preparePalette, quantize, countColors } from './mosaic.js';
import { renderMosaic, drawSectionLines } from './render.js';
import { Editor } from './editor.js';
import { buildOrderList, orderListToCsv, orderListToBrickLinkXml } from './orderlist.js';
import { buildInstructionsHtml, textColorFor } from './instructions.js';
import { kvGet, kvSet, kvDel } from './storage.js';

const $ = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];
const indexByLegoId = new Map(LEGO_COLORS.map((c, i) => [c.legoId, i]));

// ---------- Zustand ----------
function defaultProject() {
  return {
    version: 1,
    title: 'Mein LEGO-Mosaik',
    sizePreset: 'A3', orientation: 'portrait',
    part: 'plate-round',      // Steintyp der Flächen
    edgePart: 'tile',         // Steintyp der Konturen ('same' = wie Fläche)
    edgeSensitivity: 50,      // 0..100
    longTiles: true,          // eckige Fliesen zu 1×2–1×4 zusammenfassen
    relief: 0,                // halbe Noppen: 0 = aus … 100 = viele
    sharpen: 30,              // 0..100
    colorCount: 0,            // 0 = alle erlaubten Farben, sonst die n passendsten
    pinned: [],               // LEGO-Farb-IDs, die bei begrenzter Anzahl immer dabei sind
    regionDetail: 50,         // Feinheit der Bereichserkennung
    regionOps: [],            // [{x, y, hide?, colorId?, level?}] – Ankerpunkt normiert 0..1
    depth: 0,                 // 0..100: Ebenen automatisch vorschlagen
    riserColorId: 26,         // Farbe der Sockelplatten unter erhöhten Bereichen ('match' = wie Oberfläche)
    simplify: 30,             // 0..100: Farbinseln verschmelzen, Flächen glätten
    crop: { zoom: 1, cx: 0.5, cy: 0.5 },
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    dither: 0,
    palettePreset: 'all',
    enabled: PALETTE_PRESETS.all.ids.slice(),
    edited: false,
    sparePercent: 5, includeBase: true, baseColorId: 26,
    cols: 37, rows: 52,
    grid: null,          // Uint8Array: Farbindex (LEGO_COLORS) je Zelle
    shapes: null,        // Uint8Array: Index in SHAPE_KEYS je Zelle
    overlay: null,       // Uint8Array: halbe Noppe je Zelle (0 = keine, siehe overlayCode)
    overlayColor: null,  // Uint8Array: Farbindex der halben Noppe
    height: null,        // Uint8Array: Ebene je Zelle (0 = flach … 3)
  };
}

let project = defaultProject();
let image = null;      // HTMLImageElement / ImageBitmap
let imageBlob = null;
let sampled = null;    // gemittelte RGB-Werte (vor Anpassungen)
let sampledKey = '';
let segmentation = null;   // Bereiche des aktuellen Entwurfs (nicht gespeichert)
let chosenColors = null;   // Farbindizes nach „Anzahl Farben“
let selectedRegion = null; // {x, y} normiert

// ---------- Hilfsfunktionen ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function download(name, content, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = s => (s || 'mosaik').toLowerCase().replace(/[^a-z0-9äöüß]+/gi, '-').replace(/^-|-$/g, '') || 'mosaik';
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// ---------- Speichern / Laden ----------
const toIds = a => a ? Array.from(a, i => LEGO_COLORS[i].legoId) : null;
const fromIds = (a, n) => Array.isArray(a) && a.length === n ? Uint8Array.from(a, id => indexByLegoId.get(id) ?? 0) : null;
function serialize() {
  return {
    ...project, grid: toIds(project.grid), overlayColor: toIds(project.overlayColor),
    shapes: project.shapes ? Array.from(project.shapes) : null,
    overlay: project.overlay ? Array.from(project.overlay) : null,
    height: project.height ? Array.from(project.height) : null,
  };
}

/** Sorgt dafür, dass Formen- und Overlay-Raster zur Größe passen (ältere Projekte). */
function ensureLayers(p) {
  const n = p.cols * p.rows;
  if (!p.grid) { p.shapes = p.overlay = p.overlayColor = p.height = null; return p; }
  if (!p.shapes || p.shapes.length !== n) p.shapes = new Uint8Array(n).fill(SHAPE_INDEX[p.part] ?? 0);
  if (!p.overlay || p.overlay.length !== n) p.overlay = new Uint8Array(n);
  if (!p.overlayColor || p.overlayColor.length !== n) p.overlayColor = new Uint8Array(n);
  if (!p.height || p.height.length !== n) p.height = new Uint8Array(n);
  return p;
}
function deserialize(data) {
  const p = { ...defaultProject(), ...data };
  p.crop = { ...defaultProject().crop, ...data.crop };
  p.adjust = { ...defaultProject().adjust, ...data.adjust };
  if (data.simplify === undefined) p.simplify = data.despeckle ? 20 : 0; // ältere Projekte
  delete p.despeckle;
  // Ältere Projekte: unbekannte Formatvorgabe → eigenes Format mit den gespeicherten Maßen
  if (!sizeOptionExists(p.sizePreset)) p.sizePreset = 'custom';
  delete p.sw; delete p.sh;
  const n = p.cols * p.rows;
  p.grid = fromIds(data.grid, n);
  if (!p.grid) p.edited = false;
  p.overlayColor = fromIds(data.overlayColor, n);
  p.shapes = Array.isArray(data.shapes) && data.shapes.length === n ? Uint8Array.from(data.shapes) : null;
  p.overlay = Array.isArray(data.overlay) && data.overlay.length === n ? Uint8Array.from(data.overlay) : null;
  p.height = Array.isArray(data.height) && data.height.length === n ? Uint8Array.from(data.height) : null;
  return ensureLayers(p);
}
const save = debounce(() => kvSet('project', serialize()).catch(console.error), 400);

async function loadImageFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Bild konnte nicht geladen werden')); img.src = url; });
  return img;
}

// Großes Foto auf max. 2000 px verkleinern (spart Speicher, reicht für max. 128 Noppen locker)
async function normalizeImage(file) {
  const img = await loadImageFromBlob(file);
  const max = 2000, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale === 1 && file.type === 'image/jpeg') return { img, blob: file };
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  return { img: await loadImageFromBlob(blob), blob };
}

async function setPhoto(file) {
  if (!file || !file.type.startsWith('image/')) { toast('Bitte eine Bilddatei wählen.'); return; }
  if (project.edited && !confirm('Ein neues Foto verwirft deine von Hand gesetzten Steine. Fortfahren?')) return;
  try {
    const { img, blob } = await normalizeImage(file);
    image = img; imageBlob = blob;
    project.crop = { zoom: 1, cx: 0.5, cy: 0.5 };
    project.edited = false;
    await kvSet('image', blob);
    syncControls();
    regenerate();
  } catch (e) { toast(e.message); }
}

// ---------- Ausschnitt ----------
function cropRect() {
  const iw = image.naturalWidth, ih = image.naturalHeight, A = project.cols / project.rows;
  let cw, ch;
  if (iw / ih > A) { ch = ih; cw = ih * A; } else { cw = iw; ch = iw / A; }
  cw /= project.crop.zoom; ch /= project.crop.zoom;
  const cx = Math.min(Math.max(project.crop.cx * iw, cw / 2), iw - cw / 2);
  const cy = Math.min(Math.max(project.crop.cy * ih, ch / 2), ih - ch / 2);
  project.crop.cx = cx / iw; project.crop.cy = cy / ih;
  return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
}

function drawCrop() {
  if (!image) return;
  const c = $('#crop-canvas'), ctx = c.getContext('2d');
  const maxW = 600, s = Math.min(1, maxW / image.naturalWidth);
  c.width = Math.round(image.naturalWidth * s); c.height = Math.round(image.naturalHeight * s);
  ctx.drawImage(image, 0, 0, c.width, c.height);
  const r = cropRect();
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath();
  ctx.rect(0, 0, c.width, c.height);
  ctx.rect(r.x * s, r.y * s, r.w * s, r.h * s);
  ctx.fill('evenodd');
  ctx.strokeStyle = '#f2cd37'; ctx.lineWidth = 2;
  ctx.strokeRect(r.x * s, r.y * s, r.w * s, r.h * s);
  // Abschnitts-Linien (alle 16 Noppen)
  ctx.strokeStyle = 'rgba(242,205,55,.6)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = SECTION; i < project.cols; i += SECTION) { const x = (r.x + (r.w * i) / project.cols) * s; ctx.moveTo(x, r.y * s); ctx.lineTo(x, (r.y + r.h) * s); }
  for (let j = SECTION; j < project.rows; j += SECTION) { const y = (r.y + (r.h * j) / project.rows) * s; ctx.moveTo(r.x * s, y); ctx.lineTo((r.x + r.w) * s, y); }
  ctx.stroke();
}

const SUB = 4; // Teilpixel je Zelle und Richtung für halbe Noppen

/** Liefert gemittelte Zellfarben und feinere Teilpixel (vor Helligkeit usw.). */
function sampleImage() {
  const r = cropRect();
  const key = [image.src, project.cols, project.rows, r.x, r.y, r.w, r.h, project.sharpen].join('|');
  if (key === sampledKey && sampled) return sampled;
  const k = Math.max(SUB, Math.min(8, Math.floor(2048 / Math.max(project.cols, project.rows))));
  const w = project.cols * k, h = project.rows * k;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const sharp = project.sharpen / 100;
  unsharpMask(data, w, h, sharp * 1.5, Math.max(1, Math.round(k / 2)));
  sampled = {
    cells: dominantDownsample(data, w, h, project.cols, project.rows, Math.min(1, 0.6 + sharp)),
    sub: boxDownsample(data, w, h, project.cols * SUB, project.rows * SUB),
  };
  sampledKey = key;
  return sampled;
}

// ---------- Mosaik berechnen ----------
function enabledIndices() {
  return project.enabled.map(id => indexByLegoId.get(id)).filter(i => i !== undefined);
}

function regenerate() {
  drawCrop();
  if (!image || project.edited) { updateDesignView(); return; }
  let idx = enabledIndices();
  if (!idx.length) { toast('Mindestens eine Farbe aktivieren.'); return; }
  const { cols, rows } = project;
  const smp = sampleImage();
  const px = adjustPixels(Float32Array.from(smp.cells), project.adjust);
  const simp = project.simplify / 100;
  smoothCells(px, cols, rows, simp);
  if (project.colorCount > 0) {
    const pinned = new Set(idx.flatMap((ci, k) => (project.pinned.includes(LEGO_COLORS[ci].legoId) ? [k] : [])));
    idx = reducePalette(px, preparePalette(idx.map(i => LEGO_COLORS[i])), project.colorCount, pinned).map(k => idx[k]);
  }
  chosenColors = new Set(idx);
  const prepared = preparePalette(idx.map(i => LEGO_COLORS[i]));
  const q = quantize(px, cols, rows, prepared, { dither: project.dither / 100 });
  const grid = Uint8Array.from(q, i => idx[i]);
  if (simp > 0) simplify(grid, cols, rows, 1 + Math.round(simp ** 1.5 * cols * rows / 300));
  segmentation = segment(px, cols, rows, project.regionDetail);
  const ops = project.regionOps.map(o => ({ ...o, color: o.colorId != null ? indexByLegoId.get(o.colorId) : null }));
  const { hidden, levels } = applyRegionOps(grid, cols, rows, segmentation, ops);
  const shapes = autoShapes(grid, cols, rows, { area: project.part, edge: project.edgePart, sensitivity: project.edgeSensitivity }, px);
  let overlay = new Uint8Array(cols * rows), overlayColor = new Uint8Array(cols * rows);
  if (project.relief > 0) {
    const sub = adjustPixels(Float32Array.from(smp.sub), project.adjust);
    ({ overlay, overlayColor } = computeOverlays(sub, grid, cols, rows, SUB, project.relief));
    for (let i = 0; i < overlay.length; i++) {
      if (hidden[i]) overlay[i] = 0;
      if (overlay[i]) shapes[i] = SHAPE_PLATE;
    }
  }
  const height = autoDepth(grid, cols, rows, project.depth, px);
  for (let i = 0; i < height.length; i++) if (levels[i] >= 0) height[i] = levels[i];
  Object.assign(project, { grid, shapes, overlay, overlayColor, height });
  renderPaletteChips();
  updateDesignView();
  save();
}
const regenerateSoon = debounce(regenerate, 120);

// ---------- Entwurfsansicht ----------
function updateDesignView() {
  const has = !!project.grid;
  $('#design-empty').hidden = has;
  $('#preview-canvas').hidden = !has;
  $('#btn-to-edit').disabled = !has;
  $('#crop-wrap').hidden = !image;
  $('#drop-zone span').textContent = image ? 'Anderes Foto wählen' : 'Foto wählen oder hierher ziehen';
  $('#design-lock').hidden = !project.edited;
  for (const id of ['#design-settings', '#design-pieces', '#design-layers', '#design-adjust', '#design-palette']) $(id).disabled = project.edited;
  $('#crop-zoom').disabled = project.edited;
  if (!has) { $('#design-stats').textContent = ''; return; }
  const c = $('#preview-canvas');
  const cell = Math.max(4, Math.min(14, Math.floor(1100 / Math.max(project.cols, project.rows))));
  c.width = project.cols * cell; c.height = project.rows * cell;
  const ctx = c.getContext('2d');
  renderMosaic(ctx, project, cell);
  drawSectionLines(ctx, project.cols, project.rows, cell);
  drawRegionHighlight(ctx, cell);
  renderRegionsUI();
  const els = buildElements(project);
  const used = new Set(els.map(e => e.colorIndex)).size;
  const longs = els.filter(e => e.kind === 'long').length, halves = els.filter(e => e.kind === 'overlay').length;
  const plates = planSubstructure(project.cols, project.rows).total;
  const risers = planRisers(project), levels = project.height ? Math.max(0, ...project.height) : 0;
  $('#design-stats').textContent =
    `${project.cols} × ${project.rows} Noppen · ${(project.cols * STUD_MM / 10).toFixed(1)} × ${(project.rows * STUD_MM / 10).toFixed(1)} cm · ` +
    `${els.length} Teile` + (longs ? ` (davon ${longs} lange Fliesen)` : '') + (halves ? ` · ${halves} halbe Noppen` : '') +
    ` · ${used} Farben · Unterbau aus ${plates} Platten` +
    (risers.length ? ` · ${levels} ${levels === 1 ? 'Ebene' : 'Ebenen'} aus ${risers.length} Sockelplatten` : '');
}

// ---------- Bereiche ----------
const segReady = () => segmentation && !project.edited && segmentation.label.length === project.cols * project.rows;
const selectedId = () => (selectedRegion && segReady() ? regionAt(segmentation, project.cols, project.rows, selectedRegion.x, selectedRegion.y) : -1);
const opIndexFor = id => {
  const anchor = o => regionAt(segmentation, project.cols, project.rows, o.x, o.y);
  const k = project.regionOps.findIndex(o => anchor(o) === id);
  return k >= 0 ? k : project.regionOps.findIndex(o => o.similar && regionGroup(segmentation, anchor(o), true).has(id));
};

function drawRegionHighlight(ctx, cell) {
  const sel = selectedId();
  if (sel < 0) return;
  const { cols, rows } = project, group = regionGroup(segmentation, sel, selectedRegion.similar);
  const lab = Int32Array.from(segmentation.label, l => (group.has(l) ? 1 : 0)), id = 1;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,.5)';
  for (let i = 0; i < lab.length; i++) if (lab[i] !== id) ctx.fillRect((i % cols) * cell, ((i / cols) | 0) * cell, cell, cell);
  ctx.strokeStyle = '#ffd400'; ctx.lineWidth = Math.max(2, cell * 0.2); ctx.lineCap = 'round';
  ctx.beginPath();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (lab[y * cols + x] !== id) continue;
    const X = x * cell, Y = y * cell;
    if (x === 0 || lab[y * cols + x - 1] !== id) { ctx.moveTo(X, Y); ctx.lineTo(X, Y + cell); }
    if (x === cols - 1 || lab[y * cols + x + 1] !== id) { ctx.moveTo(X + cell, Y); ctx.lineTo(X + cell, Y + cell); }
    if (y === 0 || lab[(y - 1) * cols + x] !== id) { ctx.moveTo(X, Y); ctx.lineTo(X + cell, Y); }
    if (y === rows - 1 || lab[(y + 1) * cols + x] !== id) { ctx.moveTo(X, Y + cell); ctx.lineTo(X + cell, Y + cell); }
  }
  ctx.stroke(); ctx.restore();
}

function regionThumb(id, rgb) {
  const { cols, rows } = project, lab = segmentation.label;
  const s = Math.max(1, Math.floor(56 / Math.max(cols, rows)));
  const c = document.createElement('canvas'); c.width = cols * s; c.height = rows * s;
  const ctx = c.getContext('2d');
  const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150;
  ctx.fillStyle = light ? '#4a4f57' : '#d9dce1'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = `rgb(${rgb.join(',')})`;
  for (let i = 0; i < lab.length; i++) if (lab[i] === id) ctx.fillRect((i % cols) * s, ((i / cols) | 0) * s, s, s);
  return c;
}

function opBadges(op) {
  if (!op) return '';
  return (op.hide ? '🙈' : '') + (op.colorId != null && !op.hide ? '🎨' : '') + (op.level != null ? `⛰${op.level}` : '');
}

function renderRegionsUI() {
  const panel = $('#regions-panel');
  panel.hidden = !segReady();
  if (panel.hidden) return;
  $('#region-detail').value = project.regionDetail; $('#out-detail').textContent = project.regionDetail;
  $('#btn-regions-reset').disabled = !project.regionOps.length;
  const sel = selectedId();
  // Liste: die größten Bereiche plus alle mit Änderungen
  const withOps = new Set(project.regionOps.map(o => regionAt(segmentation, project.cols, project.rows, o.x, o.y)));
  const ids = segmentation.regions.filter(r => r.id < 12 || withOps.has(r.id)).map(r => r.id);
  if (sel >= 0 && !ids.includes(sel)) ids.push(sel);
  const list = $('#region-list');
  list.innerHTML = '';
  for (const id of ids) {
    const r = segmentation.regions[id], op = project.regionOps[opIndexFor(id)];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'region-item'; b.setAttribute('aria-pressed', id === sel);
    b.title = `Bereich mit ${r.size} Steinen`;
    b.appendChild(regionThumb(id, r.rgb));
    const badge = document.createElement('span'); badge.className = 'region-badge'; badge.textContent = opBadges(op) || `${r.size}`;
    b.appendChild(badge);
    b.addEventListener('click', () => {
      selectedRegion = id === sel ? null : regionAnchor(segmentation, project.cols, project.rows, id);
      adoptOp();
      updateDesignView();
    });
    list.appendChild(b);
  }
  // Aktionen für den gewählten Bereich
  $('#region-actions').hidden = sel < 0;
  if (sel < 0) return;
  const op = project.regionOps[opIndexFor(sel)] || {};
  const group = regionGroup(segmentation, sel, selectedRegion.similar);
  const stones = [...group].reduce((s, g) => s + segmentation.regions[g].size, 0);
  $('#region-info').textContent = group.size > 1 ? `${group.size} Bereiche · ${stones} Steine` : `${stones} Steine`;
  $('#chk-region-similar').checked = !!selectedRegion.similar;
  $('#btn-region-hide').setAttribute('aria-pressed', !!op.hide);
  $('#region-level').value = op.level ?? '';
  const colorOpts = '<option value="">wie berechnet</option>' + project.enabled
    .map(id => LEGO_COLORS[indexByLegoId.get(id)]).filter(Boolean)
    .map(c => `<option value="${c.legoId}">${esc(c.de)}</option>`).join('');
  if ($('#region-color').dataset.opts !== colorOpts) { $('#region-color').innerHTML = colorOpts; $('#region-color').dataset.opts = colorOpts; }
  $('#region-color').value = op.colorId ?? '';
  $('#region-color').disabled = !!op.hide;
}

/** Ändert die Aktion für den gewählten Bereich (legt sie bei Bedarf an, entfernt leere). */
function updateRegionOp(change) {
  const id = selectedId();
  if (id < 0) return;
  let k = opIndexFor(id);
  if (k < 0) { project.regionOps.push({ ...selectedRegion }); k = project.regionOps.length - 1; }
  if (selectedRegion.similar) project.regionOps[k].similar = true; else delete project.regionOps[k].similar;
  const op = Object.assign(project.regionOps[k], change);
  for (const key of ['hide', 'colorId', 'level', 'similar']) if (op[key] === null || op[key] === undefined || op[key] === false) delete op[key];
  if (!('hide' in op) && !('colorId' in op) && !('level' in op)) project.regionOps.splice(k, 1);
  regenerate();
}

function initRegions() {
  $('#preview-canvas').addEventListener('click', e => {
    if (!segReady()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pt = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    const id = regionAt(segmentation, project.cols, project.rows, pt.x, pt.y);
    selectedRegion = id === selectedId() ? null : pt;
    adoptOp();
    updateDesignView();
  });
  $('#region-detail').addEventListener('input', e => { project.regionDetail = +e.target.value; $('#out-detail').textContent = e.target.value; regenerateSoon(); });
  $('#btn-regions-reset').addEventListener('click', () => { project.regionOps = []; regenerate(); });
  $('#btn-region-hide').addEventListener('click', () => updateRegionOp({ hide: $('#btn-region-hide').getAttribute('aria-pressed') !== 'true' }));
  $('#region-level').addEventListener('change', e => updateRegionOp({ level: e.target.value === '' ? null : +e.target.value }));
  $('#region-color').addEventListener('change', e => updateRegionOp({ colorId: e.target.value === '' ? null : +e.target.value }));
  $('#btn-region-clear').addEventListener('click', () => updateRegionOp({ hide: null, colorId: null, level: null }));
  $('#btn-region-close').addEventListener('click', () => { selectedRegion = null; updateDesignView(); });
  $('#chk-region-similar').addEventListener('change', e => {
    if (!selectedRegion) return;
    selectedRegion.similar = e.target.checked;
    if (opIndexFor(selectedId()) >= 0) updateRegionOp({}); else updateDesignView();
  });
}

/** Übernimmt beim Auswählen „alle ähnlichen“ aus einer vorhandenen Aktion. */
function adoptOp() {
  if (!selectedRegion) return;
  const op = project.regionOps[opIndexFor(selectedId())];
  selectedRegion = op ? { x: op.x, y: op.y, similar: !!op.similar } : { ...selectedRegion, similar: false };
}

function setSize(cols, rows) {
  project.cols = cols; project.rows = rows;
  sampled = null;
}

const clampStuds = v => Math.min(160, Math.max(8, Math.round(+v) || 8));
const sizeOptionExists = v => /^[\w-]+$/.test(v) && !!document.querySelector(`#size-preset option[value="${v}"]`);

/** Maße aus Formatvorgabe, Ausrichtung und eigenen Eingaben übernehmen. */
function applySizeFromControls() {
  const v = project.sizePreset;
  if (v in PAPER_FORMATS) { const { cols, rows } = paperStuds(v, project.orientation); setSize(cols, rows); }
  else if (v === 'custom') setSize(clampStuds($('#size-w').value), clampStuds($('#size-h').value));
  else { const [w, h] = v.split('x').map(Number); setSize(w * SECTION, h * SECTION); }
  syncSizeControls();
}

function syncSizeControls() {
  const v = project.sizePreset;
  $('#size-preset').value = v;
  $('#orient-row').hidden = !(v in PAPER_FORMATS);
  $$('input[name="orient"]').forEach(r => { r.checked = r.value === project.orientation; });
  $('#custom-size').hidden = v !== 'custom';
  $('#size-w').value = project.cols; $('#size-h').value = project.rows;
}

function renderPaletteChips() {
  const wrap = $('#palette-chips');
  wrap.innerHTML = '';
  const enabled = new Set(project.enabled);
  LEGO_COLORS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip-toggle';
    b.style.background = c.hex;
    b.title = `${c.de} – LEGO ${c.legoName} (${c.legoId})`;
    b.setAttribute('aria-label', c.de);
    b.setAttribute('aria-pressed', enabled.has(c.legoId));
    const ci = indexByLegoId.get(c.legoId);
    if (project.colorCount > 0 && chosenColors && enabled.has(c.legoId) && !chosenColors.has(ci)) b.classList.add('unused');
    if (project.colorCount > 0 && project.pinned.includes(c.legoId)) { b.classList.add('pinned'); b.textContent = '📌'; }
    b.addEventListener('click', () => {
      if ($('#chk-pin').checked && project.colorCount > 0) {
        const pin = !project.pinned.includes(c.legoId);
        project.pinned = pin ? [...project.pinned, c.legoId] : project.pinned.filter(id => id !== c.legoId);
        if (pin && !project.enabled.includes(c.legoId)) project.enabled = [...project.enabled, c.legoId];
        renderPaletteChips(); regenerateSoon();
        return;
      }
      const on = b.getAttribute('aria-pressed') !== 'true';
      if (!on && project.enabled.length <= 1) return;
      b.setAttribute('aria-pressed', on);
      project.enabled = on ? [...project.enabled, c.legoId] : project.enabled.filter(id => id !== c.legoId);
      project.palettePreset = 'custom';
      $('#palette-preset').value = 'custom';
      $('#palette-count').textContent = project.enabled.length;
      regenerateSoon();
    });
    wrap.appendChild(b);
  });
  $('#palette-count').textContent = project.enabled.length;
  $('#color-count').value = project.colorCount;
  $('#pin-wrap').hidden = !(project.colorCount > 0);
}

function syncControls() {
  $('#project-title').value = project.title;
  syncSizeControls();
  $('#part-select').value = project.part;
  $('#edge-select').value = project.edgePart;
  $('#edge-sens').value = project.edgeSensitivity; $('#out-edge').textContent = project.edgeSensitivity;
  $('#edge-sens-wrap').hidden = project.edgePart === 'same' || project.edgePart === project.part;
  $('#chk-long').checked = project.longTiles;
  $('#adj-relief').value = project.relief; $('#out-relief').textContent = project.relief;
  $('#adj-sharpen').value = project.sharpen; $('#out-sharpen').textContent = project.sharpen;
  $('#adj-simplify').value = project.simplify; $('#out-simplify').textContent = project.simplify;
  $('#adj-depth').value = project.depth; $('#out-depth').textContent = project.depth;
  for (const k of ['brightness', 'contrast', 'saturation']) {
    $(`#adj-${k}`).value = project.adjust[k]; $(`#out-${k}`).textContent = project.adjust[k];
  }
  $('#adj-dither').value = project.dither; $('#out-dither').textContent = project.dither;
  $('#crop-zoom').value = project.crop.zoom;
  $('#palette-preset').value = project.palettePreset;
  $('#spare-select').value = project.sparePercent;
  $('#chk-base').checked = project.includeBase;
  $('#base-color').value = project.baseColorId;
  $('#riser-color').value = project.riserColorId;
  renderPaletteChips();
}

function initDesign() {
  // Steintypen
  const partOptions = Object.entries(STUD_PARTS)
    .map(([k, p]) => `<option value="${k}">${p.label} (BrickLink ${p.blId})</option>`).join('');
  $('#part-select').innerHTML = partOptions;
  $('#edge-select').innerHTML = '<option value="same">wie Flächen (nicht mischen)</option>' + partOptions;
  $('#paper-formats').innerHTML = Object.keys(PAPER_FORMATS).map(f => {
    const { cols, rows } = paperStuds(f);
    return `<option value="${f}">${f} · ${cols} × ${rows} Noppen (${(cols * STUD_MM / 10).toFixed(1).replace('.', ',')} × ${(rows * STUD_MM / 10).toFixed(1).replace('.', ',')} cm)</option>`;
  }).join('');
  $('#palette-preset').innerHTML = Object.entries(PALETTE_PRESETS)
    .map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('') + '<option value="custom">Eigene Auswahl</option>';

  const input = $('#input-photo'), dz = $('#drop-zone');
  input.addEventListener('change', () => { setPhoto(input.files[0]); input.value = ''; });
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); setPhoto(e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) setPhoto(f);
  });

  // Ausschnitt verschieben
  const cc = $('#crop-canvas');
  let drag = null;
  cc.addEventListener('pointerdown', e => {
    if (!image || project.edited) return;
    cc.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, cx: project.crop.cx, cy: project.crop.cy };
  });
  cc.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = cc.getBoundingClientRect();
    project.crop.cx = drag.cx + (e.clientX - drag.x) / r.width;
    project.crop.cy = drag.cy + (e.clientY - drag.y) / r.height;
    drawCrop(); regenerateSoon();
  });
  const endDrag = () => { drag = null; };
  cc.addEventListener('pointerup', endDrag); cc.addEventListener('pointercancel', endDrag);
  $('#crop-zoom').addEventListener('input', e => { project.crop.zoom = +e.target.value; drawCrop(); regenerateSoon(); });

  $('#size-preset').addEventListener('change', e => {
    project.sizePreset = e.target.value;
    applySizeFromControls(); regenerate();
  });
  $$('input[name="orient"]').forEach(r => r.addEventListener('change', () => {
    project.orientation = r.value;
    applySizeFromControls(); regenerate();
  }));
  for (const id of ['#size-w', '#size-h']) $(id).addEventListener('change', () => {
    applySizeFromControls(); regenerate();
  });
  const setAndRegen = (key, val) => { project[key] = val; syncControls(); regenerateSoon(); };
  $('#part-select').addEventListener('change', e => setAndRegen('part', e.target.value));
  $('#edge-select').addEventListener('change', e => setAndRegen('edgePart', e.target.value));
  $('#edge-sens').addEventListener('input', e => { project.edgeSensitivity = +e.target.value; $('#out-edge').textContent = e.target.value; regenerateSoon(); });
  $('#chk-long').addEventListener('change', e => { project.longTiles = e.target.checked; updateDesignView(); save(); });
  $('#adj-relief').addEventListener('input', e => { project.relief = +e.target.value; $('#out-relief').textContent = e.target.value; regenerateSoon(); });
  $('#adj-sharpen').addEventListener('input', e => { project.sharpen = +e.target.value; $('#out-sharpen').textContent = e.target.value; regenerateSoon(); });
  $('#adj-simplify').addEventListener('input', e => { project.simplify = +e.target.value; $('#out-simplify').textContent = e.target.value; regenerateSoon(); });
  $('#adj-depth').addEventListener('input', e => { project.depth = +e.target.value; $('#out-depth').textContent = e.target.value; regenerateSoon(); });
  for (const k of ['brightness', 'contrast', 'saturation']) {
    $(`#adj-${k}`).addEventListener('input', e => {
      project.adjust[k] = +e.target.value; $(`#out-${k}`).textContent = e.target.value; regenerateSoon();
    });
  }
  $('#adj-dither').addEventListener('input', e => { project.dither = +e.target.value; $('#out-dither').textContent = e.target.value; regenerateSoon(); });
  $('#color-count').addEventListener('change', e => { project.colorCount = +e.target.value; renderPaletteChips(); regenerate(); });
  $('#palette-preset').addEventListener('change', e => {
    const p = PALETTE_PRESETS[e.target.value];
    project.palettePreset = e.target.value;
    if (p) { project.enabled = p.ids.slice(); renderPaletteChips(); regenerate(); }
  });
  $('#btn-unlock').addEventListener('click', () => {
    if (!confirm('Deine von Hand gesetzten Steine gehen verloren und das Mosaik wird neu aus dem Foto berechnet. Fortfahren?')) return;
    project.edited = false;
    if (!image) { toast('Kein Foto vorhanden – bitte zuerst ein Foto wählen.'); }
    regenerate();
  });
  $('#btn-to-edit').addEventListener('click', () => showTab('edit'));
}

// ---------- Editor ----------
let editor;
function initEditor() {
  editor = new Editor({
    canvas: $('#editor-canvas'), viewport: $('#editor-viewport'),
    onChange: kind => {
      $('#zoom-label').textContent = editor.zoomPercent + ' %';
      if (kind === 'edit') {
        project.edited = true; save(); renderUsedColors(); debouncedDesign();
      }
    },
    onPick: ci => { selectColor(ci); setTool('brush'); },
    onCursor: cell => {
      if (!cell) { $('#cursor-pos').textContent = ''; return; }
      const sec = Math.floor(cell.y / SECTION) * Math.ceil(project.cols / SECTION) + Math.floor(cell.x / SECTION) + 1;
      $('#cursor-pos').textContent = `Spalte ${cell.x + 1}, Zeile ${cell.y + 1} · Abschnitt ${sec} · ${LEGO_COLORS[project.grid[cell.i]].de}`;
    },
    onHistory: () => { $('#btn-undo').disabled = !editor.undoStack.length; $('#btn-redo').disabled = !editor.redoStack.length; },
    onHalfRot: () => updateHalfPreview(),
  });
  $('#shape-select').innerHTML = SHAPE_KEYS.map((k, i) => `<option value="${i}">${STUD_PARTS[k].label}</option>`).join('');
  $('#shape-select').value = editor.shape;
  $('#shape-select').addEventListener('change', e => editor.setShape(+e.target.value));
  $('#level-select').addEventListener('change', e => editor.setLevel(+e.target.value));
  $('#half-kind').addEventListener('change', e => { editor.setHalf(+e.target.value); updateHalfPreview(); });
  $('#btn-rotate').addEventListener('click', () => { editor.setHalf(editor.halfKind, editor.halfRot + 1); updateHalfPreview(); });
  updateHalfPreview();
  editor.onHistory();
  $('#editor-canvas').addEventListener('contextmenu', e => e.preventDefault());
  $$('.tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('#btn-undo').addEventListener('click', () => editor.undo());
  $('#btn-redo').addEventListener('click', () => editor.redo());
  $('#btn-zoom-in').addEventListener('click', () => editor.zoomBy(1));
  $('#btn-zoom-out').addEventListener('click', () => editor.zoomBy(-1));
  $('#chk-grid').addEventListener('change', e => editor.setGrid(e.target.checked));
  window.addEventListener('keydown', e => {
    if (currentTab !== 'edit' || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); editor.undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); editor.redo(); }
    else if (!mod && e.key === 'b') setTool('brush');
    else if (!mod && e.key === 'f') setTool('fill');
    else if (!mod && e.key === 'i') setTool('pick');
    else if (!mod && e.key === 's') setTool('shape');
    else if (!mod && e.key === 'h') setTool('half');
    else if (!mod && e.key === 'l') setTool('level');
    else if (!mod && e.key === 'r') { editor.setHalf(editor.halfKind, editor.halfRot + 1); updateHalfPreview(); }
    else if (!mod && (e.key === '+' || e.key === '=')) editor.zoomBy(1);
    else if (!mod && e.key === '-') editor.zoomBy(-1);
  });
  // Alle Farben
  $('#all-colors').innerHTML = '';
  LEGO_COLORS.forEach((c, i) => $('#all-colors').appendChild(colorButton(i)));
  selectColor(0);
}
const debouncedDesign = debounce(updateDesignView, 300);

function setTool(t) {
  editor.setTool(t);
  $$('.tool').forEach(b => b.setAttribute('aria-pressed', b.dataset.tool === t));
  $('#shape-opts').hidden = t !== 'shape';
  $('#half-opts').hidden = t !== 'half';
  $('#level-opts').hidden = t !== 'level';
}

function updateHalfPreview() {
  const kind = editor.halfKind;
  $('#half-preview path').setAttribute('d', kind >= 0 ? overlayPath(overlayCode(kind, editor.halfRot)) : '');
  $('#btn-rotate').disabled = kind < 0;
}

function colorButton(ci, count) {
  const c = LEGO_COLORS[ci];
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'color-item'; b.dataset.ci = ci;
  b.title = `${c.de} – LEGO ${c.legoName} (${c.legoId}) / BrickLink ${c.blName} (${c.blId})`;
  b.setAttribute('aria-pressed', ci === editor?.color);
  b.innerHTML = `<span class="swatch" style="background:${c.hex}"></span><span class="label">${esc(c.de)}</span>` +
    (count !== undefined ? `<span class="count">${count}</span>` : '');
  b.addEventListener('click', () => selectColor(ci));
  return b;
}

function selectColor(ci) {
  editor.setColor(ci);
  const c = LEGO_COLORS[ci];
  $('#current-swatch').style.background = c.hex;
  $('#current-name').textContent = `${c.de} (${c.legoName})`;
  $$('.color-item').forEach(b => b.setAttribute('aria-pressed', +b.dataset.ci === ci));
}

function renderUsedColors() {
  const wrap = $('#used-colors');
  wrap.innerHTML = '';
  if (!project.grid) return;
  const all = project.overlay ? [...project.grid, ...project.overlayColor.filter((_, i) => project.overlay[i])] : project.grid;
  countColors(all, LEGO_COLORS.length)
    .map((n, i) => [i, n]).filter(([, n]) => n).sort((a, b) => b[1] - a[1])
    .forEach(([i, n]) => wrap.appendChild(colorButton(i, n)));
}

// ---------- Bestellliste ----------
function currentOrderList() {
  return buildOrderList({ ...project });
}

function renderOrder() {
  const el = $('#order-content');
  if (!project.grid) { el.innerHTML = '<div class="empty"><p>Noch kein Mosaik vorhanden.</p></div>'; return; }
  const list = currentOrderList();
  const row = it => `<tr>
      <td><span class="swatch" style="background:${it.color.hex}"></span></td>
      <td><span class="part-name">${esc(it.part.label)}</span><br><small>BL ${esc(it.part.blId)} · LEGO ${esc(it.part.designId)}</small></td>
      <td>${esc(it.color.de)}</td>
      <td>${esc(it.color.legoName)} <small>(${it.color.legoId})</small></td>
      <td>${esc(it.color.blName)} <small>(${it.color.blId})</small></td>
      <td class="num">${it.needed}</td><td class="num">${it.spare}</td><td class="num"><strong>${it.qty}</strong></td></tr>`;
  el.innerHTML = `<h1 class="print-title">${esc(project.title)} – Bestellliste</h1><div class="table-wrap"><table>
    <thead><tr><th></th><th>Teil</th><th>Farbe</th><th>LEGO-Farbe (ID)</th><th>BrickLink-Farbe (ID)</th><th class="num">Benötigt</th><th class="num">Reserve</th><th class="num">Bestellen</th></tr></thead>
    <tbody>${list.items.map(row).join('')}${list.risers.length ? `<tr class="group"><th colspan="8">Sockel für Ebenen</th></tr>${list.risers.map(row).join('')}` : ''}${list.base.length ? `<tr class="group"><th colspan="8">Unterbau (2 Lagen)</th></tr>${list.base.map(row).join('')}` : ''}</tbody>
    <tfoot><tr><td colspan="5">${list.items.length} Farben · ${project.cols}×${project.rows} Noppen</td><td class="num">${project.cols * project.rows}</td><td></td><td class="num">${list.totalStuds}${list.totalRisers ? ` + ${list.totalRisers} Sockel` : ''}${list.base.length ? ` + ${list.totalPlates} Platten` : ''}</td></tr></tfoot>
  </table></div>`;
}

function initOrder() {
  $('#base-color').innerHTML = LEGO_COLORS.map(c => `<option value="${c.legoId}">${esc(c.de)} (${esc(c.legoName)})</option>`).join('');
  $('#spare-select').addEventListener('change', e => { project.sparePercent = +e.target.value; renderOrder(); save(); });
  $('#chk-base').addEventListener('change', e => { project.includeBase = e.target.checked; renderOrder(); save(); });
  $('#base-color').addEventListener('change', e => { project.baseColorId = +e.target.value; renderOrder(); save(); });
  $('#riser-color').innerHTML = '<option value="match">wie Oberfläche (Seiten in Bildfarbe)</option>' + $('#base-color').innerHTML;
  $('#riser-color').addEventListener('change', e => { const v = e.target.value; project.riserColorId = v === 'match' ? v : +v; renderOrder(); save(); });
  $('#btn-csv').addEventListener('click', () => project.grid && download(`${slug(project.title)}-bestellliste.csv`, orderListToCsv(currentOrderList()), 'text/csv;charset=utf-8'));
  $('#btn-bricklink').addEventListener('click', () => project.grid && download(`${slug(project.title)}-bricklink.xml`, orderListToBrickLinkXml(currentOrderList()), 'application/xml'));
  $('#btn-copy-xml').addEventListener('click', async () => {
    if (!project.grid) return;
    try { await navigator.clipboard.writeText(orderListToBrickLinkXml(currentOrderList())); toast('XML in die Zwischenablage kopiert'); }
    catch { toast('Kopieren nicht möglich – bitte Download nutzen'); }
  });
  $('#btn-print-order').addEventListener('click', () => printTab('order'));
}

// ---------- Anleitung ----------
function renderGuide() {
  const el = $('#guide-content');
  if (!project.grid) { el.innerHTML = '<div class="empty"><p>Noch kein Mosaik vorhanden.</p></div>'; return; }
  el.innerHTML = buildInstructionsHtml(project, project.title);
}
function printTab(tab) {
  const panel = $(`#tab-${tab}`);
  panel.classList.add('printing');
  const prev = document.title;
  document.title = `${project.title} – ${tab === 'guide' ? 'Bauanleitung' : 'Bestellliste'}`;
  window.addEventListener('afterprint', () => { panel.classList.remove('printing'); document.title = prev; }, { once: true });
  window.print();
}

// ---------- Tabs ----------
let currentTab = 'design';
function showTab(tab) {
  currentTab = tab;
  $$('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => { p.hidden = p.id !== `tab-${tab}`; });
  if (tab === 'edit') {
    $('#edit-empty').hidden = !!project.grid;
    $('#editor-canvas').hidden = !project.grid;
    if (project.grid) { editor.setProject(project); renderUsedColors(); selectColor(editor.color); }
  } else if (tab === 'order') renderOrder();
  else if (tab === 'guide') renderGuide();
  else updateDesignView();
  if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
}

// ---------- Projektmenü ----------
async function blobToDataUrl(blob) {
  return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}
function initMenu() {
  $('#project-title').addEventListener('input', e => { project.title = e.target.value || 'Mein LEGO-Mosaik'; save(); });
  $('#btn-export').addEventListener('click', async () => {
    const data = { ...serialize(), image: imageBlob ? await blobToDataUrl(imageBlob) : null };
    download(`${slug(project.title)}.mosaik.json`, JSON.stringify(data), 'application/json');
  });
  $('#input-import').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || data.version !== 1) throw new Error();
      project = deserialize(data);
      if (data.image) {
        imageBlob = await (await fetch(data.image)).blob();
        image = await loadImageFromBlob(imageBlob);
        await kvSet('image', imageBlob);
      } else { image = null; imageBlob = null; await kvDel('image'); }
      sampled = null;
      editor.setProject(null, { resetHistory: true });
      syncControls(); save(); showTab('design');
      if (!project.grid) regenerate();
      toast('Projekt geladen');
    } catch { toast('Datei ist kein gültiges Mosaik-Projekt.'); }
    $('.menu').open = false;
  });
  $('#btn-new').addEventListener('click', async () => {
    if (!confirm('Aktuelles Projekt verwerfen und neu beginnen?')) return;
    project = defaultProject(); image = null; imageBlob = null; sampled = null;
    await kvDel('image'); await kvDel('project');
    editor.setProject(null, { resetHistory: true });
    syncControls(); showTab('design');
    $('.menu').open = false;
  });
}

// ---------- PWA ----------
function initPwa() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(console.warn);
  }
  let deferred;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt(); await deferred.userChoice; deferred = null; $('#btn-install').hidden = true;
  });
}

// ---------- Start ----------
async function init() {
  initDesign(); initRegions(); initEditor(); initOrder(); initMenu(); initPwa();
  $$('.tabs button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  try {
    const saved = await kvGet('project');
    if (saved) project = deserialize(saved);
    const blob = await kvGet('image');
    if (blob) { imageBlob = blob; image = await loadImageFromBlob(blob); }
  } catch (e) { console.warn('Laden fehlgeschlagen', e); }
  syncControls();
  if (image && !project.grid) regenerate(); else drawCrop();
  const tab = location.hash.slice(1);
  showTab(['design', 'edit', 'order', 'guide'].includes(tab) ? tab : 'design');
}
init();
