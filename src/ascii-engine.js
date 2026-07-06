/*!
 * ascii-engine.js — v0.2.0 (Phase 2)
 * Phase 1: image → brightness grid → dom/pre render, fitMode, caching, a11y
 * Phase 2: source color, theme mode, themeBlend, saturation, FS + Bayer dithering
 */
(function () {
  'use strict';

  // ─── Character sets ────────────────────────────────────────────────────────
  // Ordered light → dark (space = brightest, last char = darkest).

  const CHARSETS = {
    classic:  ' .:-=+*#%@',
    extended: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    blocks:   ' ░▒▓█',
    braille:  ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿',
  };

  const GLYPH_ASPECT = 2.0;

  // 4×4 Bayer threshold matrix (values 0–15, normalised to 0–1 at use time).
  const BAYER_4X4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5],
  ];

  // ─── Web Worker source ─────────────────────────────────────────────────────
  // Returns raw luminance grid (0–1) + per-cell RGB (Uint8Array, 3 bytes/cell).
  // No gamma/contrast/dithering applied here — those are render-time params so
  // they never require a pipeline re-run.

  const WORKER_SRC = /* js */`
'use strict';
self.onmessage = function (e) {
  var d    = e.data;
  var px   = d.pixels;
  var imgW = d.imgW;
  var imgH = d.imgH;
  var cols = d.cols;
  var rows = d.rows;

  var brightness = new Float32Array(rows * cols);
  var colors     = new Uint8Array(rows * cols * 3);
  var cellW = imgW / cols;
  var cellH = imgH / rows;

  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      sampleCell(px, imgW, imgH, c, r, cellW, cellH, brightness, colors, r * cols + c);
    }
  }

  self.postMessage(
    { rows: rows, cols: cols, brightness: brightness, colors: colors },
    [brightness.buffer, colors.buffer]
  );
};

function sampleCell(data, imgW, imgH, col, row, cellW, cellH, brightness, colors, idx) {
  var x0 = Math.floor(col * cellW);
  var y0 = Math.floor(row * cellH);
  var x1 = Math.min(Math.ceil((col + 1) * cellW), imgW);
  var y1 = Math.min(Math.ceil((row + 1) * cellH), imgH);
  var lumSum = 0, rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (var y = y0; y < y1; y++) {
    for (var x = x0; x < x1; x++) {
      var i  = (y * imgW + x) * 4;
      var a  = data[i + 3] / 255;
      // Composite against white so transparent areas map to space, not '@'.
      var rv = data[i]     * a + 255 * (1 - a);
      var gv = data[i + 1] * a + 255 * (1 - a);
      var bv = data[i + 2] * a + 255 * (1 - a);
      lumSum += 0.299 * rv + 0.587 * gv + 0.114 * bv;
      rSum += rv; gSum += gv; bSum += bv;
      count++;
    }
  }
  if (count === 0) {
    brightness[idx] = 1;
    colors[idx * 3] = colors[idx * 3 + 1] = colors[idx * 3 + 2] = 255;
    return;
  }
  brightness[idx]     = lumSum / count / 255;
  colors[idx * 3]     = Math.round(rSum / count);
  colors[idx * 3 + 1] = Math.round(gSum / count);
  colors[idx * 3 + 2] = Math.round(bSum / count);
}
`;

  // ─── Cache ─────────────────────────────────────────────────────────────────
  // Key: src|cols|edgeBlend
  // Dithering, color mode, saturation are render-time — they never invalidate the grid.

  const _gridCache = new Map();

  function cacheKey(src, cols, edgeBlend) {
    return src + '|' + cols + '|' + (+edgeBlend).toFixed(2);
  }

  // ─── Core utilities ────────────────────────────────────────────────────────

  function densityToCols(pct) {
    return Math.round(40 + (pct / 100) * 200);
  }

  function contrastExponent(pct) {
    return 0.5 + (pct / 100) * 2.0;
  }

  function resolveCharset(charset) {
    return CHARSETS[charset] || (typeof charset === 'string' && charset.length > 0
      ? charset : CHARSETS.classic);
  }

  function mapChar(rawBrightness, charset, contrastExp, gamma) {
    let b = gamma !== 1.0 ? Math.pow(Math.max(0, rawBrightness), 1.0 / gamma) : rawBrightness;
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

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // Main-thread pixel fallback (same algorithm as the Worker).
  function processPixels(data, imgW, imgH, cols, rows) {
    const brightness = new Float32Array(rows * cols);
    const colors     = new Uint8Array(rows * cols * 3);
    const cellW = imgW / cols;
    const cellH = imgH / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor(c * cellW), y0 = Math.floor(r * cellH);
        const x1 = Math.min(Math.ceil((c + 1) * cellW), imgW);
        const y1 = Math.min(Math.ceil((r + 1) * cellH), imgH);
        let lumSum = 0, rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let y = y0; y < y1; y++) {
          for (let x = x0; x < x1; x++) {
            const i  = (y * imgW + x) * 4;
            const a  = data[i + 3] / 255;
            const rv = data[i]     * a + 255 * (1 - a);
            const gv = data[i + 1] * a + 255 * (1 - a);
            const bv = data[i + 2] * a + 255 * (1 - a);
            lumSum += 0.299 * rv + 0.587 * gv + 0.114 * bv;
            rSum += rv; gSum += gv; bSum += bv;
            count++;
          }
        }
        const idx = r * cols + c;
        if (count === 0) {
          brightness[idx] = 1;
          colors[idx * 3] = colors[idx * 3 + 1] = colors[idx * 3 + 2] = 255;
        } else {
          brightness[idx]     = lumSum / count / 255;
          colors[idx * 3]     = Math.round(rSum / count);
          colors[idx * 3 + 1] = Math.round(gSum / count);
          colors[idx * 3 + 2] = Math.round(bSum / count);
        }
      }
    }
    return { rows, cols, brightness, colors };
  }

  // ─── Dithering ─────────────────────────────────────────────────────────────

  // Floyd-Steinberg error diffusion. Returns a new Float32Array — cache is untouched.
  function applyDitherFS(brightness, rows, cols, levels, strength) {
    const grid = new Float32Array(brightness);
    const step = 1 / (levels - 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i   = r * cols + c;
        const old = Math.max(0, Math.min(1, grid[i]));
        const nv  = Math.round(old / step) * step;
        const err = (old - nv) * strength;
        grid[i] = nv;
        if (c + 1 < cols)              grid[i + 1]                  = clamp01(grid[i + 1]                  + err * 7 / 16);
        if (r + 1 < rows) {
          if (c - 1 >= 0)              grid[(r+1)*cols + (c-1)]     = clamp01(grid[(r+1)*cols + (c-1)]     + err * 3 / 16);
                                       grid[(r+1)*cols +  c   ]     = clamp01(grid[(r+1)*cols +  c   ]     + err * 5 / 16);
          if (c + 1 < cols)            grid[(r+1)*cols + (c+1)]     = clamp01(grid[(r+1)*cols + (c+1)]     + err * 1 / 16);
        }
      }
    }
    return grid;
  }

  // Ordered Bayer threshold dithering.
  function applyDitherBayer(brightness, rows, cols, levels, strength) {
    const grid = new Float32Array(brightness);
    const step = 1 / (levels - 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i         = r * cols + c;
        const threshold = (BAYER_4X4[r % 4][c % 4] / 16 - 0.5) * step * strength;
        grid[i] = Math.round(clamp01(grid[i] + threshold) / step) * step;
      }
    }
    return grid;
  }

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  // ─── Color utilities ───────────────────────────────────────────────────────

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if      (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else                h = ((r - g) / d + 4) / 6;
    return [h, s, l];
  }

  function hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    function hue(t) {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    }
    return [Math.round(hue(h + 1/3) * 255), Math.round(hue(h) * 255), Math.round(hue(h - 1/3) * 255)];
  }

  // Adjust RGB saturation (pct 0=mono → 100=full source color).
  function applySaturation(r, g, b, pct) {
    if (pct === 100) return [r, g, b];
    const [h, s, l] = rgbToHsl(r, g, b);
    return hslToRgb(h, s * (pct / 100), l);
  }

  // Blend c1 toward c2 by t (0=c1, 1=c2). Both are [r,g,b] arrays.
  function blendColors(c1, c2, t) {
    const u = 1 - t;
    return [Math.round(c1[0]*u + c2[0]*t), Math.round(c1[1]*u + c2[1]*t), Math.round(c1[2]*u + c2[2]*t)];
  }

  // Resolve var(--ascii-fg, currentColor) to [r,g,b] by probing a temporary element.
  function resolveCSSColor(contextEl) {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    probe.style.color   = 'var(--ascii-fg, currentColor)';
    (contextEl.parentElement || document.body).appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    const m = rgb.match(/\d+/g);
    return m ? [+m[0], +m[1], +m[2]] : [0, 0, 0];
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
      this._ro        = null;
      this._grid      = null;
      this._rendering = null;
    }

    // ── Public API ─────────────────────────────────────────────────────────

    render(imageOrSrc) {
      this._rendering = (this._rendering || Promise.resolve())
        .then(() => this._doRender(imageOrSrc))
        .catch((err) => console.error('[ascii-engine]', err));
      return this._rendering;
    }

    update(newOpts) {
      const prev = this._opts;
      this._opts = this._normalizeOpts(Object.assign({}, prev, newOpts));
      const o = this._opts;

      // Structural params: those that require re-sampling the image.
      // Dithering, color, saturation are render-time — no re-run needed.
      const structural = o.src !== prev.src || o.cols !== prev.cols || o.edgeBlend !== prev.edgeBlend;
      if (structural || !this._grid) {
        return this.render(o.src || prev.src);
      }
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
        src:          raw.src         || '',
        cols:         Math.max(10, Math.min(500, Math.round(cols))),
        charset:      raw.charset     || 'classic',
        renderMode:   raw.renderMode  || 'dom',
        fitMode:      raw.fitMode     || 'width',
        contrast:     raw.contrast    != null ? Number(raw.contrast)    : 50,
        gamma:        raw.gamma       != null ? Number(raw.gamma)       : 1.0,
        glyphAspect:  raw.glyphAspect != null ? Number(raw.glyphAspect) : GLYPH_ASPECT,
        alt:          raw.alt || raw.label || '',
        // Phase 2 — color
        colorMode:    raw.colorMode   || 'theme',     // 'theme' | 'source'
        themeBlend:   raw.themeBlend  != null ? Number(raw.themeBlend)  : 0,   // 0=source, 100=theme
        saturation:   raw.saturation  != null ? Number(raw.saturation)  : 100, // 0=mono, 100=full
        // Phase 2 — dithering (render-time; no cache invalidation)
        dither:       raw.dither      != null ? Number(raw.dither)      : 0,   // 0–1 strength
        ditheringMode:raw.ditheringMode || 'fs',      // 'fs' | 'bayer'
        // Phase 2 — edge (structural; invalidates cache)
        edgeBlend:    raw.edgeBlend   != null ? Number(raw.edgeBlend)   : 0,
        // Phase 3 stub
        seed:         raw.seed        != null ? Number(raw.seed)        : 0,
      };
    }

    async _doRender(imageOrSrc) {
      const opts = this._opts;
      const src  = typeof imageOrSrc === 'string'
        ? imageOrSrc
        : (imageOrSrc && imageOrSrc.src) || opts.src;

      if (!src) throw new Error('[ascii-engine] No image source provided');
      if (!opts.alt) console.warn('[ascii-engine] No alt/label — add the "alt" option for accessibility.', this._el);

      const key = cacheKey(src, opts.cols, opts.edgeBlend);
      let grid;
      if (_gridCache.has(key)) {
        grid = _gridCache.get(key);
      } else {
        const img  = (typeof imageOrSrc === 'string' || !imageOrSrc) ? await loadImage(src) : imageOrSrc;
        const imgW = img.naturalWidth  || img.width;
        const imgH = img.naturalHeight || img.height;
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
      try {
        if (!this._worker) this._worker = makeWorker();
      } catch (_) {
        return Promise.resolve(processPixels(imageData.data, imageData.width, imageData.height, cols, rows));
      }
      return new Promise((resolve, reject) => {
        const copy = new Uint8ClampedArray(imageData.data.buffer.slice(0));
        this._worker.onmessage = (e) => resolve(e.data);
        this._worker.onerror   = () => {
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
      let brightness = grid.brightness;
      if (opts.dither > 0) {
        brightness = opts.ditheringMode === 'bayer'
          ? applyDitherBayer(brightness, grid.rows, grid.cols, charset.length, opts.dither)
          : applyDitherFS   (brightness, grid.rows, grid.cols, charset.length, opts.dither);
      }

      let text = '';
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          text += mapChar(brightness[r * grid.cols + c], charset, exp, opts.gamma);
        }
        if (r < grid.rows - 1) text += '\n';
      }
      this._el.innerHTML = '';
      const pre = document.createElement('pre');
      Object.assign(pre.style, {
        margin: '0', padding: '0', lineHeight: '1em', fontFamily: 'monospace',
        color: 'var(--ascii-fg, currentColor)',
        backgroundColor: 'var(--ascii-bg, transparent)',
      });
      pre.textContent = text;
      this._el.appendChild(pre);
    }

    _renderDOM(grid, opts) {
      const charset = resolveCharset(opts.charset);
      const exp     = contrastExponent(opts.contrast);

      // Dithering — operates on a copy so the cached grid is never mutated.
      let brightness = grid.brightness;
      if (opts.dither > 0) {
        brightness = opts.ditheringMode === 'bayer'
          ? applyDitherBayer(brightness, grid.rows, grid.cols, charset.length, opts.dither)
          : applyDitherFS   (brightness, grid.rows, grid.cols, charset.length, opts.dither);
      }

      // Color setup.
      const useColor  = opts.colorMode === 'source' && grid.colors;
      const blend     = opts.themeBlend / 100;  // 0=pure source, 1=pure theme
      const satPct    = opts.saturation;
      let themeRGB    = null;
      if (useColor && blend > 0) themeRGB = resolveCSSColor(this._el);

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
          const idx = r * grid.cols + c;
          const raw = grid.brightness[idx];  // raw luminance for data-brightness
          const ch  = mapChar(brightness[idx], charset, exp, opts.gamma);
          const sp  = document.createElement('span');
          sp.textContent        = ch;
          sp.dataset.brightness = raw.toFixed(3);
          sp.dataset.cell       = r + ',' + c;

          if (useColor) {
            let cr = grid.colors[idx * 3];
            let cg = grid.colors[idx * 3 + 1];
            let cb = grid.colors[idx * 3 + 2];
            if (satPct !== 100) { [cr, cg, cb] = applySaturation(cr, cg, cb, satPct); }
            if (blend > 0 && themeRGB) { [cr, cg, cb] = blendColors([cr, cg, cb], themeRGB, blend); }
            sp.style.color = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
          }

          row.appendChild(sp);
        }
        frag.appendChild(row);
      }
      this._el.appendChild(frag);
    }

    _applyA11y(opts) {
      this._el.setAttribute('aria-hidden', 'true');
      this._el.style.outline = 'none';

      if (!this._el.id) this._el.id = 'ascii-' + Math.random().toString(36).slice(2, 8);

      const parent = this._el.parentNode;
      if (!parent) return;

      let label = parent.querySelector('.ascii-sr-label[data-for="' + this._el.id + '"]');
      if (opts.alt) {
        if (!label) {
          label = document.createElement('span');
          label.className     = 'ascii-sr-label';
          label.dataset.for   = this._el.id;
          label.setAttribute('role', 'img');
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
      requestAnimationFrame(() => {
        const w = this._el.offsetWidth;
        if (!w || !cols) return;
        const fsize = (w * 100) / (cols * measureCharWidth());
        this._el.style.fontSize   = fsize + 'px';
        this._el.style.lineHeight = '1em';
      });
    }

    _setupResizeObserver(cols) {
      if (this._ro) return;
      const fit = debounce(() => this._fitWidth(cols), 100);
      this._ro = new ResizeObserver(fit);
      this._ro.observe(this._el.parentElement || this._el);
    }
  }

  // Expose globally early so later setup errors can't block access.
  if (typeof window !== 'undefined') window.ASCIIEngine = ASCIIEngine;

  // ─── Declarative attribute API ─────────────────────────────────────────────

  function parseAttrs(el) {
    const config = {};
    const cfgStr = el.getAttribute('data-ascii-config');
    if (cfgStr) {
      try { Object.assign(config, JSON.parse(cfgStr)); }
      catch (_) { console.warn('[ascii-engine] Invalid data-ascii-config JSON on', el); }
    }
    const attrs = {
      'data-ascii-alt':           'alt',
      'data-ascii-label':         'label',
      'data-ascii-preset':        'preset',
      'data-ascii-charset':       'charset',
      'data-ascii-render-mode':   'renderMode',
      'data-ascii-fit-mode':      'fitMode',
      'data-ascii-cols':          'cols',
      'data-ascii-density':       'density',
      'data-ascii-contrast':      'contrast',
      'data-ascii-gamma':         'gamma',
      'data-ascii-color-mode':    'colorMode',
      'data-ascii-theme-blend':   'themeBlend',
      'data-ascii-saturation':    'saturation',
      'data-ascii-dither':        'dither',
      'data-ascii-dithering-mode':'ditheringMode',
      'data-ascii-seed':          'seed',
    };
    for (const [attr, key] of Object.entries(attrs)) {
      if (config[key] != null) continue;
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
      if (el._asciiEngine) return;
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
      setTimeout(initDeclarative, 0);
    }
  }

  // ─── Export ────────────────────────────────────────────────────────────────

  ASCIIEngine.CHARSETS            = CHARSETS;
  ASCIIEngine.GLYPH_ASPECT        = GLYPH_ASPECT;
  ASCIIEngine.init                = initDeclarative;
  ASCIIEngine.clearCache          = () => _gridCache.clear();
  ASCIIEngine.prefersReducedMotion = prefersReducedMotion;
  Object.defineProperty(ASCIIEngine, 'cacheSize', { get: () => _gridCache.size, configurable: true });

  if (typeof module !== 'undefined' && module.exports) module.exports = ASCIIEngine;

}());
