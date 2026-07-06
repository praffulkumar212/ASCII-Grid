// Minimal DOM shim to run ascii-engine.js in Node and test real behavior.
// Run: node test/engine.test.js
'use strict';

class Element {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.style = {}; this.dataset = {}; this.children = [];
    this.parentNode = null; this.parentElement = null;
    this.attributes = {}; this.textContent = ''; this.id = '';
    this.className = ''; this.offsetWidth = 600;
  }
  appendChild(ch) {
    if (ch instanceof DocumentFragment) { ch.children.forEach(c => this.appendChild(c)); ch.children = []; return ch; }
    ch.parentNode = ch.parentElement = this; this.children.push(ch); return ch;
  }
  insertBefore(ch, ref) { ch.parentNode = ch.parentElement = this; this.children.unshift(ch); return ch; }
  removeChild(ch) { this.children = this.children.filter(c => c !== ch); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k] != null ? this.attributes[k] : null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  set innerHTML(v) { this.children = []; }
  get innerHTML() { return ''; }
}
class DocumentFragment extends Element { constructor() { super('#fragment'); } }

global.Element = Element;
global.window = { ASCIIEngine: null, matchMedia: () => ({ matches: false }) };
global.document = {
  readyState: 'complete',
  createElement: (t) => new Element(t),
  createDocumentFragment: () => new DocumentFragment(),
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: new Element('body'),
};
global.getComputedStyle = () => ({ color: 'rgb(26,26,26)' });
global.requestAnimationFrame = (fn) => fn();
global.ResizeObserver = class { observe(){} disconnect(){} };
// No Blob/Worker/URL → engine must fall back to main-thread processPixels.
// Shim glyphs have no offsetHeight → measureGlyphAspect falls back to 2.0,
// keeping grid-dimension expectations deterministic in Node.

const path = require('path');
const enginePath = path.join(__dirname, '..', 'src', 'ascii-engine.js');
const ASCIIEngine = require(enginePath);
const I = ASCIIEngine._internals;

// ── helpers ──────────────────────────────────────────────────────────────
function gradientImageData(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = Math.round((x / (w - 1)) * 255); // left black → right white
    data[i] = data[i+1] = data[i+2] = v; data[i+3] = 255;
  }
  return { data, width: w, height: h };
}
function grabText(el) {
  return el.children.map(row => row.children.map(s => s.textContent).join('')).join('\n');
}
let pass = 0, fail = 0;
function check(name, ok, extra) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (extra ? '  → ' + extra : ''));
  ok ? pass++ : fail++;
}

(async () => {
  const el = new Element('div');
  const parent = new Element('div'); parent.appendChild(el);

  const engine = new ASCIIEngine(el, { cols: 40, alt: 'test', fitMode: 'fixed' });
  const imgData = gradientImageData(100, 50);

  const grid = await engine._runWorker(imgData, 40, Math.round(40 * (50/100) / 2));
  engine._grid = grid;

  check('grid dims: 40 cols × 10 rows (aspect-corrected)', grid.cols === 40 && grid.rows === 10, grid.cols + '×' + grid.rows);
  check('brightness range sane', grid.brightness[0] < 0.1 && grid.brightness[39] > 0.9,
        'left=' + grid.brightness[0].toFixed(2) + ' right=' + grid.brightness[39].toFixed(2));

  // DOM render
  engine._paint(grid, engine._opts);
  const firstRow = grabText(el).split('\n')[0];
  check('DOM render: dark char on left, space on right',
        firstRow[0] === '@' && firstRow[firstRow.length - 1] === ' ',
        JSON.stringify(firstRow.slice(0,6) + '…' + firstRow.slice(-3)));
  const span = el.children[0].children[5];
  check('spans carry data-brightness + data-cell', span.dataset.brightness != null && span.dataset.cell === '0,5',
        'brightness=' + span.dataset.brightness + ' cell=' + span.dataset.cell);

  // a11y
  engine._applyA11y(engine._opts);
  check('container aria-hidden', el.getAttribute('aria-hidden') === 'true');
  check('sr-label injected with alt text', parent.children.some(c => c.className === 'ascii-sr-label' && c.textContent === 'test'));

  // Dither purity: cached grid must not mutate
  const before = grid.brightness.slice(0, 400).join(',');
  engine._paint(grid, Object.assign({}, engine._opts, { dither: 1, ditheringMode: 'fs' }));
  const after = grid.brightness.slice(0, 400).join(',');
  check('FS dither does not mutate cached grid', before === after);

  // FIX #1 — update({density}) must recompute cols
  const e2 = new ASCIIEngine(new Element('div'), { density: 62, alt: 'x' });
  const colsBefore = e2._opts.cols;              // 62% → 164
  e2._grid = grid;
  e2._opts.src = 'fake';
  try { await e2.update({ density: 100 }); } catch (_) {}
  check('FIX #1: update({density:100}) changes cols 164→240', e2._opts.cols === 240,
        'cols before=' + colsBefore + ' after=' + e2._opts.cols);
  try { await e2.update({ contrast: 80 }); } catch (_) {}
  check('FIX #1: non-density update keeps cols', e2._opts.cols === 240, 'cols=' + e2._opts.cols);
  try { await e2.update({ cols: 120, density: 10 }); } catch (_) {}
  check('FIX #1: explicit cols still wins over density', e2._opts.cols === 120, 'cols=' + e2._opts.cols);

  // FIX #2 — ResizeObserver reads live grid cols (source-level assertion)
  const src = require('fs').readFileSync(enginePath, 'utf8');
  const roBlock = src.match(/_setupResizeObserver\(\)\s*{[\s\S]*?\n    }/);
  check('FIX #2: RO callback reads this._grid.cols at fire time',
        !!roBlock && /this\._grid\.cols/.test(roBlock[0]) && !/_setupResizeObserver\(cols\)/.test(src));

  // FIX #3 — measured glyph aspect with safe fallback
  check('FIX #3: measureGlyphAspect falls back to 2.0 without real font metrics',
        I.measureGlyphAspect() === 2.0);
  check('FIX #3: glyphAspect flows from measurement (engine default = fallback here)',
        engine._opts.glyphAspect === 2.0, 'aspect=' + engine._opts.glyphAspect);

  // FIX #4 — braille ramp monotonic by dot count
  const braille = ASCIIEngine.CHARSETS.braille;
  let monotonic = braille[0] === ' ' && braille.length === 256;
  for (let i = 2; i < braille.length && monotonic; i++) {
    if (I.popcount(braille.charCodeAt(i) - 0x2800) < I.popcount(braille.charCodeAt(i - 1) - 0x2800)) monotonic = false;
  }
  check('FIX #4: braille ramp is dot-count ordered (256 levels)', monotonic, 'len=' + braille.length);

  // FIX #5 — Sobel edge blend: step edge darkens boundary, flattens elsewhere
  const stepB = new Float32Array(10 * 20);
  for (let r = 0; r < 10; r++) for (let c = 0; c < 20; c++) stepB[r*20+c] = c < 10 ? 0.1 : 0.9;
  const edged = I.applyEdgeBlend(stepB, 10, 20, 1.0);
  const atEdge = edged[5*20 + 10], flat = edged[5*20 + 3], far = edged[5*20 + 17];
  check('FIX #5: edge cells dark, flat areas bright', atEdge < 0.3 && flat > 0.9 && far > 0.9,
        'edge=' + atEdge.toFixed(2) + ' flat=' + flat.toFixed(2) + ' far=' + far.toFixed(2));
  check('FIX #5: edgeBlend accepts percent or fraction',
        I.normalizeEdgeBlend(50) === 0.5 && I.normalizeEdgeBlend(0.5) === 0.5 && I.normalizeEdgeBlend(0) === 0);

  // FIX #6 — dithering operates on post-tone values
  const toned = I.toneAndDither(grid.brightness, grid.rows, grid.cols, 10, {
    contrast: 100, gamma: 1.0, dither: 1, ditheringMode: 'bayer',
  });
  const step = 1 / 9;
  const onLevels = Array.from(toned.slice(0, 40)).every(v => Math.abs(v / step - Math.round(v / step)) < 1e-6);
  check('FIX #6: dithered values land exactly on charset levels', onLevels);

  // Bayer determinism + cache intact
  engine._paint(grid, Object.assign({}, engine._opts, { dither: 0.8, ditheringMode: 'bayer' }));
  check('Bayer dither deterministic + cache intact', grid.brightness.slice(0,400).join(',') === before);

  // pre mode
  const el3 = new Element('div'); new Element('div').appendChild(el3);
  const e3 = new ASCIIEngine(el3, { cols: 40, alt: 'x', renderMode: 'pre', fitMode: 'fixed' });
  e3._grid = grid; e3._paint(grid, e3._opts);
  check('pre mode renders <pre> with newline rows', el3.children[0].tagName === 'PRE' && el3.children[0].textContent.split('\n').length === 10);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) process.exit(1);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
