// Minimal DOM shim to run ascii-engine.js in Node and test real behavior.
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

const ASCIIEngine = require(require('path').join(__dirname, '..', 'src', 'ascii-engine.js'));

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
function grabText(el) { // walk DOM-mode rows/spans
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

  // Bypass loadImage/canvas: call the internal pipeline directly like _doRender does
  const grid = await engine._runWorker(imgData, 40, Math.round(40 * (50/100) / 2));
  engine._grid = grid;

  check('grid dims: 40 cols × 10 rows (aspect-corrected)', grid.cols === 40 && grid.rows === 10, grid.cols + '×' + grid.rows);
  check('brightness range sane', grid.brightness[0] < 0.1 && grid.brightness[39] > 0.9,
        'left=' + grid.brightness[0].toFixed(2) + ' right=' + grid.brightness[39].toFixed(2));

  // DOM render
  engine._paint(grid, engine._opts);
  const text = grabText(el);
  const firstRow = text.split('\n')[0];
  check('DOM render: dark char on left, space on right',
        firstRow[0] === '@' && firstRow[firstRow.length - 1] === ' ', JSON.stringify(firstRow.slice(0,6) + '…' + firstRow.slice(-3)));
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

  // ── BUG PROBE 1: update({density}) after initial render ──
  const e2 = new ASCIIEngine(new Element('div'), { density: 62, alt: 'x' });
  const colsBefore = e2._opts.cols;              // 62% → 164
  e2._grid = grid;                                // pretend rendered
  e2._opts.src = 'fake';                          // avoid re-render path needing image
  try { await e2.update({ density: 100 }); } catch (_) {}
  check('BUG: update({density:100}) should change cols 164→240', e2._opts.cols === 240,
        'cols before=' + colsBefore + ' after=' + e2._opts.cols);

  // ── BUG PROBE 2: stale cols in ResizeObserver closure ──
  // (static analysis — _setupResizeObserver early-returns when _ro exists, capturing old cols)
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ascii-engine.js'), 'utf8');
  check('BUG: ResizeObserver refit captures cols at first render (stale after update)',
        !/this\._ro\s*=\s*null.*_setupResizeObserver|_grid\.cols/.test(src.match(/_setupResizeObserver\(cols\)\s*{[\s\S]*?}/)[0]),
        'closure holds first-render cols');

  // Bayer determinism
  const d1 = engine._grid.brightness;
  const b1 = JSON.stringify(Array.from(d1.slice(0,20)));
  engine._paint(grid, Object.assign({}, engine._opts, { dither: 0.8, ditheringMode: 'bayer' }));
  const b2 = JSON.stringify(Array.from(engine._grid.brightness.slice(0,20)));
  check('Bayer dither deterministic + cache intact', b1 === b2);

  // pre mode
  const el3 = new Element('div'); new Element('div').appendChild(el3);
  const e3 = new ASCIIEngine(el3, { cols: 40, alt: 'x', renderMode: 'pre', fitMode: 'fixed' });
  e3._grid = grid; e3._paint(grid, e3._opts);
  check('pre mode renders <pre> with newline rows', el3.children[0].tagName === 'PRE' && el3.children[0].textContent.split('\n').length === 10);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
