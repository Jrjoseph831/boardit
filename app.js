'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36);
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif';
const X0 = 76;            // left edge of question text
const GRIP_W = 66;        // draggable gutter width
const PRESETS = [
  { id: 'plain', name: 'Plain', bg: '#ffffff', grid: false },
  { id: 'graph', name: 'Graph', bg: '#ffffff', grid: true },
  { id: 'dark', name: 'Inverted', bg: '#111214', grid: false },
  { id: 'darkgraph', name: 'Inverted graph', bg: '#111214', grid: true },
];
const PALETTE = [null, '#e5484d', '#2f6bff', '#2fa56b', '#f08c00', '#8e4ec6'];
const PEN_W = [2.5, 4.5, 8];
const ERASE_R = [10, 20, 34];
const ICON = {
  laser: '<circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/>',
  pen: '<path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  hl: '<path d="M14 5l5 5-8 8H6v-5z"/><path d="M4 21h9"/>',
  eraser: '<path d="M4.5 14.5l8-8a2 2 0 012.8 0l3.2 3.2a2 2 0 010 2.8L11 20H7.5z"/><path d="M9 11l5 5"/>',
  line: '<path d="M5 19L19 5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6"/>',
  undo: '<path d="M9 7L4 12l5 5"/><path d="M4 12h10a6 6 0 010 8h-3"/>',
  redo: '<path d="M15 7l5 5-5 5"/><path d="M20 12H10a6 6 0 000 8h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  addq: '<path d="M4 6h10M4 11h7"/><path d="M17 13v7M13.5 16.5h7"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  collapse: '<path d="M9 6l6 6-6 6"/>',
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 01-1 1h-4v-6H9v6H5a1 1 0 01-1-1z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5"/><path d="M5 19h14"/>',
};
const svg = (n, extra = '') => `<svg class="i" viewBox="0 0 24 24" ${extra} aria-hidden="true">${ICON[n]}</svg>`;

function lum(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex || '');
  if (!m) return 1;
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const isDark = bg => lum(bg) < 0.4;
const inkOf = b => b.ink || (isDark(b.bg) ? '#f3f3f1' : '#16181d');
const toast = (() => {
  let t;
  return msg => { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(t); t = setTimeout(() => (el.hidden = true), 3200); };
})();

/* ---------- storage ---------- */
const DEFAULTS = { bg: '#ffffff', grid: false, ink: null, gap: 460, size: 30 };
let meta = { settings: { ...DEFAULTS }, open: [], active: null };
try { Object.assign(meta, JSON.parse(localStorage.getItem('wb.meta') || '{}')); meta.settings = { ...DEFAULTS, ...meta.settings }; } catch (e) {}
const saveMeta = () => { try { localStorage.setItem('wb.meta', JSON.stringify(meta)); } catch (e) {} };

const dbp = new Promise(res => {
  try {
    const r = indexedDB.open('whiteboard', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('boards', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  } catch (e) { res(null); }
});
async function idb(mode, fn) {
  const db = await dbp; if (!db) return [];
  return new Promise(res => {
    const t = db.transaction('boards', mode); const out = fn(t.objectStore('boards'));
    t.oncomplete = () => res(out && out.result); t.onerror = () => res([]);
  });
}
const boards = new Map();
let cur = null;
const timers = new Map();
function plain(b) {
  return {
    id: b.id, name: b.name, created: b.created, updated: b.updated, bg: b.bg, grid: b.grid, ink: b.ink, size: b.size, wrapW: b.wrapW, scroll: b.scroll,
    items: b.items.map(i => ({ id: i.id, y: i.y, lines: i.lines, imgs: i.imgs })),
    strokes: b.strokes,
  };
}
function persist(b) {
  b.updated = Date.now();
  clearTimeout(timers.get(b.id));
  timers.set(b.id, setTimeout(() => idb('readwrite', s => s.put(plain(b))), 350));
}
function flush() { if (cur) { cur.scroll = scroller.scrollTop; idb('readwrite', s => s.put(plain(cur))); } }
addEventListener('visibilitychange', () => document.hidden && flush());
addEventListener('pagehide', flush);

function newBoard(name) {
  const s = meta.settings;
  const b = {
    id: uid(), name, created: Date.now(), updated: Date.now(), bg: s.bg, grid: s.grid, ink: s.ink, size: s.size,
    wrapW: Math.max(420, Math.min(1180, innerWidth - X0 - 150)), scroll: 0, items: [], strokes: [], undo: [], redo: [],
  };
  boards.set(b.id, b);
  return b;
}

/* ---------- canvas + state ---------- */
const scroller = $('#scroller'), spacer = $('#spacer'), cv = $('#cv'), ctx = cv.getContext('2d'), ed = $('#ed'), stage = $('#stage');
let dpr = 1, W = 0, H = 0;
const tool = { name: 'pen', color: null, size: 1 };
let mouse = { x: 0, y: 0, in: false };
let live = null;        // stroke being drawn
let erasing = null;     // { list } while erasing
let drag = null;        // question being dragged
let panning = null;
let hoverItem = null;
let editing = null;
let raf = 0;
const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

function sizeCanvas() {
  dpr = Math.max(1, devicePixelRatio || 1);
  const r = cv.getBoundingClientRect(); W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  if (cur) sync(); requestDraw();
}
new ResizeObserver(sizeCanvas).observe(stage);

/* text layout */
function wrapText(text, avail) {
  if (!text) return [''];
  const out = []; let line = '';
  for (const w of text.split(/(\s+)/)) {
    const test = line + w;
    if (line && ctx.measureText(test).width > avail && w.trim()) { out.push(line.trimEnd()); line = w.trimStart(); } else line = test;
  }
  out.push(line.trimEnd());
  return out;
}
const imgCache = new Map();
function getImg(src) {
  let i = imgCache.get(src);
  if (!i) { i = new Image(); i.onload = requestDraw; i.src = src; imgCache.set(src, i); }
  return i;
}
function metrics(b, it) {
  const key = b.size + '|' + b.wrapW + '|' + it.lines.map(l => l.ind + ':' + l.t).join('\n') + '|' + it.imgs.length;
  if (it._k === key) return it._m;
  const size = b.size, lh = Math.round(size * 1.42);
  ctx.font = `${size}px ${FONT}`;
  const rows = [];
  for (const ln of it.lines) {
    const x = ln.ind * Math.round(size * 1.4);
    wrapText(ln.t, b.wrapW - x).forEach(t => rows.push({ t, x }));
  }
  let h = rows.length * lh;
  const ims = [];
  for (const im of it.imgs) {
    const sc = Math.min(1, Math.min(b.wrapW, 720) / im.w, 380 / im.h);
    const w = im.w * sc, hh = im.h * sc;
    h += 12; ims.push({ src: im.src, y: h, w, h: hh }); h += hh;
  }
  it._k = key; it._m = { rows, lh, h: Math.max(h, lh), ims };
  return it._m;
}
const sortedItems = b => b.items.slice().sort((a, c) => a.y - c.y);
function contentBottom(b) {
  let m = 0;
  for (const it of b.items) m = Math.max(m, it.y + metrics(b, it).h + 200);
  for (const s of b.strokes) m = Math.max(m, s.bb[3] + 60);
  return m;
}
function sync() {
  if (!cur) return;
  spacer.style.height = Math.max(contentBottom(cur) + H * 1.1, H + 1) + 'px';
}

/* ---------- drawing ---------- */
function drawStroke(s, ink) {
  const p = s.pts;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const hl = s.t === 'hl';
  ctx.globalAlpha = hl ? 0.38 : 1;
  ctx.strokeStyle = ctx.fillStyle = s.c || (hl ? '#ffd60a' : ink);
  ctx.lineWidth = s.w;
  if (s.t === 'line') { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[2], p[3]); ctx.stroke(); }
  else if (s.t === 'rect') ctx.strokeRect(Math.min(p[0], p[2]), Math.min(p[1], p[3]), Math.abs(p[2] - p[0]), Math.abs(p[3] - p[1]));
  else if (s.t === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, Math.abs(p[2] - p[0]) / 2, Math.abs(p[3] - p[1]) / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (p.length <= 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) {
    ctx.beginPath(); ctx.arc(p[0], p[1], s.w / 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    ctx.lineTo(p[p.length - 2], p[p.length - 1]); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function drawGrid(b, st) {
  const ink = inkOf(b), step = 32, dk = isDark(b.bg);
  const rgb = dk ? '255,255,255' : '70,115,205';
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(${rgb},${pass ? (dk ? 0.17 : 0.34) : (dk ? 0.07 : 0.15)})`;
    ctx.lineWidth = 1;
    const first = Math.floor(st / step), last = Math.ceil((st + H) / step);
    for (let k = first; k <= last; k++) if ((k % 5 === 0) === !!pass) { const y = Math.round(k * step - st) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    for (let k = 0; k * step <= W; k++) if ((k % 5 === 0) === !!pass) { const x = k * step + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    ctx.stroke();
  }
  void ink;
}
function draw() {
  raf = 0;
  if (!cur) return;
  const b = cur, st = scroller.scrollTop, ink = inkOf(b);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = b.bg; ctx.fillRect(0, 0, W, H);
  if (b.grid) drawGrid(b, st);
  ctx.translate(0, -st);
  const lo = st - 60, hi = st + H + 60;
  ctx.textBaseline = 'middle'; ctx.fillStyle = ink;
  for (const it of b.items) {
    const m = metrics(b, it);
    if (it.y > hi || it.y + m.h < lo) continue;
    if (!it._edit) {
      ctx.font = `${b.size}px ${FONT}`; ctx.fillStyle = ink;
      m.rows.forEach((r, i) => ctx.fillText(r.t, X0 + r.x, it.y + i * m.lh + m.lh / 2));
    }
    for (const im of m.ims) { const img = getImg(im.src); if (img.complete && img.naturalWidth) ctx.drawImage(img, X0, it.y + im.y, im.w, im.h); }
    if (it === hoverItem || (drag && drag.it === it)) {
      ctx.fillStyle = inkOf(b); ctx.globalAlpha = drag && drag.it === it ? 0.6 : 0.3;
      const cy = it.y + m.lh / 2;
      for (let r = -1; r <= 1; r++) for (let c = 0; c < 2; c++) { ctx.beginPath(); ctx.arc(28 + c * 9, cy + r * 9, 2.2, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
  }
  for (const s of b.strokes) if (s.bb[3] >= lo && s.bb[1] <= hi) drawStroke(s, ink);
  if (live) drawStroke(live, ink);
  if (mouse.in && !drag && !panning) {
    const wy = mouse.y + st;
    if (tool.name === 'eraser') {
      ctx.strokeStyle = ink; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(mouse.x, wy, ERASE_R[tool.size], 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
    } else if (tool.name === 'laser') {
      const g = ctx.createRadialGradient(mouse.x, wy, 0, mouse.x, wy, 22);
      g.addColorStop(0, 'rgba(255,40,40,.95)'); g.addColorStop(0.3, 'rgba(255,40,40,.7)'); g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(mouse.x, wy, 22, 0, 7); ctx.fill();
    }
  }
}
scroller.addEventListener('scroll', () => { if (editing) placeEditor(); requestDraw(); });
cv.addEventListener('wheel', e => {
  e.preventDefault();
  scroller.scrollTop += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
}, { passive: false });

/* ---------- model ops (all undoable) ---------- */
const isStroke = o => !!o.pts;
function shiftObj(o, d) {
  if (isStroke(o)) { for (let i = 1; i < o.pts.length; i += 2) o.pts[i] += d; o.bb[1] += d; o.bb[3] += d; } else o.y += d;
}
const shiftAll = (refs, d) => refs.forEach(o => shiftObj(o, d));
const below = (b, y) => [...b.items.filter(i => i.y >= y), ...b.strokes.filter(s => s.pts[1] >= y)];
function bboxOf(s) {
  const p = s.pts; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
  const pad = s.w / 2 + 1; return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}
function setLines(it, lines) { it.lines = lines.map(l => ({ ...l })); it._k = null; }
function applyOp(b, op, dir) {
  const rm = (arr, o) => { const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1); };
  switch (op.k) {
    case 'add': dir > 0 ? b.strokes.push(op.s) : rm(b.strokes, op.s); break;
    case 'del': dir > 0 ? op.list.forEach(s => rm(b.strokes, s)) : b.strokes.push(...op.list); break;
    case 'shift': shiftAll(op.refs, dir * op.d); break;
    case 'edit': setLines(op.it, dir > 0 ? op.after : op.before); break;
    case 'addItem': dir > 0 ? b.items.push(op.it) : rm(b.items, op.it); break;
    case 'delItem': dir > 0 ? rm(b.items, op.it) : b.items.push(op.it); break;
  }
}
function commit(b, ops) {
  ops.forEach(op => applyOp(b, op, +1));
  b.undo.push(ops); if (b.undo.length > 400) b.undo.shift(); b.redo.length = 0;
  changed();
}
function undo() { const b = cur; if (!b || !b.undo.length) return; const e = b.undo.pop(); e.slice().reverse().forEach(op => applyOp(b, op, -1)); b.redo.push(e); changed(); }
function redo() { const b = cur; if (!b || !b.redo.length) return; const e = b.redo.pop(); e.forEach(op => applyOp(b, op, +1)); b.undo.push(e); changed(); }
function changed() { sync(); persist(cur); updateToolbarState(); requestDraw(); }

/* ---------- pointer interaction ---------- */
const toWorld = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top + scroller.scrollTop, cx: e.clientX, cy: e.clientY }; };
function itemAt(w, gutterOnly) {
  for (const it of cur.items) {
    const m = metrics(cur, it);
    if (w.y >= it.y && w.y <= it.y + m.h && (gutterOnly ? w.x < GRIP_W : w.x < X0 + cur.wrapW + 30)) return it;
  }
  return null;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function outline(s) {
  const p = s.pts;
  if (s.t === 'line') return p;
  if (s.t === 'rect') return [p[0], p[1], p[2], p[1], p[2], p[3], p[0], p[3], p[0], p[1]];
  if (s.t === 'ellipse') {
    const cx = (p[0] + p[2]) / 2, cy = (p[1] + p[3]) / 2, rx = Math.abs(p[2] - p[0]) / 2, ry = Math.abs(p[3] - p[1]) / 2, o = [];
    for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2; o.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry); }
    return o;
  }
  return p.length === 2 ? [p[0], p[1], p[0], p[1]] : p;
}
function eraseAt(x, y) {
  const r = ERASE_R[tool.size];
  for (const s of cur.strokes.slice()) {
    const bb = s.bb;
    if (x < bb[0] - r || x > bb[2] + r || y < bb[1] - r || y > bb[3] + r) continue;
    const o = outline(s); let hit = false;
    for (let i = 0; i + 3 < o.length && !hit; i += 2) hit = segDist(x, y, o[i], o[i + 1], o[i + 2], o[i + 3]) <= r + s.w / 2;
    if (hit) { cur.strokes.splice(cur.strokes.indexOf(s), 1); erasing.list.push(s); }
  }
}

cv.addEventListener('pointerdown', e => {
  if (!cur) return;
  if (editing) { closeEditor(); }
  const w = toWorld(e);
  cv.setPointerCapture(e.pointerId);
  if (e.button === 1) { panning = { cy: e.clientY, st: scroller.scrollTop }; e.preventDefault(); return; }
  if (e.button !== 0) return;
  if (w.x < GRIP_W) {
    const it = itemAt(w, true);
    if (it) { startDrag(it, w); return; }
  }
  const t = tool.name;
  if (t === 'laser') { mouse = { x: w.x, y: e.clientY - cv.getBoundingClientRect().top, in: true }; requestDraw(); return; }
  if (t === 'eraser') { erasing = { list: [] }; eraseAt(w.x, w.y); requestDraw(); return; }
  const wd = t === 'hl' ? PEN_W[tool.size] * 4.5 : PEN_W[tool.size];
  live = { id: uid(), t: t === 'hl' ? 'hl' : t, c: tool.color, w: wd, pts: (t === 'pen' || t === 'hl') ? [w.x, w.y] : [w.x, w.y, w.x, w.y] };
  requestDraw();
});
cv.addEventListener('pointermove', e => {
  if (!cur) return;
  const r = cv.getBoundingClientRect();
  mouse = { x: e.clientX - r.left, y: e.clientY - r.top, in: true };
  if (panning) { scroller.scrollTop = panning.st - (e.clientY - panning.cy); return; }
  if (drag) { drag.cy = e.clientY; return; }
  const w = toWorld(e);
  if (live) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (live.t === 'pen' || live.t === 'hl') for (const ev of (evs.length ? evs : [e])) { const q = toWorld(ev); live.pts.push(q.x, q.y); }
    else {
      let { x, y } = w;
      if (live.t === 'line' && e.shiftKey) {
        const dx = x - live.pts[0], dy = y - live.pts[1], a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12), l = Math.hypot(dx, dy);
        x = live.pts[0] + Math.cos(a) * l; y = live.pts[1] + Math.sin(a) * l;
      } else if (live.t !== 'line' && e.shiftKey) {
        const s = Math.max(Math.abs(x - live.pts[0]), Math.abs(y - live.pts[1]));
        x = live.pts[0] + Math.sign(x - live.pts[0] || 1) * s; y = live.pts[1] + Math.sign(y - live.pts[1] || 1) * s;
      }
      live.pts[2] = x; live.pts[3] = y;
    }
  } else if (erasing && (e.buttons & 1)) eraseAt(w.x, w.y);
  else {
    const hit = w.x < GRIP_W ? itemAt(w, true) : null;
    const hv = hit || (w.x < X0 + cur.wrapW + 30 ? itemAt(w) : null);
    if (hv !== hoverItem) { hoverItem = hv; }
    cv.style.cursor = hit ? 'grab' : (tool.name === 'eraser' || tool.name === 'laser') ? 'none' : 'crosshair';
  }
  requestDraw();
});
const endPointer = e => {
  if (panning) { panning = null; return; }
  if (drag) { endDrag(); return; }
  if (live) {
    const s = live;
    live = null;
    s.bb = bboxOf(s);
    if (s.pts.length > 4 && (s.t === 'pen' || s.t === 'hl')) simplify(s);
    commit(cur, [{ k: 'add', s }]);
  }
  if (erasing) { const l = erasing.list; erasing = null; if (l.length) { l.forEach(s => cur.strokes.push(s)); commit(cur, [{ k: 'del', list: l }]); } }
  requestDraw();
};
function simplify(s) { // drop near-duplicate points to keep saves small
  const p = s.pts, out = [p[0], p[1]];
  for (let i = 2; i < p.length - 2; i += 2) if (Math.hypot(p[i] - out[out.length - 2], p[i + 1] - out[out.length - 1]) >= 0.8) out.push(p[i], p[i + 1]);
  out.push(p[p.length - 2], p[p.length - 1]); s.pts = out;
}
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', endPointer);
cv.addEventListener('pointerleave', () => { mouse.in = false; hoverItem = null; requestDraw(); });
cv.addEventListener('dblclick', e => {
  if (!cur) return;
  const it = itemAt(toWorld(e));
  if (it) openEditor(it);
});
cv.addEventListener('contextmenu', e => e.preventDefault());

/* ---------- dragging a question (pushes everything below it) ---------- */
function startDrag(it, w) {
  const items = sortedItems(cur), idx = items.indexOf(it), prev = items[idx - 1];
  const minD = prev ? prev.y + metrics(cur, prev).h + 24 - it.y : 24 - it.y;
  drag = { it, refs: below(cur, it.y - 0.5), applied: 0, minD, startWy: w.y, cy: w.cy };
  cv.style.cursor = 'grabbing';
  requestAnimationFrame(dragTick);
}
function dragTick() {
  if (!drag) return;
  applyDrag(true);
  requestAnimationFrame(dragTick);
}
function applyDrag(scrollEdges) {
  const r = cv.getBoundingClientRect(), edge = 80;
  if (!scrollEdges) { /* final apply on release: no autoscroll */ }
  else if (drag.cy > r.bottom - edge) scroller.scrollTop += Math.min(30, (drag.cy - (r.bottom - edge)) / 2.5 + 2);
  else if (drag.cy < r.top + edge) scroller.scrollTop -= Math.min(30, (r.top + edge - drag.cy) / 2.5 + 2);
  const wy = drag.cy - r.top + scroller.scrollTop;
  const d = Math.max(drag.minD, Math.round(wy - drag.startWy));
  if (d !== drag.applied) { shiftAll(drag.refs, d - drag.applied); drag.applied = d; sync(); }
  draw();
}
function endDrag() {
  applyDrag(false);
  const d = drag; drag = null; cv.style.cursor = 'crosshair';
  if (d.applied) { cur.undo.push([{ k: 'shift', refs: d.refs, d: d.applied }]); cur.redo.length = 0; changed(); }
  requestDraw();
}

/* ---------- text editing ---------- */
function openEditor(it, fresh) {
  closeEditor();
  const b = cur, lines = it.lines;
  editing = { it, fresh: !!fresh, before: lines.map(l => ({ ...l })), oldH: metrics(b, it).h };
  it._edit = true;
  ed.hidden = false;
  ed.value = lines.map(l => '  '.repeat(l.ind) + l.t).join('\n');
  placeEditor();
  ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length);
  requestDraw();
}
function placeEditor() {
  if (!editing) return;
  const b = cur, it = editing.it, lh = Math.round(b.size * 1.42);
  Object.assign(ed.style, {
    left: X0 + 'px', top: (it.y - scroller.scrollTop) + 'px', width: b.wrapW + 'px',
    font: `${b.size}px/${lh}px ${FONT}`, color: inkOf(b),
  });
  ed.style.height = 'auto'; ed.style.height = Math.max(lh, ed.scrollHeight) + 'px';
}
ed.addEventListener('input', placeEditor);
ed.addEventListener('keydown', e => {
  e.stopPropagation();
  if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeEditor(); }
});
ed.addEventListener('blur', () => closeEditor());
function closeEditor() {
  if (!editing) return;
  const { it, before, oldH, fresh } = editing; editing = null;
  const b = cur;
  const after = ed.value.split('\n').filter(l => l.trim()).map(l => {
    const sp = /^ */.exec(l)[0].length; return { t: l.trim(), ind: Math.min(3, Math.floor(sp / 2)) };
  });
  ed.hidden = true; it._edit = false;
  const same = JSON.stringify(after) === JSON.stringify(before);
  if (!after.length) {
    if (fresh) { b.items.splice(b.items.indexOf(it), 1); changed(); return; }
    deleteItem(it, oldH); return;
  }
  if (fresh) { b.items.splice(b.items.indexOf(it), 1); setLines(it, after); commit(b, [{ k: 'addItem', it }]); return; }
  if (same) { requestDraw(); return; }
  const ops = [{ k: 'edit', it, before, after }];
  setLines(it, after);
  const d = metrics(b, it).h - oldH;
  setLines(it, before); // restore so commit() applies the edit through the op
  if (d) ops.push({ k: 'shift', refs: below(b, it.y + oldH - 0.5).filter(o => o !== it), d });
  commit(b, ops);
}
function deleteItem(it, h) {
  const b = cur, items = sortedItems(b), next = items[items.indexOf(it) + 1];
  const ops = [];
  const top = it.y, bottom = next ? next.y : Infinity;
  const gone = b.strokes.filter(s => s.pts[1] >= top && s.pts[1] < bottom);
  if (gone.length) ops.push({ k: 'del', list: gone });
  ops.push({ k: 'delItem', it });
  if (next) ops.push({ k: 'shift', refs: below(b, next.y - 0.5), d: -(next.y - it.y) });
  void h;
  commit(b, ops);
}
function addQuestion() {
  const b = cur; if (!b) return;
  const items = sortedItems(b), last = items[items.length - 1];
  let y = 70;
  if (last) y = last.y + metrics(b, last).h + meta.settings.gap;
  for (const s of b.strokes) y = Math.max(y, s.bb[3] + 70);
  const it = { id: uid(), y, lines: [], imgs: [] };
  b.items.push(it);
  sync();
  scroller.scrollTop = Math.max(0, y - H * 0.3);
  openEditor(it, true);
}

/* ---------- Word import ---------- */
const QRE = /^\s*(?:(?:question|problem|exercise|prob|q)\s*\.?\s*#?\s*\d{1,3}\b[.):\-–]?|\d{1,3}[.)](?=\s|$)|\(\d{1,3}\)(?=\s))/i;
const SUBRE = /^\s*(?:\(?[a-z]\)|\(?[ivx]{1,4}\)|[a-z]\.(?=\s)|[•\-–*]\s)/i;
function parseHtml(html, mode) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = []; let cur_ = null, qCount = 0, listN = 0;
  const mk = (t, ind = 0, extra = {}) => { cur_ = { lines: t ? [{ t, ind }] : [], imgs: [], ...extra }; items.push(cur_); return cur_; };
  const add = (t, ind) => { if (!t) return; if (!cur_) mk(t, ind); else cur_.lines.push({ t, ind }); };
  const textOf = el => { const c = el.cloneNode(true); c.querySelectorAll('ul,ol,img,table').forEach(n => n.remove()); return c.textContent.replace(/\s+/g, ' ').trim(); };
  const addImgs = el => { const im = [...el.querySelectorAll('img')].map(i => i.src); if (!im.length) return; if (!cur_) mk(''); cur_.imgs.push(...im.map(src => ({ src }))); };
  function nested(li, depth) {
    for (const sub of li.children) {
      if (sub.tagName !== 'OL' && sub.tagName !== 'UL') continue;
      let n = 0;
      for (const l of sub.children) {
        if (l.tagName !== 'LI') continue;
        const mark = sub.tagName === 'OL' ? String.fromCharCode(97 + (n++ % 26)) + ')' : '•';
        add(`${mark} ${textOf(l)}`, depth);
        addImgs(l); nested(l, depth + 1);
      }
    }
  }
  function list(el) {
    const ordered = el.tagName === 'OL';
    const asQuestions = mode === 'para' || (ordered && !(cur_ && cur_.typed));
    let n = 0;
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const t = textOf(li);
      if (asQuestions) {
        if (mode !== 'para') { listN++; qCount++; }
        mk(ordered && mode !== 'para' ? `${listN}. ${t}` : t, 0, { typed: false });
      } else if (ordered) add(`${String.fromCharCode(97 + (n++ % 26))}) ${t}`, 1);
      else add(`• ${t}`, 1);
      addImgs(li); nested(li, 1);
    }
  }
  function block(el) {
    const tag = el.tagName;
    if (tag === 'UL' || tag === 'OL') return list(el);
    if (tag === 'TABLE') {
      el.querySelectorAll('tr').forEach(tr => add([...tr.children].map(c => c.textContent.trim()).join('   |   '), 0));
      return;
    }
    if (tag === 'DIV' || tag === 'SECTION') { [...el.children].forEach(block); return; }
    const t = textOf(el);
    if (mode === 'para') { if (t) mk(t); addImgs(el); return; }
    if (t) {
      if (QRE.test(t)) { qCount++; mk(t, 0, { typed: true }); }
      else if (cur_ && SUBRE.test(t)) add(t, 1);
      else add(t, 0);
    }
    addImgs(el);
  }
  [...doc.body.children].forEach(block);
  return { items: items.filter(i => i.lines.length || i.imgs.length), qCount };
}
const imgSize = src => new Promise(res => { const i = new Image(); i.onload = () => res({ src, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => res(null); i.src = src; });
/* Legacy .doc (binary Word 97-2003): read the piece table out of the OLE container */
function docToText(buf) {
  const cfb = CFB.read(new Uint8Array(buf), { type: 'array' });
  const wd = CFB.find(cfb, '/WordDocument'); if (!wd) throw new Error('not a Word file');
  const d = new DataView(wd.content.buffer, wd.content.byteOffset, wd.content.byteLength);
  if (d.getUint16(0, true) !== 0xA5EC) throw new Error('bad FIB');
  const tbl = CFB.find(cfb, (d.getUint16(0x0A, true) & 0x0200) ? '/1Table' : '/0Table');
  if (!tbl) throw new Error('no table stream');
  const t = new DataView(tbl.content.buffer, tbl.content.byteOffset, tbl.content.byteLength);
  const ccpText = d.getInt32(0x4C, true), fcClx = d.getUint32(0x1A2, true);
  let p = fcClx;
  while (t.getUint8(p) === 1) p += 3 + t.getUint16(p + 1, true);   // skip Prc entries
  if (t.getUint8(p) !== 2) throw new Error('no piece table');
  const lcb = t.getUint32(p + 1, true), n = (lcb - 4) / 12, cp0 = p + 5, pcd0 = cp0 + (n + 1) * 4;
  let out = '';
  for (let i = 0; i < n; i++) {
    const cs = t.getInt32(cp0 + i * 4, true), ce = Math.min(t.getInt32(cp0 + (i + 1) * 4, true), ccpText);
    if (ce <= cs) continue;
    let fc = t.getUint32(pcd0 + i * 8 + 2, true); const comp = !!(fc & 0x40000000); fc &= 0x3FFFFFFF;
    const len = ce - cs, bytes = wd.content;
    if (comp) { fc = Math.floor(fc / 2); out += new TextDecoder('windows-1252').decode(bytes.subarray(fc, fc + len)); }
    else out += new TextDecoder('utf-16le').decode(bytes.subarray(fc, fc + len * 2));
  }
  out = out.replace(/\x13[^\x14\x15]*\x14/g, '').replace(/[\x13\x15]/g, '')   // keep field results, drop field codes
    .replace(/\x07/g, '   ').replace(/\x0B/g, '\r').replace(/[\x00-\x08\x0C\x0E-\x1F]/g, '');
  return out;
}
function rtfToText(src) {
  const skip = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'footnote', 'themedata', 'colorschememapping', 'datastore', 'latentstyles', 'listtable', 'listoverridetable', 'rsidtbl', 'generator']);
  let out = '', depth = 0, skipDepth = 0, uc = 1, i = 0;
  const stack = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { stack.push(uc); depth++; i++; }
    else if (c === '}') { if (skipDepth && depth === skipDepth) skipDepth = 0; depth--; uc = stack.pop() ?? 1; i++; }
    else if (c === '\\') {
      const m = /^\\([a-zA-Z]+)(-?\d+)? ?/.exec(src.slice(i, i + 40));
      if (m) {
        i += m[0].length; const w = m[1], n = m[2] === undefined ? null : +m[2];
        if (skipDepth) continue;
        if (w === 'par' || w === 'line' || w === 'sect') out += '\r';
        else if (w === 'tab') out += '\t';
        else if (w === 'u' && n !== null) { out += String.fromCharCode(n < 0 ? n + 65536 : n); i += uc; }
        else if (w === 'uc' && n !== null) uc = n;
        else if (w === 'bullet') out += '•';
        else if (w === 'endash') out += '–'; else if (w === 'emdash') out += '—';
        else if (w === 'lquote' || w === 'rquote') out += '’'; else if (w === 'ldblquote' || w === 'rdblquote') out += '”';
        else if (skip.has(w)) skipDepth = depth;
      } else {
        const nx = src[i + 1];
        if (nx === "'") { if (!skipDepth) out += String.fromCharCode(parseInt(src.substr(i + 2, 2), 16)); i += 4; }
        else if (nx === '*') { if (!skipDepth) skipDepth = depth; i += 2; }
        else { if (!skipDepth && (nx === '\\' || nx === '{' || nx === '}')) out += nx; i += 2; }
      }
    } else { if (!skipDepth && c !== '\n' && c !== '\r') out += c; i++; }
  }
  return out;
}
const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const textToHtml = t => t.split(/\r|\n/).map(l => l.trim()).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('');
/* Any Word-ish file in, HTML out. Detects the real format from the bytes, not the extension. */
async function wordToHtml(file) {
  const buf = await file.arrayBuffer(), h = new Uint8Array(buf, 0, 8);
  if (h[0] === 0x50 && h[1] === 0x4B) return (await mammoth.convertToHtml({ arrayBuffer: buf })).value;
  if (h[0] === 0xD0 && h[1] === 0xCF) {
    if (!window.CFB) throw new Error('reader not loaded');
    return textToHtml(docToText(buf));
  }
  const txt = new TextDecoder().decode(buf);
  if (txt.trimStart().startsWith('{\\rtf')) return textToHtml(rtfToText(txt));
  if (/<html|<body|<p[ >]/i.test(txt.slice(0, 4000))) return txt;   // Word "web page" saves
  throw new Error('unsupported');
}
async function importDocx(file) {
  if (!window.mammoth) { toast('The Word reader didn’t load. Check your connection and reload.'); return; }
  try {
    const html = await wordToHtml(file);
    let r = parseHtml(html, 'auto');
    if (!r.qCount) r = parseHtml(html, 'para');
    if (!r.items.length) { toast('No text found in that document.'); return; }
    const b = newBoard(file.name.replace(/\.(docx|docm|dotx|dotm|doc|dot|rtf|html?)$/i, ''));
    let y = 70; const gap = meta.settings.gap;
    for (const [i, raw] of r.items.entries()) {
      const imgs = (await Promise.all(raw.imgs.map(im => imgSize(im.src)))).filter(Boolean);
      const it = { id: uid(), y: 0, lines: raw.lines, imgs };
      const pre = i === 0 && !QRE.test(raw.lines[0] ? raw.lines[0].t : '') && r.qCount > 0 && raw.typed !== false;
      it.y = y; b.items.push(it);
      y += metrics(b, it).h + (pre ? 130 : gap);
    }
    openBoard(b);
    persist(b);
  } catch (err) { console.error(err); toast('Couldn’t read that file. It needs to be a Word document (.docx, .doc, .rtf).'); }
}

/* ---------- tabs / navigation ---------- */
function openBoard(b) {
  if (cur) { cur.scroll = scroller.scrollTop; persist(cur); }
  if (!meta.open.includes(b.id)) meta.open.push(b.id);
  showBoard(b);
}
function showBoard(b) {
  closeEditor();
  cur = b; meta.active = b ? b.id : null; saveMeta();
  $('#home').hidden = !!b; stage.hidden = !b;
  document.body.classList.remove('collapsed');
  applyTheme();
  if (b) {
    requestAnimationFrame(() => { sizeCanvas(); sync(); scroller.scrollTop = b.scroll || 0; requestDraw(); updateToolbarState(); });
  } else renderHome();
  renderTabs();
}
function applyTheme() {
  const dark = cur ? isDark(cur.bg) : false;
  document.documentElement.dataset.ui = dark ? 'dark' : 'light';
  document.body.style.background = cur ? '' : '';
}
function closeTab(id) {
  const i = meta.open.indexOf(id); if (i < 0) return;
  meta.open.splice(i, 1);
  if (cur && cur.id === id) {
    cur.scroll = scroller.scrollTop; idb('readwrite', s => s.put(plain(cur)));
    const nextId = meta.open[Math.min(i, meta.open.length - 1)];
    showBoard(nextId ? boards.get(nextId) : null);
  } else { saveMeta(); renderTabs(); }
}
function renderTabs() {
  const nav = $('#tabs'); nav.innerHTML = '';
  const home = document.createElement('button');
  home.className = 'tabs-btn' + (!cur ? ' on' : ''); home.title = 'Home'; home.innerHTML = svg('home');
  home.onclick = () => { if (cur) { cur.scroll = scroller.scrollTop; flush(); } showBoard(null); };
  nav.append(home);
  const sp = document.createElement('div'); sp.className = 'tabs-sp'; nav.append(sp);
  for (const id of meta.open) {
    const b = boards.get(id); if (!b) continue;
    const t = document.createElement('div'); t.className = 'tab' + (cur && cur.id === id ? ' on' : ''); t.tabIndex = 0;
    t.innerHTML = `<span class="nm"></span><button class="x" title="Close" aria-label="Close tab">${svg('x')}</button>`;
    const nm = $('.nm', t); nm.textContent = b.name;
    t.onclick = e => { if (e.target.closest('.x') || nm.isContentEditable) return; if (!cur || cur.id !== id) { if (cur) { cur.scroll = scroller.scrollTop; flush(); } showBoard(b); } };
    t.onkeydown = e => { if (e.key === 'Enter' && !nm.isContentEditable) t.click(); };
    $('.x', t).onclick = () => closeTab(id);
    nm.ondblclick = () => {
      nm.contentEditable = 'true'; nm.focus(); getSelection().selectAllChildren(nm);
      const done = () => { nm.contentEditable = 'false'; b.name = nm.textContent.trim() || b.name; nm.textContent = b.name; persist(b); };
      nm.onblur = done; nm.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); nm.blur(); } };
    };
    nav.append(t);
  }
  const add = document.createElement('button'); add.className = 'tabs-btn'; add.title = 'New board'; add.innerHTML = svg('plus');
  add.onclick = e => { e.stopPropagation(); newMenu(add); };
  nav.append(add);
}
function newMenu(anchor) {
  document.querySelectorAll('.pop').forEach(p => p.remove());
  const p = document.createElement('div'); p.className = 'pop';
  p.innerHTML = `<button data-a="blank">${svg('plus')}Blank board</button><button data-a="doc">${svg('doc')}From a Word document…</button>`;
  document.body.append(p);
  const r = anchor.getBoundingClientRect();
  p.style.left = Math.min(r.left, innerWidth - 230) + 'px'; p.style.bottom = (innerHeight - r.top + 6) + 'px';
  p.onclick = e => { const a = e.target.closest('button'); if (!a) return; p.remove(); a.dataset.a === 'blank' ? blankBoard() : $('#file').click(); };
  setTimeout(() => addEventListener('click', () => p.remove(), { once: true }), 0);
}
function blankBoard() {
  let n = 1; const names = new Set([...boards.values()].map(b => b.name)); while (names.has('Board ' + n)) n++;
  const b = newBoard('Board ' + n); openBoard(b); persist(b);
}
$('#file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importDocx(f); };
addEventListener('click', () => document.querySelectorAll('.pop').forEach(p => p.remove()));

/* ---------- home ---------- */
function renderHome() {
  const home = $('#home');
  const list = [...boards.values()].sort((a, b) => b.updated - a.updated);
  home.innerHTML = `
    <button class="home-gear" title="Default background and spacing" aria-label="Settings">${svg('sliders')}</button>
    <div class="home-in">
      <div class="start">
        <button class="drop" id="drop">${svg('upload')}<b>Open a Word document</b><span>Drop a Word file here. Each question gets its own writing space.</span></button>
        <button class="blank" id="blank"><b>Blank board</b><span>Start writing</span></button>
      </div>
      <div class="saved"><h2>Saved</h2><div id="rows"></div></div>
    </div>`;
  $('.home-gear', home).onclick = () => openSettings(null);
  $('#blank').onclick = blankBoard;
  const drop = $('#drop');
  drop.onclick = () => $('#file').click();
  const rows = $('#rows');
  if (!list.length) rows.innerHTML = '<div class="empty">Nothing yet.</div>';
  for (const b of list) {
    const r = document.createElement('div'); r.className = 'row'; r.tabIndex = 0; r.setAttribute('role', 'button');
    const n = b.items.length;
    r.innerHTML = `<i class="sm" style="background:${b.bg}"></i><div class="t"><b></b><span>${n ? n + (n === 1 ? ' question' : ' questions') + ' · ' : ''}${new Date(b.updated).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div><button class="del" title="Delete" aria-label="Delete">${svg('trash')}</button>`;
    $('b', r).textContent = b.name;
    r.onclick = e => { if (e.target.closest('.del')) return; openBoard(b); };
    r.onkeydown = e => { if (e.key === 'Enter' && e.target === r) openBoard(b); };
    $('.del', r).onclick = () => {
      if (!confirm(`Delete “${b.name}”? This can’t be undone.`)) return;
      boards.delete(b.id); meta.open = meta.open.filter(x => x !== b.id); saveMeta(); idb('readwrite', s => s.delete(b.id)); renderHome(); renderTabs();
    };
    rows.append(r);
  }
}
['dragenter', 'dragover'].forEach(ev => addEventListener(ev, e => { if (!cur && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); const d = $('#drop'); d && d.classList.add('over'); } }));
['dragleave', 'drop'].forEach(ev => addEventListener(ev, e => { const d = $('#drop'); d && d.classList.remove('over'); }));
addEventListener('drop', e => { if (e.dataTransfer && e.dataTransfer.files[0]) { e.preventDefault(); importDocx(e.dataTransfer.files[0]); } });
addEventListener('dragover', e => e.preventDefault());

/* ---------- settings ---------- */
function openSettings(board) {
  const target = board || meta.settings;
  const modal = $('#modal'); modal.hidden = false;
  const dk = isDark(target.bg);
  const sub = board ? 'Applies to this board.' : 'Defaults for new boards.';
  modal.innerHTML = `<div class="card" role="dialog" aria-label="Settings"><h3>${board ? 'Board' : 'Defaults'}</h3><p class="sub">${sub}</p>
    <div class="lbl">Background</div><div class="presets"></div>
    <div class="lbl">Custom</div>
    <div class="line"><span>Color</span><input type="color" id="cbg" value="${target.bg}"></div>
    <div class="line"><label class="chk"><input type="checkbox" id="cgrid" ${target.grid ? 'checked' : ''}>Graph paper</label></div>
    <div class="line"><span>Writing color</span><span><button class="mini" id="cauto">Auto</button><input type="color" id="cink" value="${target.ink || (dk ? '#f3f3f1' : '#16181d')}"></span></div>
    ${board ? '' : `<div class="lbl">Questions</div>
    <div class="line"><span>Writing space</span><input type="range" id="cgap" min="160" max="1000" step="20" value="${meta.settings.gap}"><span class="val" id="vgap">${meta.settings.gap}</span></div>
    <div class="line"><span>Text size</span><input type="range" id="csize" min="20" max="48" step="2" value="${meta.settings.size}"><span class="val" id="vsize">${meta.settings.size}</span></div>`}
    <button class="done">Done</button></div>`;
  const apply = () => { if (board) { persist(board); applyTheme(); requestDraw(); renderTabs(); } else { saveMeta(); } };
  const pres = $('.presets', modal);
  const mark = () => pres.querySelectorAll('.pre').forEach((el, i) => el.setAttribute('aria-pressed', String(PRESETS[i].bg === target.bg && PRESETS[i].grid === target.grid)));
  PRESETS.forEach(p => {
    const el = document.createElement('button'); el.className = 'pre';
    const dkp = isDark(p.bg), line = dkp ? 'rgba(255,255,255,.18)' : 'rgba(70,115,205,.3)';
    el.innerHTML = `<div class="pv" style="background:${p.bg};${p.grid ? `background-image:linear-gradient(${line} 1px,transparent 1px),linear-gradient(90deg,${line} 1px,transparent 1px);background-size:9px 9px` : ''}"></div>${p.name}`;
    el.onclick = () => { target.bg = p.bg; target.grid = p.grid; $('#cbg').value = p.bg; $('#cgrid').checked = p.grid; mark(); apply(); };
    pres.append(el);
  });
  mark();
  $('#cbg', modal).oninput = e => { target.bg = e.target.value; mark(); apply(); };
  $('#cgrid', modal).onchange = e => { target.grid = e.target.checked; mark(); apply(); };
  $('#cink', modal).oninput = e => { target.ink = e.target.value; apply(); };
  $('#cauto', modal).onclick = () => { target.ink = null; apply(); };
  if (!board) {
    $('#cgap', modal).oninput = e => { meta.settings.gap = +e.target.value; $('#vgap').textContent = e.target.value; saveMeta(); };
    $('#csize', modal).oninput = e => { meta.settings.size = +e.target.value; $('#vsize').textContent = e.target.value; saveMeta(); };
  }
  const close = () => { modal.hidden = true; modal.innerHTML = ''; saveMeta(); if (!board) renderHome(); };
  $('.done', modal).onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); };
  $('.done', modal).focus();
}
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) $('#modal .done').click(); });

/* ---------- toolbar ---------- */
const TOOLS = [['laser', 'Pointer (L)'], ['pen', 'Pen (P)'], ['hl', 'Highlighter (H)'], ['eraser', 'Eraser (E)'], ['line', 'Line'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']];
function buildToolbar() {
  const tb = $('#toolbar'); tb.innerHTML = '';
  const grp = () => { const g = document.createElement('div'); g.className = 'grp'; tb.append(g); return g; };
  const btn = (g, name, title, fn, cls = 'tb') => { const b = document.createElement('button'); b.className = cls; b.title = title; b.setAttribute('aria-label', title); b.innerHTML = svg(name); b.onclick = fn; g.append(b); return b; };
  let g = grp();
  btn(g, 'collapse', 'Hide toolbar (F)', () => setCollapsed(true), 'tb wide');
  g = grp();
  TOOLS.forEach(([n, t]) => { const b = btn(g, n, t, () => { tool.name = n; updateToolbarState(); cv.style.cursor = n === 'eraser' || n === 'laser' ? 'none' : 'crosshair'; }); b.dataset.tool = n; });
  g = grp();
  PALETTE.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'sw'; b.dataset.i = i; b.title = c ? 'Color' : 'Default ink'; b.setAttribute('aria-label', b.title);
    b.innerHTML = '<i></i>'; b.onclick = () => { tool.color = c; if (tool.name === 'eraser' || tool.name === 'laser') tool.name = 'pen'; updateToolbarState(); }; g.append(b);
  });
  const cu = document.createElement('label'); cu.className = 'sw custom'; cu.title = 'Custom color';
  cu.innerHTML = '<i></i><input type="color" value="#e5484d" aria-label="Custom color">';
  $('input', cu).oninput = e => { tool.color = e.target.value; if (tool.name === 'eraser' || tool.name === 'laser') tool.name = 'pen'; updateToolbarState(); };
  g.append(cu);
  g = grp();
  [6, 10, 15].forEach((d, i) => { const b = document.createElement('button'); b.className = 'tb sz'; b.dataset.s = i; b.title = ['Thin', 'Medium', 'Thick'][i]; b.setAttribute('aria-label', b.title); b.innerHTML = `<i style="width:${d}px;height:${d}px"></i>`; b.onclick = () => { tool.size = i; updateToolbarState(); }; g.append(b); });
  g = grp();
  btn(g, 'undo', 'Undo (Ctrl+Z)', undo).id = 'bUndo';
  btn(g, 'redo', 'Redo (Ctrl+Y)', redo).id = 'bRedo';
  btn(g, 'addq', 'Add a question', addQuestion);
  btn(g, 'sliders', 'Background', () => cur && openSettings(cur));
}
function updateToolbarState() {
  const tb = $('#toolbar');
  tb.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === tool.name)));
  tb.querySelectorAll('.sz').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.s === tool.size)));
  const ink = cur ? inkOf(cur) : '#000';
  tb.querySelectorAll('.sw:not(.custom)').forEach(b => {
    const c = PALETTE[+b.dataset.i]; b.firstChild.style.background = c || ink;
    b.setAttribute('aria-pressed', String(tool.color === c));
  });
  const custom = tb.querySelector('.sw.custom');
  custom.setAttribute('aria-pressed', String(tool.color !== null && !PALETTE.includes(tool.color)));
  if (cur) { $('#bUndo').disabled = !cur.undo.length; $('#bRedo').disabled = !cur.redo.length; }
}
function setCollapsed(v) { document.body.classList.toggle('collapsed', v); setTimeout(sizeCanvas, 30); }
$('#reveal').onclick = () => setCollapsed(false);

addEventListener('keydown', e => {
  if (!cur || editing || !$('#modal').hidden || e.target.isContentEditable || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && k === 'y') { e.preventDefault(); redo(); }
  else if (mod) return;
  else if (k === 'f') setCollapsed(!document.body.classList.contains('collapsed'));
  else if (k === 'escape') setCollapsed(false);
  else if ({ p: 'pen', h: 'hl', e: 'eraser', l: 'laser' }[k]) { tool.name = { p: 'pen', h: 'hl', e: 'eraser', l: 'laser' }[k]; updateToolbarState(); }
});

/* ---------- boot ---------- */
(async function boot() {
  buildToolbar();
  const all = await idb('readonly', s => s.getAll());
  for (const raw of all || []) {
    raw.items = (raw.items || []).map(i => ({ ...i, imgs: i.imgs || [] }));
    boards.set(raw.id, { ...raw, undo: [], redo: [] });
  }
  meta.open = meta.open.filter(id => boards.has(id));
  const a = meta.active && boards.get(meta.active);
  showBoard(a || null);
})();
