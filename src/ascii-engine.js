/*!
 * ascii-engine.js — v0.1.0 (Phase 1)
 * Image → ASCII art: aspect-corrected sampling, dom/pre render, fitMode, caching, a11y.
 * Zero dependencies. Embeddable via <script> tag or CJS require().
 */
(function () {
  'use strict';

  // ─── Character sets ────────────────────────────────────────────────────────
  // Ordered light → dark (space = brightest, last char = darkest).

  const CHARSETS = {
    classic:  ' .:-=+*#%@',
    extended: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    blocks:   ' ░▒▓█',
    // Braille full-fidelity sampling is Phase 2; for now treat as a dense ramp.
    braille:  ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿',
  };

  // Monospace glyphs are ~2× taller than wide; sampling compensates for this.
  const GLYPH_ASPECT = 2.0;

  // ─── Web Worker source ─────────────────────────────────────────────────────
  // Runs pixel-math (downsample + luminance) off the main thread.
  // Returns raw luminance grid (0–1, no gamma/contrast applied) so the cache
  // stays independent of render-time style params.

  const WORKER_SRC = /* js */`
'use strict';
self.onmessage = function (e) {
  var d    = e.data;
  var px   = d.pixels;   // Uint8ClampedArray
  var imgW = d.imgW;
  var imgH = d.imgH;
  var cols = d.cols;
  var rows = d.rows;

  var brightness = new Float32Array(rows * cols);
  var cellW = imgW / cols;
  var cellH = imgH / rows;

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      brightness[r * cols + c] = sampleCell(px, imgW, imgH, c, r, cellW, cellH);
    }
  }

  self.postMessage({ rows: rows, cols: cols, brightness: brightness }, [brightness.buffer]);
};

function sampleCell(data, imgW, imgH, col, row, cellW, cellH) {
  var x0 = Math.floor(col * cellW);
  var y0 = Math.floor(row * cellH);
  var x1 = Math.min(Math.ceil((col + 1) * cellW), imgW);
  var y1 = Math.min(Math.ceil((row + 1) * cellH), imgH);
  var sum = 0, count = 0;
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      var i = (y * imgW + x) * 4;
      // Composite against white before computing BT.601 luminance, so transparent
      // areas read as bright (space character) rather than black.
      var a  = data[i + 3] / 255;
      var r  = data[i]     * a + 255 * (1 - a);
      var g  = data[i + 1] * a + 255 * (1 - a);
      var b  = data[i + 2] * a + 255 * (1 - a);
      sum += 0.299 * r + 0.587 * g + 0.114 * b;
      count++;
    }
  }
  return count > 0 ? (sum / count) / 255 : 1;
}
`;

  // ─── Module-level cache ────────────────────────────────────────────────────
  // Key: src|cols|dither|edgeBlend  (charset/gamma/contrast are render-time params,
  // so they never invalidate the brightness grid).

  const _gridCache = new Map();

  function cacheKey(src, cols, dither, edgeBlend) {
    return src + '|' + cols + '|' + (+dither).toFixed(2) + '|' + (+edgeBlend).toFixed(2);
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  function densityToCols(pct) {
    // §9: 0% → 40 cols, 100% → 240 cols
    return Math.round(40 + (pct / 100) * 200);
  }

  function contrastExponent(pct) {
    // §9: 0% → exponent 0.5 (flat/washed), 100% → exponent 2.5 (high contrast)
    return 0.5 + (pct / 100) * 2.0;
  }

  function resolveCharset(charset) {
    return CHARSETS[charset] || (typeof charset === 'string' && charset.length > 0
      ? charset
      : CHARSETS.classic);
  }

  function mapChar(rawBrightness, charset, contrastExp, gamma) {
    // Apply gamma then contrast curve, then map to charset index.
    // brightness=1 (white) → charset[0] (space); brightness=0 (black) → charset[last].
    let b = (gamma !== 1.0)
      ? Math.pow(Math.max(0, rawBrightness), 1.0 / gamma)
      : rawBrightness;
    b = Math.pow(Math.max(0, Math.min(1, b)), contrastExp);
    const idx = Math.round((1 - b) * (charset.length - 1));
    return charset[Math.max(0, Math.min(charset.length - 1, idx))];
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error('[ascii-engine] Failed to load image: ' + src));
      img.src = src;
    });
  }

  function getImageData(img) {
    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth  || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }

  function makeWorker() {
    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const url  = URL.createObjectURL(blob);
    const w    = new Worker(url);
    URL.revokeObjectURL(url);
    return w;
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // Measure character width (px) at 100px font-size — cached after first call.
  let _charWidthCache = null;
  function measureCharWidth() {
    if (_charWidthCache !== null) return _charWidthCache;
    const span = document.createElement('span');
    Object.assign(span.style, {
      position: 'absolute', top: '-9999px', left: '-9999px',
      visibility: 'hidden', fontFamily: 'monospace',
      fontSize: '100px', whiteSpace: 'pre',
    });
    span.textContent = '0';
    document.body.appendChild(span);
    _charWidthCache = span.offsetWidth;
    document.body.removeChild(span);
    return _charWidthCache;
  }

  // Main-thread fallback — same algorithm as the Worker, runs synchronously.
  function processPixels(data, imgW, imgH, cols, rows) {
    const brightness = new Float32Array(rows * cols);
    const cellW = imgW / cols;
    const cellH = imgH / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * cellW), y0 = Math.floor(r * cellH);
        const x1 = Math.min(Math.ceil((c + 1) * cellW), imgW);
        const y1 = Math.min(Math.ceil((r + 1) * cellH), imgH);
        let sum = 0, count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i = (y * imgW + x) * 4;
            const a = data[i + 3] / 255;
            const rr = data[i]     * a + 255 * (1 - a);
            const gg = data[i + 1] * a + 255 * (1 - a);
            const bb = data[i + 2] * a + 255 * (1 - a);
            sum += 0.299 * rr + 0.587 * gg + 0.114 * bb;
            count++;
          }
        }
        brightness[r * cols + c] = count > 0 ? (sum / count) / 255 : 1;
      }
    }
    return { rows, cols, brightness };
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // ─── ASCIIEngine ───────────────────────────────────────────────────────────

  class ASCIIEngine {
    constructor(container, opts = {}) {
      if (!(container instanceof Element)) {
        throw new Error('[ascii-engine] container must be a DOM Element');
      }
      this._el        = container;
      this._opts      = this._normalizeOpts(opts);
      this._worker    = null;
      this._ro        = null;       // ResizeObserver
      this._grid      = null;       // cached grid from last pipeline run
      this._rendering = null;       // in-flight render promise (serializer)
    }

    // ── Public API ─────────────────────────────────────────────────────────

    render(imageOrSrc) {
      // Serialize concurrent render calls on this instance.
      this._rendering = (this._rendering || Promise.resolve())
        .then(() => this._doRender(imageOrSrc))
        .catch((err) => { console.error('[ascii-engine]', err); });
      return this._rendering;
    }

    // Partial option update. Re-runs pipeline only if structural params changed.
    update(newOpts) {
      const prev = this._opts;
      this._opts = this._normalizeOpts(Object.assign({}, prev, newOpts));
      const o = this._opts;

      const structural =
        o.src !== prev.src ||
        o.cols !== prev.cols ||
        o.dither !== prev.dither ||
        o.edgeBlend !== prev.edgeBlend;
      if (structural || !this._grid) {
        return this.render(o.src || prev.src);
      }
      // Render-only change: charset, gamma, contrast, renderMode, fitMode — use cached grid.
      this._paint(this._grid, o);
      this._applyA11y(o);
      if (o.fitMode === 'width') this._fitWidth(this._grid.cols);
      return Promise.resolve(this);
    }

    destroy() {
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._ro)     { this._ro.disconnect();    this._ro = null; }
      this._el.innerHTML = '';
      this._grid = null;
    }

    // ── Internal ───────────────────────────────────────────────────────────

    _normalizeOpts(raw) {
      const density = raw.density != null ? Number(raw.density) : null;
      const cols = raw.cols != null
        ? Number(raw.cols)
        : density != null ? densityToCols(density) : densityToCols(62);

      return {
        src:         raw.src        || '',
        cols:        Math.max(10, Math.min(500, Math.round(cols))),
        charset:     raw.charset    || 'classic',
        renderMode:  raw.renderMode || 'dom',
        fitMode:     raw.fitMode    || 'width',
        contrast:    raw.contrast   != null ? Number(raw.contrast)   : 50,
        gamma:       raw.gamma      != null ? Number(raw.gamma)      : 1.0,
        glyphAspect: raw.glyphAspect!= null ? Number(raw.glyphAspect): GLYPH_ASPECT,
        alt:         raw.alt || raw.label || '',
        // Phase 2+ stubs (accepted, stored, not yet used in pipeline):
        dither:      raw.dither     != null ? Number(raw.dither)     : 0,
        edgeBlend:   raw.edgeBlend  != null ? Number(raw.edgeBlend)  : 0,
        colorMode:   raw.colorMode  || 'theme',
        themeBlend:  raw.themeBlend != null ? Number(raw.themeBlend) : 100,
        // Seeded RNG slot for Phase 3 noise/glitch:
        seed:        raw.seed       != null ? Number(raw.seed)       : 0,
      };
    }

    async _doRender(imageOrSrc) {
      const opts = this._opts;
      const src  = (typeof imageOrSrc === 'string')
        ? imageOrSrc
        : (imageOrSrc && imageOrSrc.src) || opts.src;

      if (!src) throw new Error('[ascii-engine] No image source provided');
      if (!opts.alt) console.warn('[ascii-engine] No alt/label provided — add "alt" for accessibility.', this._el);

      const key = cacheKey(src, opts.cols, opts.dither, opts.edgeBlend);
      let grid;
      if (_gridCache.has(key)) {
        // Structural params unchanged — skip image load entirely.
        grid = _gridCache.get(key);
      } else {
        const img  = (typeof imageOrSrc === 'string' || !imageOrSrc) ? await loadImage(src) : imageOrSrc;
        const imgW = img.naturalWidth  || img.width;
        const imgH = img.naturalHeight || img.height;
        // Aspect-ratio correction: rows scaled by glyph height/width ratio (~2:1).
        const rows = Math.max(1, Math.round(opts.cols * (imgH / imgW) / opts.glyphAspect));
        grid = await this._runWorker(getImageData(img), opts.cols, rows);
        _gridCache.set(key, grid);
      }

      this._grid = grid;
      this._paint(grid, opts);
      this._applyA11y(opts);

      if (opts.fitMode === 'width') {
        this._fitWidth(grid.cols);
        this._setupResizeObserver(grid.cols);
      }
    }

    _runWorker(imageData, cols, rows) {
      // Try Web Worker first; fall back to main-thread if unavailable (e.g. file:// in some browsers).
      try {
        if (!this._worker) this._worker = makeWorker();
      } catch (_) {
        return Promise.resolve(processPixels(imageData.data, imageData.width, imageData.height, cols, rows));
      }
      return new Promise((resolve, reject) => {
        const copy = new Uint8ClampedArray(imageData.data.buffer.slice(0));
        this._worker.onmessage = (e) => resolve(e.data);
        this._worker.onerror   = () => {
          // Worker failed after creation — process on main thread.
          this._worker = null;
          resolve(processPixels(imageData.data, imageData.width, imageData.height, cols, rows));
        };
        this._worker.postMessage(
          { pixels: copy, imgW: imageData.width, imgH: imageData.height, cols, rows },
          [copy.buffer],
        );
      });
    }

    _paint(grid, opts) {
      if (opts.renderMode === 'pre') {
        this._renderPre(grid, opts);
      } else {
        this._renderDOM(grid, opts);
      }
    }

    _renderPre(grid, opts) {
      const charset = resolveCharset(opts.charset);
      const exp     = contrastExponent(opts.contrast);
      let text = '';
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          text += mapChar(grid.brightness[r * grid.cols + c], charset, exp, opts.gamma);
        }
        if (r < grid.rows - 1) text += '\n';
      }
      this._el.innerHTML = '';
      const pre = document.createElement('pre');
      Object.assign(pre.style, {
        margin: '0', padding: '0',
        lineHeight: '1em', fontFamily: 'monospace',
        color: 'var(--ascii-fg, currentColor)',
        backgroundColor: 'var(--ascii-bg, transparent)',
      });
      pre.textContent = text;
      this._el.appendChild(pre);
    }

    _renderDOM(grid, opts) {
      const charset = resolveCharset(opts.charset);
      const exp     = contrastExponent(opts.contrast);

      this._el.innerHTML = '';
      Object.assign(this._el.style, {
        display: 'block', fontFamily: 'monospace',
        color: 'var(--ascii-fg, currentColor)',
        backgroundColor: 'var(--ascii-bg, transparent)',
        userSelect: 'none',
      });

      const frag = document.createDocumentFragment();
      for (let r = 0; r < grid.rows; r++) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'block', whiteSpace: 'pre', lineHeight: '1em' });
        for (let c = 0; c < grid.cols; c++) {
          const raw = grid.brightness[r * grid.cols + c];
          const ch  = mapChar(raw, charset, exp, opts.gamma);
          const sp  = document.createElement('span');
          sp.textContent        = ch;
          sp.dataset.brightness = raw.toFixed(3);  // raw luminance for hover system
          sp.dataset.cell       = r + ',' + c;
          row.appendChild(sp);
        }
        frag.appendChild(row);
      }
      this._el.appendChild(frag);
    }

    _applyA11y(opts) {
      this._el.setAttribute('aria-hidden', 'true');
      // Prevent any keyboard focus entering the glyph soup.
      this._el.style.outline = 'none';
      const children = this._el.querySelectorAll('*');
      children.forEach((ch) => { if (ch.tabIndex >= 0) ch.tabIndex = -1; });

      // Stable container ID for linking the visually-hidden label.
      if (!this._el.id) {
        this._el.id = 'ascii-' + Math.random().toString(36).slice(2, 8);
      }

      const parent = this._el.parentNode;
      if (!parent) return;

      let label = parent.querySelector('.ascii-sr-label[data-for="' + this._el.id + '"]');

      if (opts.alt) {
        if (!label) {
          label = document.createElement('span');
          label.className     = 'ascii-sr-label';
          label.dataset.for   = this._el.id;
          label.setAttribute('role', 'img');
          // Visually-hidden, screen-reader visible.
          Object.assign(label.style, {
            position: 'absolute', width: '1px', height: '1px',
            padding: '0', margin: '-1px', overflow: 'hidden',
            clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: '0',
          });
          parent.insertBefore(label, this._el);
        }
        label.textContent = opts.alt;
        label.setAttribute('aria-label', opts.alt);
      } else if (label) {
        label.remove();
      }
    }

    _fitWidth(cols) {
      const doFit = () => {
        const w = this._el.offsetWidth;
        if (!w || !cols) return;
        const charW  = measureCharWidth();   // px per char at 100px font-size
        const fsize  = (w * 100) / (cols * charW);
        this._el.style.fontSize   = fsize + 'px';
        this._el.style.lineHeight = '1em';
      };
      requestAnimationFrame(doFit);
    }

    _setupResizeObserver(cols) {
      if (this._ro) return;
      const debouncedFit = debounce(() => this._fitWidth(cols), 100);
      this._ro = new ResizeObserver(debouncedFit);
      this._ro.observe(this._el.parentElement || this._el);
    }
  }

  // Expose globally as early as possible so later setup errors don't block access.
  if (typeof window !== 'undefined') window.ASCIIEngine = ASCIIEngine;

  // ─── Declarative attribute API ─────────────────────────────────────────────

  function parseAttrs(el) {
    // data-ascii-config JSON has highest priority, then individual attributes.
    const config = {};
    const cfgStr = el.getAttribute('data-ascii-config');
    if (cfgStr) {
      try { Object.assign(config, JSON.parse(cfgStr)); }
      catch (_) { console.warn('[ascii-engine] Invalid data-ascii-config JSON on', el); }
    }
    const attrs = {
      'data-ascii-alt':         'alt',
      'data-ascii-label':       'label',
      'data-ascii-preset':      'preset',
      'data-ascii-charset':     'charset',
      'data-ascii-render-mode': 'renderMode',
      'data-ascii-fit-mode':    'fitMode',
      'data-ascii-cols':        'cols',
      'data-ascii-density':     'density',
      'data-ascii-contrast':    'contrast',
      'data-ascii-gamma':       'gamma',
      'data-ascii-color-mode':  'colorMode',
      'data-ascii-theme-blend': 'themeBlend',
      'data-ascii-seed':        'seed',
    };
    for (const [attr, key] of Object.entries(attrs)) {
      if (config[key] != null) continue; // JSON already set it
      const val = el.getAttribute(attr);
      if (val == null) continue;
      const num = Number(val);
      config[key] = isNaN(num) ? val : num;
    }
    config.src = el.getAttribute('data-ascii-src') || '';
    return config;
  }

  function initDeclarative() {
    document.querySelectorAll('[data-ascii-src]').forEach((el) => {
      if (el._asciiEngine) return; // already initialized
      const opts   = parseAttrs(el);
      const engine = new ASCIIEngine(el, opts);
      el._asciiEngine = engine;
      engine.render(opts.src);
    });
  }

  // ─── Auto-init ─────────────────────────────────────────────────────────────

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDeclarative);
    } else {
      // Script loaded after DOM is ready (e.g. defer attribute).
      setTimeout(initDeclarative, 0);
    }
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  ASCIIEngine.CHARSETS   = CHARSETS;
  ASCIIEngine.GLYPH_ASPECT = GLYPH_ASPECT;
  ASCIIEngine.init       = initDeclarative;
  ASCIIEngine.clearCache = () => _gridCache.clear();
  ASCIIEngine.prefersReducedMotion = prefersReducedMotion;
  Object.defineProperty(ASCIIEngine, 'cacheSize', { get: () => _gridCache.size, configurable: true });

  // window assignment already done above; also support CJS.
  if (typeof module !== 'undefined' && module.exports) module.exports = ASCIIEngine;

}());
