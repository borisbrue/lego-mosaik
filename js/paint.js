// Malmodus – Bedienung: Formen auswählen, verschieben, skalieren, drehen, gruppieren.
// Die Umrechnung in Steine macht drawing.js; hier nur Zeichnen der Griffe und Zeigerlogik.
import { LEGO_COLORS } from './colors.js';
import { renderMosaic, drawSectionLines, drawCell, drawOverlay, shapeOf } from './render.js';
import { OVERLAY_COVERED, overlaySize } from './parts.js';
import { newShape, cloneShape, corners, bounds, hitTest, snapShape } from './drawing.js';

const HANDLE = 7;     // halbe Griffgröße in px
const ROT_GAP = 26;   // Abstand des Drehgriffs über der Form in px

export class Painter {
  /**
   * @param canvas, viewport DOM-Elemente
   * @param getProject () => Projekt (cols, rows, grid … und drawing)
   * @param onChange (final: boolean) => void – Formen geändert (final = Zeiger losgelassen o. Ä.)
   * @param onSelect () => void – Auswahl geändert
   */
  constructor({ canvas, viewport, getProject, onChange, onSelect }) {
    Object.assign(this, { canvas, viewport, getProject, onChange, onSelect });
    this.ctx = canvas.getContext('2d');
    this.selection = new Set();
    this.snap = true;
    this.zoom = 1;
    this.undoStack = []; this.redoStack = [];
    this.drag = null;
    this.buffer = document.createElement('canvas'); // Mosaik ohne Griffe (wird beim Ziehen nur teilweise neu gezeichnet)
    this.last = null;                               // zuletzt gezeichnete Raster
    this.pendingMove = null;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => {
      // höchstens eine Neuberechnung je Bild
      const first = !this.pendingMove;
      this.pendingMove = e;
      if (first) requestAnimationFrame(() => { const ev = this.pendingMove; this.pendingMove = null; if (ev) this.move(ev); });
    });
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
  }

  get items() { return this.getProject().drawing; }
  get cell() {
    const p = this.getProject(), vw = this.viewport.clientWidth - 24, vh = this.viewport.clientHeight - 24;
    const fit = Math.floor(Math.min(vw / p.cols, vh / p.rows));
    return Math.max(4, Math.min(40, Math.round(Math.max(4, fit) * this.zoom)));
  }
  selected() { return this.items.filter(s => this.selection.has(s.id)); }

  // ---------- Verlauf ----------
  snapshot() { return JSON.stringify(this.items); }
  record() { this.undoStack.push(this.snapshot()); if (this.undoStack.length > 100) this.undoStack.shift(); this.redoStack = []; }
  restore(json) {
    const p = this.getProject();
    p.drawing = JSON.parse(json);
    for (const id of [...this.selection]) if (!p.drawing.some(s => s.id === id)) this.selection.delete(id);
    this.changed(true);
  }
  undo() { if (this.undoStack.length) { this.redoStack.push(this.snapshot()); this.restore(this.undoStack.pop()); } }
  redo() { if (this.redoStack.length) { this.undoStack.push(this.snapshot()); this.restore(this.redoStack.pop()); } }

  changed(final) { this.onChange(final); this.onSelect?.(); }

  // ---------- Befehle ----------
  add(kind, colorId) {
    const p = this.getProject();
    this.record();
    const s = newShape(kind, p.cols / 2, p.rows / 2, colorId, Math.max(2, Math.round(Math.min(p.cols, p.rows) / 6)));
    if (this.snap) snapShape(s);
    p.drawing.push(s);
    this.selection = new Set([s.id]);
    this.changed(true);
  }
  remove() {
    if (!this.selection.size) return;
    this.record();
    const p = this.getProject();
    p.drawing = p.drawing.filter(s => !this.selection.has(s.id));
    this.selection.clear();
    this.changed(true);
  }
  duplicate() {
    const sel = this.selected();
    if (!sel.length) return;
    this.record();
    const groups = new Map(), copies = sel.map(s => {
      const c = cloneShape(s, 2, 2);
      if (s.group) { if (!groups.has(s.group)) groups.set(s.group, `g${c.id}`); c.group = groups.get(s.group); }
      return c;
    });
    this.items.push(...copies);
    this.selection = new Set(copies.map(c => c.id));
    this.changed(true);
  }
  group() {
    const sel = this.selected();
    if (sel.length < 2) return;
    this.record();
    const g = `g${sel[0].id}`;
    for (const s of sel) s.group = g;
    this.changed(true);
  }
  ungroup() {
    const sel = this.selected();
    if (!sel.some(s => s.group)) return;
    this.record();
    for (const s of sel) s.group = null;
    this.changed(true);
  }
  /** Reihenfolge: +1 nach vorne, -1 nach hinten (ganz). */
  order(dir) {
    const sel = this.selected();
    if (!sel.length) return;
    this.record();
    const p = this.getProject(), rest = p.drawing.filter(s => !this.selection.has(s.id));
    p.drawing = dir > 0 ? [...rest, ...sel] : [...sel, ...rest];
    this.changed(true);
  }
  /** Eigenschaft der Auswahl setzen (colorId, level, rot, w, h). */
  set(prop, value) {
    const sel = this.selected();
    if (!sel.length) return;
    this.record();
    if (prop === 'rot' && sel.length > 1) this.rotateAll(sel, sel.map(s => ({ ...s })), value - (sel[0].rot || 0));
    else for (const s of sel) { s[prop] = value; if (this.snap && ['w', 'h', 'rot'].includes(prop)) snapShape(s); }
    this.changed(true);
  }
  nudge(dx, dy) {
    const sel = this.selected();
    if (!sel.length) return;
    this.record();
    for (const s of sel) { s.cx += dx; s.cy += dy; }
    this.changed(true);
  }
  selectAll() { this.selection = new Set(this.items.map(s => s.id)); this.redraw(); this.onSelect?.(); }

  // ---------- Zeichnen ----------
  /**
   * @param full true: Mosaik komplett im fertigen Look (lange Fliesen, Relief) zeichnen;
   *             false: nur geänderte Noppen (schnell, beim Ziehen)
   */
  redraw(full = true) {
    const p = this.getProject();
    if (!p.grid) return;
    const cell = this.cell, W = p.cols * cell, H = p.rows * cell, b = this.buffer, bctx = b.getContext('2d');
    if (full || !this.last || b.width !== W || b.height !== H || this.last.cell !== cell) {
      b.width = W; b.height = H;
      renderMosaic(bctx, p, cell);
    } else this.patch(bctx, p, cell);
    this.last = { cell, grid: Uint8Array.from(p.grid), overlay: Uint8Array.from(p.overlay), overlayColor: Uint8Array.from(p.overlayColor), shapes: Uint8Array.from(p.shapes) };
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    const ctx = this.ctx;
    ctx.drawImage(b, 0, 0);
    drawSectionLines(ctx, p.cols, p.rows, cell);
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.setLineDash([4, 3]);
    for (const s of this.items) this.outline(ctx, s, cell);
    ctx.setLineDash([]);
    const sel = this.selected();
    if (sel.length) {
      ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 2;
      for (const s of sel) this.outline(ctx, s, cell);
      const h = this.handles();
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1e88e5'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.setLineDash([4, 3]); ctx.moveTo(...h.box[0]); for (const q of h.box.slice(1)) ctx.lineTo(...q); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(...h.topMid); ctx.lineTo(...h.rot); ctx.stroke();
      for (const [x, y] of h.box) { ctx.fillRect(x - HANDLE, y - HANDLE, 2 * HANDLE, 2 * HANDLE); ctx.strokeRect(x - HANDLE, y - HANDLE, 2 * HANDLE, 2 * HANDLE); }
      ctx.beginPath(); ctx.arc(h.rot[0], h.rot[1], HANDLE, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }

  /** Nur geänderte Noppen neu zeichnen (samt Nachbarn, wegen 2×2-Formteilen). */
  patch(ctx, p, cell) {
    const L = this.last, { cols, rows } = p, n = cols * rows, dirty = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (p.grid[i] === L.grid[i] && p.overlay[i] === L.overlay[i] && p.overlayColor[i] === L.overlayColor[i] && p.shapes[i] === L.shapes[i]) continue;
      const x = i % cols, y = (i / cols) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) dirty[ny * cols + nx] = 1;
      }
    }
    for (let i = 0; i < n; i++) if (dirty[i]) {
      const x = (i % cols) * cell, y = ((i / cols) | 0) * cell, ov = p.overlay[i];
      ctx.clearRect(x, y, cell, cell);
      drawCell(ctx, x, y, cell, LEGO_COLORS[p.grid[i]].hex, ov ? 'square' : shapeOf(p, i));
    }
    for (let i = 0; i < n; i++) {
      const ov = p.overlay[i];
      if (!ov || ov === OVERLAY_COVERED) continue;
      const sz = overlaySize(ov);
      if (!(dirty[i] || (sz === 2 && (dirty[i + 1] || dirty[i + cols] || dirty[i + cols + 1])))) continue;
      drawOverlay(ctx, (i % cols) * cell, ((i / cols) | 0) * cell, cell * sz, LEGO_COLORS[p.overlayColor[i]].hex, ov);
    }
  }

  /** Umriss einer Form (Pfad in px). */
  outline(ctx, s, cell) {
    const a = (s.rot * Math.PI) / 180;
    ctx.save();
    ctx.translate(s.cx * cell, s.cy * cell); ctx.rotate(a);
    const w = (s.w * cell) / 2, h = (s.h * cell) / 2;
    ctx.beginPath();
    if (s.kind === 'ellipse') ctx.ellipse(0, 0, w, h, 0, 0, 2 * Math.PI);
    else if (s.kind === 'triangle') { ctx.moveTo(0, -h); ctx.lineTo(w, h); ctx.lineTo(-w, h); ctx.closePath(); }
    else if (s.kind === 'rtriangle') { ctx.moveTo(-w, -h); ctx.lineTo(w, h); ctx.lineTo(-w, h); ctx.closePath(); }
    else if (s.kind === 'half') { ctx.ellipse(0, h, w, 2 * h, 0, Math.PI, 2 * Math.PI); ctx.closePath(); }
    else ctx.rect(-w, -h, 2 * w, 2 * h);
    ctx.restore();
    ctx.stroke();
  }

  /** Griffe der Auswahl in px: Rahmenecken, Mitte oben, Drehgriff. Eine Form: gedrehter Rahmen. */
  handles() {
    const sel = this.selected(), cell = this.cell;
    let box, rotDir;
    if (sel.length === 1) {
      box = corners(sel[0]).map(([x, y]) => [x * cell, y * cell]);
      const a = (sel[0].rot * Math.PI) / 180;
      rotDir = [Math.sin(a), -Math.cos(a)];
    } else {
      const b = bounds(sel);
      box = [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]].map(([x, y]) => [x * cell, y * cell]);
      rotDir = [0, -1];
    }
    const topMid = [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2];
    return { box, topMid, rot: [topMid[0] + rotDir[0] * ROT_GAP, topMid[1] + rotDir[1] * ROT_GAP] };
  }

  // ---------- Zeiger ----------
  pos(e) {
    const r = this.canvas.getBoundingClientRect(), cell = this.cell;
    const px = ((e.clientX - r.left) * this.canvas.width) / r.width, py = ((e.clientY - r.top) * this.canvas.height) / r.height;
    return { px, py, x: px / cell, y: py / cell };
  }

  down(e) {
    const p = this.pos(e);
    this.canvas.setPointerCapture(e.pointerId);
    const start = this.items.map(s => ({ ...s }));
    if (this.selection.size) {
      const h = this.handles(), near = (q, r = HANDLE + 3) => Math.abs(q[0] - p.px) <= r && Math.abs(q[1] - p.py) <= r;
      if (near(h.rot)) { this.record(); this.drag = { mode: 'rotate', p, start, center: this.pivot() }; return; }
      const k = h.box.findIndex(q => near(q));
      if (k >= 0) { this.record(); this.drag = { mode: 'scale', p, start, corner: k, box: h.box }; return; }
    }
    const hit = hitTest(this.items, p.x, p.y);
    if (!hit) {
      if (!e.shiftKey) this.selection.clear();
      this.drag = null; this.redraw(); this.onSelect?.(); return;
    }
    const ids = hit.group ? this.items.filter(s => s.group === hit.group).map(s => s.id) : [hit.id];
    if (e.shiftKey) {
      const on = this.selection.has(hit.id);
      for (const id of ids) on ? this.selection.delete(id) : this.selection.add(id);
    } else if (!this.selection.has(hit.id)) this.selection = new Set(ids);
    this.record();
    this.drag = { mode: 'move', p, start, moved: false };
    this.redraw(); this.onSelect?.();
  }

  pivot() { const b = bounds(this.selected()); return [b.cx, b.cy]; }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const p = this.pos(e), byId = new Map(d.start.map(s => [s.id, s]));
    const sel = this.selected(), orig = sel.map(s => byId.get(s.id));
    if (d.mode === 'move') {
      let dx = p.x - d.p.x, dy = p.y - d.p.y;
      if (Math.abs(dx) + Math.abs(dy) > 0.05) d.moved = true;
      if (this.snap && sel.length > 1) { dx = Math.round(dx); dy = Math.round(dy); }
      sel.forEach((s, k) => { s.cx = orig[k].cx + dx; s.cy = orig[k].cy + dy; if (this.snap && sel.length === 1) snapShape(s); });
    } else if (d.mode === 'rotate') {
      const [cx, cy] = d.center;
      let da = ((Math.atan2(p.y - cy, p.x - cx) - Math.atan2(d.p.y - cy, d.p.x - cx)) * 180) / Math.PI;
      if (this.snap || e.shiftKey) da = Math.round(da / 15) * 15;
      this.rotateAll(sel, orig, da, d.center);
      if (this.snap && sel.length === 1) snapShape(sel[0]);
    } else if (d.mode === 'scale') {
      if (sel.length === 1) this.scaleOne(sel[0], orig[0], d.corner, p, e.shiftKey);
      else this.scaleMany(sel, orig, d, p);
    }
    this.onChange(false);
  }

  rotateAll(sel, orig, da, center = this.pivot()) {
    const [cx, cy] = center, a = (da * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a);
    sel.forEach((s, k) => {
      const dx = orig[k].cx - cx, dy = orig[k].cy - cy;
      s.cx = cx + dx * c - dy * n; s.cy = cy + dx * n + dy * c;
      s.rot = (((orig[k].rot + da) % 360) + 360) % 360;
    });
  }

  /** Eine Form an einer Ecke ziehen: gegenüberliegende Ecke bleibt im lokalen Rahmen stehen. */
  scaleOne(s, o, corner, p, keepAspect) {
    const sx = corner === 1 || corner === 2 ? 1 : -1, sy = corner >= 2 ? 1 : -1;
    const a = (o.rot * Math.PI) / 180, c = Math.cos(a), n = Math.sin(a);
    const dx = p.x - o.cx, dy = p.y - o.cy, lx = dx * c + dy * n, ly = -dx * n + dy * c;
    let w = Math.max(0.5, sx * lx + o.w / 2), h = Math.max(0.5, sy * ly + o.h / 2);
    if (keepAspect) { const f = Math.max(w / o.w, h / o.h); w = o.w * f; h = o.h * f; }
    if (this.snap) { w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); }
    // neue Mitte: gegenüberliegende Ecke + halbe neue Größe
    const ox = -sx * o.w / 2, oy = -sy * o.h / 2, mx = ox + sx * w / 2, my = oy + sy * h / 2;
    Object.assign(s, { w, h, cx: o.cx + mx * c - my * n, cy: o.cy + mx * n + my * c });
    if (this.snap) snapShape(s);
  }

  /** Mehrere Formen: gleichmäßig um die gegenüberliegende Rahmenecke skalieren. */
  scaleMany(sel, orig, d, p) {
    const cell = this.cell, opp = d.box[(d.corner + 2) % 4].map(v => v / cell), from = d.box[d.corner].map(v => v / cell);
    const d0 = Math.hypot(from[0] - opp[0], from[1] - opp[1]) || 1;
    const f = Math.max(0.1, ((p.x - opp[0]) * (from[0] - opp[0]) + (p.y - opp[1]) * (from[1] - opp[1])) / (d0 * d0));
    sel.forEach((s, k) => {
      s.cx = opp[0] + (orig[k].cx - opp[0]) * f; s.cy = opp[1] + (orig[k].cy - opp[1]) * f;
      s.w = orig[k].w * f; s.h = orig[k].h * f;
    });
  }

  up(e) {
    // ausstehende Bewegung noch anwenden (rAF kam nicht mehr dran)
    if (this.pendingMove) { const ev = this.pendingMove; this.pendingMove = null; this.move(ev); }
    const d = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture?.(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.mode === 'move' && !d.moved) { this.undoStack.pop(); return; }
    this.changed(true);
  }
}

export const colorOptions = (selected) => LEGO_COLORS
  .map(c => `<option value="${c.legoId}"${c.legoId === selected ? ' selected' : ''}>${c.de}</option>`).join('');
