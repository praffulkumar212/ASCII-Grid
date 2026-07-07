// Minimal DOM shim to run ascii-engine.js in Node and test real behavior.
// Run: node test/engine.test.js
'use strict';

class Element {
  constructor(tag) {
    this.tagName = (tag || 'div').toUpperCase();
    this.dataset = {}; this.children = [];
    this.parentNode = null; this.parentElement = null;
    this.attributes = {}; this.textContent = ''; this.id = '';
    this.className = ''; this.offsetWidth = 600;
    const self = this;
    this.style = { setProperty: (k, v) => { self.style[k] = v; } };
  }
  appendChild(ch) {
    if (ch instanceof DocumentFragment) { ch.children.forEach(c => this.appendChild(c)); ch.children = []; return ch; }
    ch.parentNode = ch.parentElement = this; this.children.push(ch); return ch;
  }
  insertBefore(ch, ref) { ch.parentNode = ch.parentElement = this; this.children.unshift(ch); return ch; }
  removeChild(ch) { this.children = this.children.filter(c => c !== ch); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener() {} removeEventListener() {}
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
global.getComputedStyle = () => ({ color: 'rgb(26,26,26)', getPropertyValue: () => '#4f8cff' });
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

  // ── Phase 3 ─────────────────────────────────────────────────────────────

  // Presets: 13, default included, JSON file in sync with engine
  const presetNames = Object.keys(ASCIIEngine.PRESETS);
  check('P3: 13 presets incl. theme-adaptive', presetNames.length === 13 && presetNames.includes('theme-adaptive'),
        presetNames.length + ' presets');
  const jsonPresets = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'presets', 'presets.json'), 'utf8'));
  check('P3: presets/presets.json matches ASCIIEngine.PRESETS',
        JSON.stringify(jsonPresets) === JSON.stringify(ASCIIEngine.PRESETS));

  // Preset resolution: baseline applies, user overrides win
  const eBp = new ASCIIEngine(new Element('div'), { preset: 'blueprint', alt: 'x' });
  check('P3: preset baseline applies (blueprint → edgeBlend 0.85, cols 170)',
        eBp._opts.edgeBlend === 0.85 && eBp._opts.cols === 170,
        'edge=' + eBp._opts.edgeBlend + ' cols=' + eBp._opts.cols);
  const eOv = new ASCIIEngine(new Element('div'), { preset: 'blueprint', contrast: 90, alt: 'x' });
  check('P3: explicit option beats preset (contrast 90 over 45)', eOv._opts.contrast === 90);

  // Preset switching never leaks old preset values
  eBp._grid = grid; eBp._userOpts.src = 'fake';
  try { await eBp.update({ preset: 'classic-mono' }); } catch (_) {}
  check('P3: preset switch clears old preset fields (edgeBlend 0.85→0, density recomputed)',
        eBp._opts.edgeBlend === 0 && eBp._opts.cols === 150,
        'edge=' + eBp._opts.edgeBlend + ' cols=' + eBp._opts.cols);

  // Seeded RNG: deterministic, PLAN.md §9 formulas
  const r1 = I.mulberry32(1337), r2 = I.mulberry32(1337);
  const seq1 = [r1(), r1(), r1()], seq2 = [r2(), r2(), r2()];
  check('P3: mulberry32 deterministic for equal seeds', JSON.stringify(seq1) === JSON.stringify(seq2));
  check('P3: noise probability maps 0→0, 100→0.35',
        I.noiseProbability(0) === 0 && Math.abs(I.noiseProbability(100) - 0.35) < 1e-9);
  check('P3: tick interval maps 100→60ms, 0→∞',
        I.tickInterval(100) === 60 && I.tickInterval(0) === Infinity);

  // Glow formula: single shadow ≤60%, layered ×2 above
  check('P3: glow 50 → single shadow, glow 80 → layered ×2',
        I.glowShadow(50) === '0 0 6.0px currentColor' && I.glowShadow(80).split(',').length === 2 && I.glowShadow(0) === '');

  // ANSI-256 quantization
  const q = I.quantizeAnsi256;
  check('P3: ansi256 exact corners preserved, mids snapped to palette',
        JSON.stringify(q(0,0,0)) === '[0,0,0]' && JSON.stringify(q(255,0,0)) === '[255,0,0]'
        && JSON.stringify(q(100,100,100)) === '[98,98,98]');

  // Noise tick: seeded corruption + full restore, cache untouched
  const elN = new Element('div'); new Element('div').appendChild(elN);
  const eN = new ASCIIEngine(elN, { cols: 40, alt: 'x', fitMode: 'fixed', noise: 60, seed: 1337 });
  eN._grid = grid; eN._paint(grid, eN._opts);
  const cleanText = grabText(elN);
  eN._noiseTick();
  const noisyText = grabText(elN);
  const flipped = [...cleanText].filter((c, i) => c !== noisyText[i]).length;
  check('P3: seeded noise tick corrupts ~21% of cells (0.6×0.35)', flipped > 40 && flipped < 130,
        flipped + '/400 flipped');
  eN._noiseTick();
  const noisy2 = grabText(elN);
  eN._restoreNoise();
  check('P3: restore returns to clean frame', grabText(elN) === cleanText);
  check('P3: noise leaves cached grid untouched', grid.brightness.slice(0,400).join(',') === before);
  const eN2 = new ASCIIEngine(new Element('div'), { cols: 40, alt: 'x', fitMode: 'fixed', noise: 60, seed: 1337 });
  // determinism across engines: same seed → same first-tick corruption pattern
  const elN2 = new Element('div'); new Element('div').appendChild(elN2);
  const eN3 = new ASCIIEngine(elN2, { cols: 40, alt: 'x', fitMode: 'fixed', noise: 60, seed: 1337 });
  eN3._grid = grid; eN3._paint(grid, eN3._opts); eN3._noiseTick();
  check('P3: same seed → identical corruption pattern', grabText(elN2) === noisyText);
  eN.destroy(); eN3.destroy();

  // ANSI preset wires quantization into the DOM color path
  const elQ = new Element('div'); new Element('div').appendChild(elQ);
  const eQ = new ASCIIEngine(elQ, { preset: 'ansi-256', cols: 40, alt: 'x', fitMode: 'fixed' });
  eQ._grid = grid; eQ._paint(grid, eQ._opts);
  const qColors = elQ.children.flatMap(r => r.children).map(s => s.style.color).filter(Boolean);
  const palette = new Set([0,95,135,175,215,255, ...Array.from({length:24},(_,i)=>8+10*i)]);
  const allOnPalette = qColors.length > 0 && qColors.every(c => c.match(/\d+/g).every(v => palette.has(+v)));
  check('P3: ansi-256 preset → every span color on xterm palette', allOnPalette, qColors.length + ' colored spans');

  // Glow + fg/bg land on container styles
  const elG = new Element('div'); new Element('div').appendChild(elG);
  const eG = new ASCIIEngine(elG, { preset: 'crt', cols: 40, alt: 'x', fitMode: 'fixed' });
  eG._grid = grid; eG._paint(grid, eG._opts);
  check('P3: crt preset applies glow shadow + fg/bg vars',
        /currentColor/.test(elG.style.textShadow) && elG.style['--ascii-fg'] === '#33ff33' && elG.style['--ascii-bg'] === '#031103');

  // ── Phase 5: hover effects ──────────────────────────────────────────────

  check('P5: hover opts normalize (defaults + validation)', (() => {
    const e = new ASCIIEngine(new Element('div'), { hoverEffect: 'highlight', alt: 'x' });
    const bad = new ASCIIEngine(new Element('div'), { hoverEffect: 'wobble', alt: 'x' });
    return e._opts.hoverEffect === 'highlight' && e._opts.hoverRadius === '25%'
      && e._opts.hoverDuration === 150 && e._opts.hoverFalloff === 'smooth'
      && bad._opts.hoverEffect === null;
  })());

  check('FIX #8: hover radius scales with image — 25% default, % strings, absolute override', (() => {
    const f = I.effectiveHoverRadius;
    return f('25%', 240) === 60 && f('25%', 40) === 10 && f('50%', 100) === 50
      && f(4, 240) === 4 && f('12', 100) === 12 && f('150%', 100) === 100;
  })());

  check('P5: falloff weights — smooth center 1 edge 0, monotonic', (() => {
    const f = I.falloffWeight;
    return f(0, 4, 'smooth') === 1 && f(4, 4, 'smooth') < 1e-9 && f(5, 4, 'smooth') === 0
      && f(1, 4, 'smooth') > f(3, 4, 'smooth')
      && f(2, 4, 'linear') === 0.5 && f(3, 4, 'none') === 1;
  })());

  // highlight: accent within radius, untouched outside, clear restores
  const elH = new Element('div'); new Element('div').appendChild(elH);
  const eH = new ASCIIEngine(elH, { cols: 40, alt: 'x', fitMode: 'fixed', hoverEffect: 'highlight', hoverRadius: 3 });
  eH._grid = grid; eH._paint(grid, eH._opts);
  const spanAt = (r, c) => elH.children[r].children[c];
  const preColor = spanAt(5, 20).style.color || '';
  eH._hoverAt(20, 5);
  const centerColored = spanAt(5, 20).style.color === '#4f8cff';
  const farUntouched  = (spanAt(5, 30).style.color || '') === '' && (spanAt(0, 0).style.color || '') === '';
  check('P5: highlight colors center accent, leaves far cells alone', centerColored && farUntouched);
  check('P5: falloff → center more opaque than ring edge',
        +spanAt(5, 20).style.opacity > +spanAt(5, 22).style.opacity,
        spanAt(5,20).style.opacity + ' vs ' + spanAt(5,22).style.opacity);
  check('P5: transition config lands on touched spans',
        /150ms ease-out/.test(spanAt(5, 20).style.transition));
  eH._hoverClear();
  check('P5: clear restores original styles incl. transition', (spanAt(5, 20).style.color || '') === preColor
        && (spanAt(5, 20).style.opacity || '') === ''
        && (spanAt(5, 20).style.transition || '') === '');

  // move: previous position restored when cursor moves on
  eH._hoverAt(20, 5); eH._hoverAt(35, 8);
  check('P5: moving hover restores previous cells', (spanAt(5, 20).style.color || '') === ''
        && spanAt(8, 35).style.color === '#4f8cff');
  check('QA: incremental diff — unchanged cells are not rewritten', (() => {
    // same position twice → second pass must be a no-op (nothing to restore/apply)
    const appliedBefore = eH._hoverApplied;
    eH._hoverAt(35, 8);
    return eH._hoverApplied.size === appliedBefore.size
      && [...appliedBefore.keys()].every((sp) => eH._hoverApplied.has(sp));
  })());
  eH._hoverClear();

  // QA: switching effects never leaves residue (the "stuck on invert" bug class)
  check('QA: invert residue cleared on effect switch', (() => {
    const el = new Element('div'); new Element('div').appendChild(el);
    const e = new ASCIIEngine(el, { cols: 40, alt: 'x', fitMode: 'fixed', hoverEffect: 'invert', hoverRadius: 3 });
    e._grid = grid; e._paint(grid, e._opts);
    e._hoverAt(20, 5);
    const hadFilter = (el.children[5].children[20].style.filter || '') !== '';
    // switch effect → repaint path runs teardown before re-setup
    e._opts = Object.assign({}, e._opts, { hoverEffect: 'highlight' });
    e._paint(grid, e._opts);
    const clean = (el.children[5].children[20].style.filter || '') === ''
      && (el.children[5].children[20].style.transition || '') === '';
    e.destroy();
    return hadFilter && clean;
  })());

  // reveal: base state + hover lift + teardown restore
  const elR = new Element('div'); new Element('div').appendChild(elR);
  const eR = new ASCIIEngine(elR, { cols: 40, alt: 'x', fitMode: 'fixed', hoverEffect: 'reveal', hoverRadius: 3 });
  eR._grid = grid; eR._paint(grid, eR._opts);
  const rSpanAt = (r, c) => elR.children[r].children[c];
  check('P5: reveal dims all cells to 0.15 base', rSpanAt(0, 0).style.opacity === '0.15' && rSpanAt(9, 39).style.opacity === '0.15');
  eR._hoverAt(20, 5);
  check('P5: reveal lifts hovered center to ~1', +rSpanAt(5, 20).style.opacity === 1);
  eR._teardownHover();
  check('P5: teardown undoes reveal base state', (rSpanAt(0, 0).style.opacity || '') === '');

  // magnify: transform + inline-block
  const elM = new Element('div'); new Element('div').appendChild(elM);
  const eM = new ASCIIEngine(elM, { cols: 40, alt: 'x', fitMode: 'fixed', hoverEffect: 'magnify' });
  eM._grid = grid; eM._paint(grid, eM._opts);
  eM._hoverAt(20, 5);
  const mSpan = elM.children[5].children[20];
  check('P5: magnify scales center span 1.6× inline-block',
        mSpan.style.transform === 'scale(1.60)' && mSpan.style.display === 'inline-block');
  eM.destroy();

  check('P5: hover skipped in pre mode', (() => {
    const el = new Element('div'); new Element('div').appendChild(el);
    const e = new ASCIIEngine(el, { cols: 40, alt: 'x', fitMode: 'fixed', renderMode: 'pre', hoverEffect: 'highlight' });
    e._grid = grid; e._paint(grid, e._opts);
    return e._hoverSaved === null || e._hoverSaved === undefined || e._hoverSaved.size === 0;
  })());

  check('P5: hover is style-only — cached grid untouched', grid.brightness.slice(0,400).join(',') === before);
  eH.destroy(); eR.destroy();

  // ── Phase 6 + perf ──────────────────────────────────────────────────────

  // PERF: non-structural repaint patches spans in place (no DOM rebuild)
  const elP = new Element('div'); new Element('div').appendChild(elP);
  const eP = new ASCIIEngine(elP, { cols: 40, alt: 'x', fitMode: 'fixed', contrast: 50 });
  eP._grid = grid; eP._paint(grid, eP._opts);
  const spanRef = elP.children[5].children[20];
  const charBefore = spanRef.textContent;
  eP._opts = Object.assign({}, eP._opts, { contrast: 100 });
  eP._paint(grid, eP._opts);
  check('PERF: repaint patches same span objects in place',
        elP.children[5].children[20] === spanRef);
  check('PERF: patched spans reflect new contrast', (() => {
    // with contrast 100 vs 50 at least some mid-tone chars must differ
    const t = grabText(elP);
    eP._opts = Object.assign({}, eP._opts, { contrast: 50 });
    eP._paint(grid, eP._opts);
    return t !== grabText(elP);
  })());
  check('PERF: O(k) noise — corrupted list length == round(N*p)', (() => {
    eP._opts = Object.assign({}, eP._opts, { noise: 60, seed: 9 });
    eP._noiseTick();
    const n = eP._corrupted.length;
    eP._restoreNoise();
    return n === Math.round(400 * 0.6 * 0.35);
  })());
  eP.destroy();

  // Entrance animations: option normalization + graceful skip without IO
  check('P6: entrance opts normalize + invalid rejected', (() => {
    const a = new ASCIIEngine(new Element('div'), { entrance: 'typing', alt: 'x' });
    const b = new ASCIIEngine(new Element('div'), { entrance: 'spiral', alt: 'x' });
    return a._opts.entrance === 'typing' && a._opts.entranceDuration === 900 && b._opts.entrance === null;
  })());
  check('P6: no IntersectionObserver → static frame (spans stay visible)', (() => {
    const el = new Element('div'); new Element('div').appendChild(el);
    const e = new ASCIIEngine(el, { cols: 40, alt: 'x', fitMode: 'fixed', entrance: 'fade' });
    e._grid = grid; e._paint(grid, e._opts);
    const visible = (el.children[0].children[0].style.visibility || '') === '';
    e.destroy();
    return visible;
  })());

  // Canvas mode: no 2d context in shim → warn + graceful pre fallback
  check('P6: canvas mode falls back to pre without a 2d context', (() => {
    const el = new Element('div'); new Element('div').appendChild(el);
    const e = new ASCIIEngine(el, { cols: 40, alt: 'x', fitMode: 'fixed', renderMode: 'canvas' });
    e._grid = grid; e._paint(grid, e._opts);
    const ok = el.children[0] && el.children[0].tagName === 'PRE';
    e.destroy();
    return ok;
  })());

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
