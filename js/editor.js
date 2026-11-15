import { LEGO_COLORS } from './colors.js';
import { STUD_PARTS } from './parts.js';
import { drawCell, renderMosaic, drawSectionLines } from './render.js';
import { floodFill } from './mosaic.js';

const ZOOMS = [4, 6, 8, 10, 12, 16, 20, 24, 32, 40];
const MAX_CANVAS = 4096;

export class Editor {
  constructor({ canvas, viewport, onChange, onPick, onCursor, onHistory }) {
    this.canvas = canvas; this.viewport = viewport; this.ctx = canvas.getContext('2d');
    this.onChange = onChange; this.onPick = onPick; this.onCursor = onCursor; this.onHistory = onHistory;
    this.project = null; this.color = 1; this.tool = 'brush'; this.showGrid = true;
    this.zoomIdx = 5; this.undoStack = []; this.redoStack = []; this.stroke = null; this.panStart = null;
    this.spaceDown = false;
    canvas.addEventListener('pointerdown', e => this.down(e));
    canvas.addEventListener('pointermove', e => this.move(e));
    canvas.addEventListener('pointerup', e => this.up(e));
    canvas.addEventListener('pointercancel', e => this.up(e));
    canvas.addEventListener('pointerleave', () => this.onCursor?.(null));
    viewport.addEventListener('wheel', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      this.zoomBy(e.deltaY < 0 ? 1 : -1, e);
    }, { passive: false });
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !isTyping(e)) { this.spaceDown = true; this.viewport.classList.add('pan'); }
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'Space') { this.spaceDown = false; this.viewport.classList.toggle('pan', this.tool === 'pan'); }
    });
  }

  get cell() { return ZOOMS[this.zoomIdx]; }
  get zoomPercent() { return Math.round((this.cell / ZOOMS[5]) * 100); }

  setProject(project, { resetHistory = false } = {}) {
    this.project = project;
    if (resetHistory) { this.undoStack = []; this.redoStack = []; this.onHistory?.(); }
    // Zoom so wählen, dass die Leinwand nicht zu groß wird
    while (this.zoomIdx > 0 && project && Math.max(project.cols, project.rows) * this.cell > MAX_CANVAS) this.zoomIdx--;
    this.redrawAll();
  }

  setTool(tool) { this.tool = tool; this.viewport.classList.toggle('pan', tool === 'pan'); }
  setColor(ci) { this.color = ci; }
  setGrid(on) { this.showGrid = on; this.redrawAll(); }

  zoomBy(dir, e) {
    if (!this.project) return;
    const next = Math.min(ZOOMS.length - 1, Math.max(0, this.zoomIdx + dir));
    if (Math.max(this.project.cols, this.project.rows) * ZOOMS[next] > MAX_CANVAS) return;
    if (next === this.zoomIdx) return;
    const vp = this.viewport, old = this.cell;
    const rect = vp.getBoundingClientRect();
    const fx = e ? e.clientX - rect.left : vp.clientWidth / 2, fy = e ? e.clientY - rect.top : vp.clientHeight / 2;
    const cx = (vp.scrollLeft + fx - 24) / old, cy = (vp.scrollTop + fy - 24) / old;
    this.zoomIdx = next; this.redrawAll();
    vp.scrollLeft = cx * this.cell + 24 - fx; vp.scrollTop = cy * this.cell + 24 - fy;
  }

  redrawAll() {
    const p = this.project;
    if (!p) return;
    const c = this.cell;
    this.canvas.width = p.cols * c; this.canvas.height = p.rows * c;
    renderMosaic(this.ctx, p, c, STUD_PARTS[p.part].shape);
    if (this.showGrid) drawSectionLines(this.ctx, p.cols, p.rows, c);
    this.onChange?.('zoom');
  }

  drawCells(indices) {
    const p = this.project, c = this.cell, shape = STUD_PARTS[p.part].shape;
    for (const i of indices) {
      const x = i % p.cols, y = (i / p.cols) | 0;
      drawCell(this.ctx, x * c, y * c, c, LEGO_COLORS[p.grid[i]].hex, shape);
    }
    if (this.showGrid) drawSectionLines(this.ctx, p.cols, p.rows, c);
  }

  cellAt(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.project.cols);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.project.rows);
    if (x < 0 || y < 0 || x >= this.project.cols || y >= this.project.rows) return null;
    return { x, y, i: y * this.project.cols + x };
  }

  down(e) {
    if (!this.project) return;
    this.canvas.setPointerCapture(e.pointerId);
    if (this.tool === 'pan' || this.spaceDown || e.button === 1) {
      this.panStart = { x: e.clientX, y: e.clientY, sl: this.viewport.scrollLeft, st: this.viewport.scrollTop };
      return;
    }
    const cell = this.cellAt(e);
    if (!cell) return;
    if (this.tool === 'pick' || e.button === 2 || e.altKey) { this.onPick?.(this.project.grid[cell.i]); return; }
    if (this.tool === 'fill') {
      const before = this.project.grid[cell.i];
      const changed = floodFill(this.project.grid, this.project.cols, this.project.rows, cell.i, this.color);
      if (changed.length) this.commit(changed.map(i => ({ i, from: before, to: this.color })));
      this.drawCells(changed);
      return;
    }
    this.stroke = { changes: new Map(), last: cell };
    this.paint(cell);
  }

  move(e) {
    if (!this.project) return;
    if (this.panStart) {
      this.viewport.scrollLeft = this.panStart.sl - (e.clientX - this.panStart.x);
      this.viewport.scrollTop = this.panStart.st - (e.clientY - this.panStart.y);
      return;
    }
    const cell = this.cellAt(e);
    this.onCursor?.(cell);
    if (!this.stroke || !cell) return;
    // Linie zwischen letzter und aktueller Zelle füllen
    let { x: x0, y: y0 } = this.stroke.last;
    const { x: x1, y: y1 } = cell;
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.paint({ x: x0, y: y0, i: y0 * this.project.cols + x0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    this.stroke.last = cell;
  }

  paint(cell) {
    const g = this.project.grid;
    if (g[cell.i] === this.color) return;
    if (!this.stroke.changes.has(cell.i)) this.stroke.changes.set(cell.i, { i: cell.i, from: g[cell.i], to: this.color });
    g[cell.i] = this.color;
    this.drawCells([cell.i]);
  }

  up() {
    this.panStart = null;
    if (this.stroke) {
      const changes = [...this.stroke.changes.values()];
      this.stroke = null;
      if (changes.length) this.commit(changes);
    }
  }

  commit(changes) {
    this.undoStack.push(changes);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    this.onHistory?.();
    this.onChange?.('edit');
  }

  undo() { this.apply(this.undoStack, this.redoStack, 'from'); }
  redo() { this.apply(this.redoStack, this.undoStack, 'to'); }
  apply(src, dst, key) {
    const changes = src.pop();
    if (!changes) return;
    for (const ch of changes) this.project.grid[ch.i] = ch[key];
    dst.push(changes);
    this.drawCells(changes.map(c => c.i));
    this.onHistory?.();
    this.onChange?.('edit');
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
