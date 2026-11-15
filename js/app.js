import { LEGO_COLORS, PALETTE_PRESETS } from './colors.js';
import { STUD_PARTS, STUD_MM, BASE_PART } from './parts.js';
import { boxDownsample, adjustPixels, preparePalette, quantize, countColors } from './mosaic.js';
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
    sizePreset: '3x3', sw: 3, sh: 3,
    part: 'plate-round',
    crop: { zoom: 1, cx: 0.5, cy: 0.5 },
    adjust: { brightness: 0, contrast: 0, saturation: 0 },
    dither: 0,
    palettePreset: 'all',
    enabled: PALETTE_PRESETS.all.ids.slice(),
    edited: false,
    sparePercent: 5, includeBase: true, baseColorId: 26,
    cols: 48, rows: 48, grid: null, // grid: Uint8Array mit Indizes in LEGO_COLORS
  };
}

let project = defaultProject();
let image = null;      // HTMLImageElement / ImageBitmap
let imageBlob = null;
let sampled = null;    // gemittelte RGB-Werte (vor Anpassungen)
let sampledKey = '';

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
function serialize() {
  return { ...project, grid: project.grid ? Array.from(project.grid, i => LEGO_COLORS[i].legoId) : null };
}
function deserialize(data) {
  const p = { ...defaultProject(), ...data };
  p.crop = { ...defaultProject().crop, ...data.crop };
  p.adjust = { ...defaultProject().adjust, ...data.adjust };
  if (Array.isArray(data.grid) && data.grid.length === p.cols * p.rows) {
    p.grid = Uint8Array.from(data.grid, id => indexByLegoId.get(id) ?? 0);
  } else { p.grid = null; p.edited = false; }
  return p;
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
  // Abschnitts-Linien
  ctx.strokeStyle = 'rgba(242,205,55,.6)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < project.sw; i++) { const x = (r.x + (r.w * i) / project.sw) * s; ctx.moveTo(x, r.y * s); ctx.lineTo(x, (r.y + r.h) * s); }
  for (let j = 1; j < project.sh; j++) { const y = (r.y + (r.h * j) / project.sh) * s; ctx.moveTo(r.x * s, y); ctx.lineTo((r.x + r.w) * s, y); }
  ctx.stroke();
}

function sampleImage() {
  const r = cropRect();
  const key = [image.src, project.cols, project.rows, r.x, r.y, r.w, r.h].join('|');
  if (key === sampledKey && sampled) return sampled;
  const k = Math.max(1, Math.min(8, Math.floor(2048 / Math.max(project.cols, project.rows))));
  const w = project.cols * k, h = project.rows * k;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, w, h);
  sampled = boxDownsample(ctx.getImageData(0, 0, w, h).data, w, h, project.cols, project.rows);
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
  const idx = enabledIndices();
  if (!idx.length) { toast('Mindestens eine Farbe aktivieren.'); return; }
  const px = adjustPixels(Float32Array.from(sampleImage()), project.adjust);
  const prepared = preparePalette(idx.map(i => LEGO_COLORS[i]));
  const q = quantize(px, project.cols, project.rows, prepared, { dither: project.dither / 100 });
  project.grid = Uint8Array.from(q, i => idx[i]);
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
  for (const id of ['#design-settings', '#design-adjust', '#design-palette']) $(id).disabled = project.edited;
  $('#crop-zoom').disabled = project.edited;
  if (!has) { $('#design-stats').textContent = ''; return; }
  const c = $('#preview-canvas');
  const cell = Math.max(4, Math.min(14, Math.floor(1100 / Math.max(project.cols, project.rows))));
  c.width = project.cols * cell; c.height = project.rows * cell;
  const ctx = c.getContext('2d');
  renderMosaic(ctx, project, cell, STUD_PARTS[project.part].shape);
  drawSectionLines(ctx, project.cols, project.rows, cell);
  const used = countColors(project.grid, LEGO_COLORS.length).filter(Boolean).length;
  $('#design-stats').textContent =
    `${project.cols} × ${project.rows} Noppen · ${(project.cols * STUD_MM / 10).toFixed(1)} × ${(project.rows * STUD_MM / 10).toFixed(1)} cm · ` +
    `${project.cols * project.rows} Teile · ${used} Farben · ${project.sw * project.sh} Grundplatten`;
}

function setSize(sw, sh) {
  project.sw = sw; project.sh = sh;
  project.cols = sw * BASE_PART.size; project.rows = sh * BASE_PART.size;
  sampled = null;
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
    b.addEventListener('click', () => {
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
}

function syncControls() {
  $('#project-title').value = project.title;
  $('#size-preset').value = project.sizePreset;
  $('#custom-size').hidden = project.sizePreset !== 'custom';
  $('#size-w').value = project.sw; $('#size-h').value = project.sh;
  $('#part-select').value = project.part;
  for (const k of ['brightness', 'contrast', 'saturation']) {
    $(`#adj-${k}`).value = project.adjust[k]; $(`#out-${k}`).textContent = project.adjust[k];
  }
  $('#adj-dither').value = project.dither; $('#out-dither').textContent = project.dither;
  $('#crop-zoom').value = project.crop.zoom;
  $('#palette-preset').value = project.palettePreset;
  $('#spare-select').value = project.sparePercent;
  $('#chk-base').checked = project.includeBase;
  $('#base-color').value = project.baseColorId;
  renderPaletteChips();
}

function initDesign() {
  // Steintypen
  $('#part-select').innerHTML = Object.entries(STUD_PARTS)
    .map(([k, p]) => `<option value="${k}">${p.label} (BrickLink ${p.blId})</option>`).join('');
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
    $('#custom-size').hidden = project.sizePreset !== 'custom';
    if (project.sizePreset !== 'custom') {
      const [w, h] = project.sizePreset.split('x').map(Number);
      setSize(w, h);
    } else setSize(+$('#size-w').value, +$('#size-h').value);
    $('#size-w').value = project.sw; $('#size-h').value = project.sh;
    regenerate();
  });
  for (const id of ['#size-w', '#size-h']) $(id).addEventListener('change', () => {
    const w = Math.min(8, Math.max(1, +$('#size-w').value || 1)), h = Math.min(8, Math.max(1, +$('#size-h').value || 1));
    $('#size-w').value = w; $('#size-h').value = h;
    setSize(w, h); regenerate();
  });
  $('#part-select').addEventListener('change', e => { project.part = e.target.value; updateDesignView(); save(); });
  for (const k of ['brightness', 'contrast', 'saturation']) {
    $(`#adj-${k}`).addEventListener('input', e => {
      project.adjust[k] = +e.target.value; $(`#out-${k}`).textContent = e.target.value; regenerateSoon();
    });
  }
  $('#adj-dither').addEventListener('input', e => { project.dither = +e.target.value; $('#out-dither').textContent = e.target.value; regenerateSoon(); });
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
      const sec = Math.floor(cell.y / 16) * project.sw + Math.floor(cell.x / 16) + 1;
      $('#cursor-pos').textContent = `Spalte ${cell.x + 1}, Zeile ${cell.y + 1} · Abschnitt ${sec} · ${LEGO_COLORS[project.grid[cell.i]].de}`;
    },
    onHistory: () => { $('#btn-undo').disabled = !editor.undoStack.length; $('#btn-redo').disabled = !editor.redoStack.length; },
  });
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
  countColors(project.grid, LEGO_COLORS.length)
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
    <tbody>${list.items.map(row).join('')}${list.base ? row(list.base) : ''}</tbody>
    <tfoot><tr><td colspan="5">${list.items.length} Farben · ${project.cols}×${project.rows} Noppen</td><td class="num">${project.cols * project.rows}</td><td></td><td class="num">${list.totalStuds}${list.base ? ` + ${list.base.qty} Platten` : ''}</td></tr></tfoot>
  </table></div>`;
}

function initOrder() {
  $('#base-color').innerHTML = LEGO_COLORS.map(c => `<option value="${c.legoId}">${esc(c.de)} (${esc(c.legoName)})</option>`).join('');
  $('#spare-select').addEventListener('change', e => { project.sparePercent = +e.target.value; renderOrder(); save(); });
  $('#chk-base').addEventListener('change', e => { project.includeBase = e.target.checked; renderOrder(); save(); });
  $('#base-color').addEventListener('change', e => { project.baseColorId = +e.target.value; renderOrder(); save(); });
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
  initDesign(); initEditor(); initOrder(); initMenu(); initPwa();
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
