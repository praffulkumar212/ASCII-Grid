/*!
 * ascii-engine.js — v0.3.0 (Phase 3)
 * Phase 1: image → brightness grid → dom/pre render, fitMode, caching, a11y
 * Phase 2: source color, theme mode, themeBlend, saturation, FS + Bayer dithering
 * v0.2.1: FIXES.md 1-6 — density update, live RO cols, measured glyph aspect,
 *         dot-count-ordered braille, Sobel edge blend, tone-before-dither
 * Phase 3: preset system (13 presets, README §9 formulas), seeded noise
 *          animation (mulberry32), glow, ANSI-256 color quantization.
 *          Canonical preset data also lives in presets/presets.json — keep in
 *          sync (enforced by test/engine.test.js).
 * Phase 5 (v0.4.0): hover effects (highlight/ripple/invert/pulse/magnify/
 *          reveal) with transition configs (duration/easing/radius/falloff),
 *          touch-drag support via pointer events + coarse-pointer ambient
 *          fallback, reduced-motion respected. DOM mode only; style-only —
 *          the cached grid and pipeline are never touched.
 */
(function () {
  'use strict';

  // ─── Character sets ────────────────────────────────────────────────────────
  // Ordered light → dark (space = brightest, last char = darkest).

  function popcount(n) { let c = 0; while (n) { n &= n - 1; c++; } return c; }

  // Braille ramp ordered by dot count (perceptual density), not codepoint —
  // FIXES.md #4. Full 8-dot range U+2801–U+28FF, stable-sorted so output is
  // deterministic. Note: true braille dot-matrix rendering (2×4 subpixels per
  // glyph) is a separate technique, tracked for a later phase.
  const BRAILLE_RAMP = ' ' + Array.from({ length: 0xFF }, (_, i) => 0x2801 + i)
    .sort((a, b) => popcount(a - 0x2800) - popcount(b - 0x2800) || a - b)
    .map((cp) => String.fromCharCode(cp))
    .join('');

  const CHARSETS = {
    classic:  ' .:-=+*#%@',
    extended: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    blocks:   ' ░▒▓█',
    braille:  BRAILLE_RAMP,
  };

  const GLYPH_ASPECT = 2.0;

  // 4×4 Bayer threshold matrix (values 0–15, normalised to 0–1 at use time).
  const BAYER_4X4 = [
    [ 0,  8,  2, 10],
    [12,  4, 14,  6],
    [ 3, 11,  1,  9],
    [15,  7, 13,  5],
  ];

  // ─── Presets (Phase 3) ─────────────────────────────────────────────────────
  // Named bundles of options. Attribute % values map to concrete formulas per
  // README §9. Canonical copy: presets/presets.json (test-enforced sync).
  // A preset is a *baseline*: options the user passes explicitly always win.

  const PRESETS = {
    'theme-adaptive': { density: 62, contrast: 50, charset: 'classic',  colorMode: 'theme' },
    'classic-mono':   { density: 55, contrast: 60, charset: 'classic',  colorMode: 'theme', saturation: 0 },
    'matrix-rain':    { density: 70, contrast: 65, charset: 'extended', colorMode: 'theme', fg: '#33ff66', bg: '#020a04', glow: 35, noise: 18, animSpeed: 45, seed: 42 },
    'blueprint':      { density: 65, contrast: 45, charset: ' .:-=+',   colorMode: 'theme', edgeBlend: 0.85, fg: '#dce9ff', bg: '#0d2137' },
    'crt':            { density: 60, contrast: 70, charset: 'classic',  colorMode: 'theme', fg: '#33ff33', bg: '#031103', glow: 55, noise: 4, animSpeed: 20, seed: 7 },
    'halftone':       { density: 58, contrast: 55, charset: ' ·:oO8@',  colorMode: 'theme', dither: 0.9, ditheringMode: 'bayer', saturation: 0 },
    'braille':        { density: 80, contrast: 55, charset: 'braille',  colorMode: 'theme' },
    'blocks':         { density: 45, contrast: 50, charset: 'blocks',   colorMode: 'source', saturation: 90 },
    'line-art':       { density: 65, contrast: 45, charset: ' .:-=+*',  colorMode: 'theme', edgeBlend: 1.0 },
    'cyberpunk':      { density: 68, contrast: 60, charset: 'extended', colorMode: 'source', saturation: 100, glow: 45, fg: '#ff2fd6', bg: '#0a0118', accent: '#22e6ff', noise: 6, animSpeed: 25, seed: 2077 },
    'glitch':         { density: 66, contrast: 55, charset: 'extended', colorMode: 'source', dither: 0.3, noise: 60, animSpeed: 70, seed: 1337 },
    'faded':          { density: 55, contrast: 25, gamma: 1.4, charset: 'classic', colorMode: 'source', saturation: 30, themeBlend: 60 },
    'ansi-256':       { density: 70, contrast: 55, charset: 'classic',  colorMode: 'source', colorQuant: 'ansi256' },
  };

  // ─── Seeded RNG — mulberry32 (README §2: reproducible randomness) ─────────
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ─── ANSI-256 color quantization ───────────────────────────────────────────
  // Snaps RGB to the xterm-256 palette (6×6×6 cube + 24-step gray ramp).
  const ANSI_CUBE = [0, 95, 135, 175, 215, 255];
  function quantizeAnsi256(r, g, b) {
    const snap = (v) => {
      let best = ANSI_CUBE[0];
      for (const lv of ANSI_CUBE) if (Math.abs(lv - v) < Math.abs(best - v)) best = lv;
      return best;
    };
    const cr = snap(r), cg = snap(g), cb = snap(b);
    const cubeDist = (cr-r)*(cr-r) + (cg-g)*(cg-g) + (cb-b)*(cb-b);
    let gi = Math.round(((r + g + b) / 3 - 8) / 10);
    gi = Math.max(0, Math.min(23, gi));
    const gv = 8 + gi * 10;
    const grayDist = (gv-r)*(gv-r) + (gv-g)*(gv-g) + (gv-b)*(gv-b);
    return grayDist < cubeDist ? [gv, gv, gv] : [cr, cg, cb];
  }

  // ─── Hover effects (Phase 5, README §8) ────────────────────────────────────

  const HOVER_EFFECTS = ['highlight', 'ripple', 'invert', 'pulse', 'magnify', 'reveal'];

  // Weight 0–1 for a cell at distance d (in column units) from the cursor.
  function falloffWeight(d, radius, mode) {
    if (d > radius) return 0;
    if (mode === 'none') return 1;
    const x = radius === 0 ? 0 : d / radius;
    if (mode === 'linear') return 1 - x;
    return 0.5 + 0.5 * Math.cos(Math.PI * x); // 'smooth' (cosine)
  }

  function resolveAccent(el) {
    try {
      const v = getComputedStyle(el).getPropertyValue('--ascii-accent');
      if (v && v.trim()) return v.trim();
    } catch (_) { /* no CSSOM (tests) */ }
    return '#4f8cff';
  }

  let _hoverStylesInjected = false;
  function ensureHoverStyles() {
    if (_hoverStylesInjected || typeof document === 'undefined' || !document.head) return;
    const st = document.createElement('style');
    st.id = 'ascii-engine-hover-styles';
    st.textContent = '@keyframes ascii-pulse{0%,100%{opacity:1}50%{opacity:.45}}';
    document.head.appendChild(st);
    _hoverStylesInjected = true;
  }

  function coarsePointer() {
    return !!(typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(pointer: coarse)').matches);
  }

  // README §9 formulas for animated effects.
  function noiseProbability(noisePct) { return (noisePct / 100) * 0.35; }
  function tickInterval(animSpeedPct) {
    if (!(animSpeedPct > 0)) return Infinity;
    return Math.max(60, Math.round(1000 - (animSpeedPct / 100) * 940)); // 100% → 60ms
  }
  function glowShadow(glowPct) {
    if (!(glowPct > 0)) return '';
    const blur = (glowPct / 100) * 12;
    let s = '0 0 ' + blur.toFixed(1) + 'px currentColor';
    if (glowPct > 60) s += ', 0 0 ' + (blur * 2).toFixed(1) + 'px currentColor'; // layered ×2 above 60%
    return s;
  }

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

  // Transfer brightness (performance-critical Float32Array); clone colors to
  // avoid a Safari bug where the second transferred buffer arrives zeroed.
  self.postMessage(
    { rows: rows, cols: cols, brightness: brightness, colors: colors },
    [brightness.buffer]
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
  // Key: src|cols|edgeBlend|glyphAspect (aspect affects row count — FIXES.md #3)
  // Dithering, color mode, saturation are render-time — they never invalidate the grid.

  const _gridCache = new Map();

  function cacheKey(src, cols, edgeBlend, glyphAspect) {
    return src + '|' + cols + '|' + (+edgeBlend).toFixed(2) + '|' + (+glyphAspect).toFixed(3);
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

  // Gamma + contrast tone curve, separated from mapChar so dithering can run on
  // post-tone values (FIXES.md #6) — error diffusion must land on charset levels.
  function toneValue(rawBrightness, contrastExp, gamma) {
    let b = gamma !== 1.0 ? Math.pow(Math.max(0, rawBrightness), 1.0 / gamma) : rawBrightness;
    return Math.pow(Math.max(0, Math.min(1, b)), contrastExp);
  }

  function mapChar(rawBrightness, charset, contrastExp, gamma) {
    const b = toneValue(rawBrightness, contrastExp, gamma);
    const idx = Math.round((1 - b) * (charset.length - 1));
    return charset[Math.max(0, Math.min(charset.length - 1, idx))];
  }

  // Applies tone curve then dithers — returns a new array, cache untouched.
  function toneAndDither(brightness, rows, cols, levels, opts) {
    const exp   = contrastExponent(opts.contrast);
    const toned = new Float32Array(brightness.length);
    for (let i = 0; i < brightness.length; i++) toned[i] = toneValue(brightness[i], exp, opts.gamma);
    return opts.ditheringMode === 'bayer'
      ? applyDitherBayer(toned, rows, cols, levels, opts.dither)
      : applyDitherFS   (toned, rows, cols, levels, opts.dither);
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

  function definedOnly(o) {
    const r = {};
    for (const k in o) if (o[k] !== undefined) r[k] = o[k];
    return r;
  }

  let _glyphMetricsCache = null;
  function measureGlyphMetrics() {
    if (_glyphMetricsCache) return _glyphMetricsCache;
    const span = document.createElement('span');
    Object.assign(span.style, {
      position: 'absolute', top: '-9999px', left: '-9999px',
      visibility: 'hidden', fontFamily: 'monospace',
      fontSize: '100px', whiteSpace: 'pre', lineHeight: '1em',
    });
    span.textContent = '0';
    document.body.appendChild(span);
    _glyphMetricsCache = { width: span.offsetWidth, height: span.offsetHeight };
    document.body.removeChild(span);
    return _glyphMetricsCache;
  }

  function measureCharWidth() { return measureGlyphMetrics().width; }

  // Real rendered cell aspect (line-height / char width) — FIXES.md #3.
  // Hardcoded 2.0 squashed output ~17%; typical monospace is ≈1.67.
  function measureGlyphAspect() {
    try {
      const m = measureGlyphMetrics();
      if (!m.width || !m.height) return GLYPH_ASPECT;
      const a = m.height / m.width;
      return (a > 0.5 && a < 4) ? a : GLYPH_ASPECT;
    } catch (_) {
      return GLYPH_ASPECT;
    }
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

  // ─── Edge detection (Sobel) — FIXES.md #5 ──────────────────────────────────
  // Blends the brightness grid toward inverted edge magnitude: edges → dark
  // glyphs, flat areas → space. amount 0..1 (README §9: Sobel layer opacity).

  function normalizeEdgeBlend(e) {
    e = +e || 0;
    if (e > 1) e = e / 100; // accept percentages defensively
    return clamp01(e);
  }

  function applyEdgeBlend(brightness, rows, cols, amount) {
    const out = new Float32Array(brightness.length);
    const get = (r, c) => brightness[
      Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
    ];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const gx = (get(r-1,c+1) + 2*get(r,c+1) + get(r+1,c+1))
                 - (get(r-1,c-1) + 2*get(r,c-1) + get(r+1,c-1));
        const gy = (get(r+1,c-1) + 2*get(r+1,c) + get(r+1,c+1))
                 - (get(r-1,c-1) + 2*get(r-1,c) + get(r-1,c+1));
        // Max |gx| is 4 on a 0-1 grid; ×1.5 boost so single-step edges read clearly.
        const mag = clamp01(Math.sqrt(gx*gx + gy*gy) / 4 * 1.5);
        out[r*cols + c] = (1 - amount) * brightness[r*cols + c] + amount * (1 - mag);
      }
    }
    return out;
  }

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
      // _userOpts holds only what the user explicitly set — presets are a
      // baseline underneath it, so switching presets never leaks old preset
      // values (Phase 3).
      this._userOpts  = definedOnly(opts);
      this._opts      = this._resolveOpts();
      this._worker    = null;
      this._ro        = null;
      this._grid      = null;
      this._rendering = null;
      this._fx        = null;   // noise animation interval
      this._rng       = null;
      this._spans     = null;   // dom-mode glyph spans (for effects)
      this._preEl     = null;   // pre-mode element + base text (for effects)
      this._baseText  = null;
      this._corrupted = null;
      this._hoverSaved    = null;   // Phase 5 hover state
      this._hoverHandlers = null;
      this._rippleTimers  = null;
      this._ambient       = null;
    }

    // preset baseline ← user overrides → normalized opts
    _resolveOpts() {
      const user = this._userOpts;
      let preset = {};
      if (user.preset != null) {
        preset = PRESETS[user.preset];
        if (!preset) {
          console.warn('[ascii-engine] Unknown preset "' + user.preset + '" — using defaults.');
          preset = {};
        }
      }
      return this._normalizeOpts(Object.assign({}, preset, user));
    }

    // ── Public API ─────────────────────────────────────────────────────────

    render(imageOrSrc) {
      this._rendering = (this._rendering || Promise.resolve())
        .then(() => this._doRender(imageOrSrc))
        .catch((err) => console.error('[ascii-engine]', err));
      return this._rendering;
    }

    update(newOpts) {
      newOpts = definedOnly(newOpts || {});
      const prev = this._opts;
      // FIXES.md #1: a previously *computed* cols must not shadow an incoming
      // density. If density changes without an explicit cols, drop stored cols.
      if (newOpts.density != null && newOpts.cols == null) delete this._userOpts.cols;
      // Same principle for preset switches: a new preset's density should win
      // over a cols that an older preset's density produced.
      if (newOpts.preset != null && newOpts.preset !== this._userOpts.preset && newOpts.cols == null) {
        delete this._userOpts.cols;
      }
      Object.assign(this._userOpts, newOpts);
      this._opts = this._resolveOpts();
      const o = this._opts;

      // Structural params: those that require re-sampling the image.
      // Dithering, color, saturation, glow, noise are render-time — no re-run.
      const structural = o.src !== prev.src || o.cols !== prev.cols || o.edgeBlend !== prev.edgeBlend;
      if (structural || !this._grid) {
        return this.render(o.src || prev.src);
      }
      this._paint(this._grid, o);
      this._applyA11y(o);
      if (o.fitMode === 'width') this._fitWidth(this._grid.cols);
      this._startEffects();
      return Promise.resolve(this);
    }

    destroy() {
      this._stopEffects();
      this._teardownHover();
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._ro)     { this._ro.disconnect();    this._ro = null; }
      this._el.innerHTML = '';
      this._grid = null;
      this._spans = null; this._preEl = null; this._baseText = null;
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
        glyphAspect:  raw.glyphAspect != null
          ? Number(raw.glyphAspect)
          : (typeof document !== 'undefined' && document.body ? measureGlyphAspect() : GLYPH_ASPECT),
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
        // Phase 3 — presets & effects (all render/style-time)
        preset:       raw.preset      || null,
        seed:         raw.seed        != null ? Number(raw.seed)        : 0,
        glow:         raw.glow        != null ? Math.max(0, Math.min(100, Number(raw.glow)))      : 0,
        noise:        raw.noise       != null ? Math.max(0, Math.min(100, Number(raw.noise)))     : 0,
        animSpeed:    raw.animSpeed   != null ? Math.max(0, Math.min(100, Number(raw.animSpeed))) : 0,
        colorQuant:   raw.colorQuant  || 'none',   // 'none' | 'ansi256'
        fg:           raw.fg          || null,     // preset color overrides →
        bg:           raw.bg          || null,     //   set as inline --ascii-* vars
        accent:       raw.accent      || null,
        // Phase 5 — hover (render-time; DOM mode only)
        hoverEffect:   (function (h) {
          if (!h || h === 'none') return null;
          if (HOVER_EFFECTS.indexOf(h) === -1) {
            console.warn('[ascii-engine] Unknown hoverEffect "' + h + '"'); return null;
          }
          return h;
        })(raw.hoverEffect),
        hoverRadius:   raw.hoverRadius   != null ? Math.max(1, Math.min(20, Number(raw.hoverRadius))) : 4,
        hoverDuration: raw.hoverDuration != null ? Math.max(0, Number(raw.hoverDuration)) : 150,
        hoverEasing:   raw.hoverEasing   || 'ease-out',
        hoverFalloff:  ['none', 'linear', 'smooth'].indexOf(raw.hoverFalloff) !== -1 ? raw.hoverFalloff : 'smooth',
      };
    }

    async _doRender(imageOrSrc) {
      const opts = this._opts;
      const src  = typeof imageOrSrc === 'string'
        ? imageOrSrc
        : (imageOrSrc && imageOrSrc.src) || opts.src;

      if (!src) throw new Error('[ascii-engine] No image source provided');
      if (!opts.alt) console.warn('[ascii-engine] No alt/label — add the "alt" option for accessibility.', this._el);

      const edge = normalizeEdgeBlend(opts.edgeBlend);
      const key  = cacheKey(src, opts.cols, edge, opts.glyphAspect);
      let grid;
      if (_gridCache.has(key)) {
        grid = _gridCache.get(key);
      } else {
        const img  = (typeof imageOrSrc === 'string' || !imageOrSrc) ? await loadImage(src) : imageOrSrc;
        const imgW = img.naturalWidth  || img.width;
        const imgH = img.naturalHeight || img.height;
        const rows = Math.max(1, Math.round(opts.cols * (imgH / imgW) / opts.glyphAspect));
        grid = await this._runWorker(getImageData(img), opts.cols, rows);
        // FIXES.md #5: Sobel edge blend — structural, baked into the cached
        // grid (edge amount is part of the cache key, so entries stay coherent).
        if (edge > 0) {
          grid = {
            rows: grid.rows, cols: grid.cols, colors: grid.colors,
            brightness: applyEdgeBlend(grid.brightness, grid.rows, grid.cols, edge),
          };
        }
        _gridCache.set(key, grid);
      }

      this._grid = grid;
      this._paint(grid, opts);
      this._applyA11y(opts);
      if (opts.fitMode === 'width') {
        this._fitWidth(grid.cols);
        this._setupResizeObserver();
      }
      this._startEffects();
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
      this._stopEffects();    // repaint invalidates span refs / base text
      this._teardownHover();
      if (opts.renderMode === 'pre') {
        this._renderPre(grid, opts);
      } else {
        this._renderDOM(grid, opts);
      }
      this._applyEffectStyles(opts);
      this._setupHover();
    }

    // Glow (README §9: text-shadow 0 0 pct×12px currentColor, layered ×2 >60%)
    // + preset color overrides as inline --ascii-* CSS vars, so theme mode and
    // hover effects (Phase 5, --ascii-accent) keep working unchanged.
    _applyEffectStyles(opts) {
      this._el.style.textShadow = glowShadow(opts.glow);
      if (this._el.style.setProperty) {
        if (opts.fg)     this._el.style.setProperty('--ascii-fg', opts.fg);
        if (opts.bg)     this._el.style.setProperty('--ascii-bg', opts.bg);
        if (opts.accent) this._el.style.setProperty('--ascii-accent', opts.accent);
      }
    }

    _renderPre(grid, opts) {
      const charset  = resolveCharset(opts.charset);
      // FIXES.md #6: tone (gamma+contrast) is applied *before* dithering so
      // error diffusion lands on charset levels; mapChar then runs neutral.
      const dithered = opts.dither > 0;
      const exp      = dithered ? 1.0 : contrastExponent(opts.contrast);
      const gamma    = dithered ? 1.0 : opts.gamma;
      const brightness = dithered
        ? toneAndDither(grid.brightness, grid.rows, grid.cols, charset.length, opts)
        : grid.brightness;

      let text = '';
      for (let r = 0; r < grid.rows; r++) {
        for (let c = 0; c < grid.cols; c++) {
          text += mapChar(brightness[r * grid.cols + c], charset, exp, gamma);
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
      this._preEl = pre; this._baseText = text; this._spans = null;
    }

    _renderDOM(grid, opts) {
      const charset  = resolveCharset(opts.charset);
      // FIXES.md #6: tone before dither (see _renderPre). Copy-on-write — the
      // cached grid is never mutated.
      const dithered = opts.dither > 0;
      const exp      = dithered ? 1.0 : contrastExponent(opts.contrast);
      const gamma    = dithered ? 1.0 : opts.gamma;
      const brightness = dithered
        ? toneAndDither(grid.brightness, grid.rows, grid.cols, charset.length, opts)
        : grid.brightness;

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

      const frag  = document.createDocumentFragment();
      const spans = [];
      for (let r = 0; r < grid.rows; r++) {
        const row = document.createElement('div');
        Object.assign(row.style, { display: 'block', whiteSpace: 'pre', lineHeight: '1em' });

        for (let c = 0; c < grid.cols; c++) {
          const idx = r * grid.cols + c;
          const raw = grid.brightness[idx];  // raw luminance for data-brightness
          const ch  = mapChar(brightness[idx], charset, exp, gamma);
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
            if (opts.colorQuant === 'ansi256') { [cr, cg, cb] = quantizeAnsi256(cr, cg, cb); }
            sp.style.color = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
          }

          spans.push(sp);
          row.appendChild(sp);
        }
        frag.appendChild(row);
      }
      this._el.appendChild(frag);
      this._spans = spans; this._preEl = null; this._baseText = null;
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

    // ── Noise animation (Phase 3) ──────────────────────────────────────────
    // Seeded, reproducible glyph corruption (README §9: per-tick cell-flip
    // probability 0→0.35). Style-only — the cached grid and pipeline are never
    // touched. Under prefers-reduced-motion the static clean frame stays
    // (README §6: animated presets render their static final frame).

    _startEffects() {
      this._stopEffects();
      const o = this._opts;
      if (!(o.noise > 0) || prefersReducedMotion()) return;
      const interval = tickInterval(o.animSpeed);
      if (!isFinite(interval) || typeof setInterval === 'undefined') return;
      this._rng = mulberry32(o.seed || 0);
      this._fx  = setInterval(() => this._noiseTick(), interval);
    }

    _stopEffects() {
      if (this._fx) { clearInterval(this._fx); this._fx = null; }
      this._restoreNoise();
    }

    _restoreNoise() {
      if (this._corrupted) {
        for (const { el, ch } of this._corrupted) el.textContent = ch;
        this._corrupted = null;
      }
      if (this._preEl && this._baseText != null) this._preEl.textContent = this._baseText;
    }

    _noiseTick() {
      const o = this._opts;
      const p = noiseProbability(o.noise);
      const charset = resolveCharset(o.charset);
      const rng = this._rng || (this._rng = mulberry32(o.seed || 0));
      this._restoreNoise();

      if (this._spans) {
        const corrupted = [];
        for (const sp of this._spans) {
          if (rng() < p) {
            corrupted.push({ el: sp, ch: sp.textContent });
            sp.textContent = charset[(rng() * charset.length) | 0];
          }
        }
        this._corrupted = corrupted;
      } else if (this._preEl && this._baseText != null) {
        const chars = this._baseText.split('');
        for (let i = 0; i < chars.length; i++) {
          if (chars[i] !== '\n' && rng() < p) chars[i] = charset[(rng() * charset.length) | 0];
        }
        this._preEl.textContent = chars.join('');
      }
    }

    _setupResizeObserver() {
      if (this._ro) return;
      // FIXES.md #2: read cols from the live grid at fire time — a captured
      // cols goes stale after structural updates (density/cols changes).
      const fit = debounce(() => { if (this._grid) this._fitWidth(this._grid.cols); }, 100);
      this._ro = new ResizeObserver(fit);
      this._ro.observe(this._el.parentElement || this._el);
    }

    // ── Hover system (Phase 5) ─────────────────────────────────────────────
    // Pure CSS/JS on top of day-one data-cell attrs — zero pipeline changes.
    // Pointer events cover mouse AND touch-drag (README §8 touch fallback);
    // coarse-pointer devices additionally get a slow ambient auto-animation,
    // skipped under prefers-reduced-motion.

    _setupHover() {
      const o = this._opts;
      if (!o.hoverEffect || o.renderMode === 'pre' || !this._spans) return;
      ensureHoverStyles();
      this._hoverSaved = new Map();   // span → snapshot of mutated style props
      this._rippleTimers = [];

      if (o.hoverEffect === 'reveal') {
        for (const sp of this._spans) sp.style.opacity = '0.15';
      }

      if (this._el.addEventListener) {
        const onMove = (e) => {
          const cell = e.target && e.target.dataset && e.target.dataset.cell;
          if (!cell) return;
          const rc = cell.split(',');
          if (o.hoverEffect === 'ripple') return; // ripple is press-driven
          this._hoverAt(+rc[1], +rc[0]);
        };
        const onLeave = () => this._hoverClear();
        const onDown = (e) => {
          if (o.hoverEffect !== 'ripple') return;
          const cell = e.target && e.target.dataset && e.target.dataset.cell;
          if (!cell) return;
          const rc = cell.split(',');
          this._rippleAt(+rc[1], +rc[0]);
        };
        this._el.addEventListener('pointermove', onMove);
        this._el.addEventListener('pointerleave', onLeave);
        this._el.addEventListener('pointerdown', onDown);
        this._hoverHandlers = { onMove, onLeave, onDown };
      }
      this._startAmbient();
    }

    _teardownHover() {
      if (this._ambient) { clearInterval(this._ambient); this._ambient = null; }
      if (this._rippleTimers) { this._rippleTimers.forEach(clearTimeout); this._rippleTimers = null; }
      this._hoverClear();
      if (this._hoverHandlers && this._el.removeEventListener) {
        this._el.removeEventListener('pointermove',  this._hoverHandlers.onMove);
        this._el.removeEventListener('pointerleave', this._hoverHandlers.onLeave);
        this._el.removeEventListener('pointerdown',  this._hoverHandlers.onDown);
      }
      this._hoverHandlers = null;
      // undo reveal base state
      if (this._opts && this._opts.hoverEffect === 'reveal' && this._spans) {
        for (const sp of this._spans) sp.style.opacity = '';
      }
      this._hoverSaved = null;
    }

    _saveSpan(sp) {
      if (!this._hoverSaved.has(sp)) {
        this._hoverSaved.set(sp, {
          color: sp.style.color || '', opacity: sp.style.opacity || '',
          transform: sp.style.transform || '', filter: sp.style.filter || '',
          animation: sp.style.animation || '', display: sp.style.display || '',
        });
        const o = this._opts;
        sp.style.transition = ['color', 'opacity', 'transform', 'filter']
          .map((p) => p + ' ' + o.hoverDuration + 'ms ' + o.hoverEasing).join(', ');
      }
    }

    _hoverClear() {
      if (!this._hoverSaved) return;
      for (const [sp, s] of this._hoverSaved) {
        sp.style.color = s.color; sp.style.opacity = s.opacity;
        sp.style.transform = s.transform; sp.style.filter = s.filter;
        sp.style.animation = s.animation; sp.style.display = s.display;
      }
      this._hoverSaved.clear();
    }

    // Apply the configured effect centred on cell (c0, r0).
    _hoverAt(c0, r0) {
      const o = this._opts, grid = this._grid;
      if (!grid || !this._spans || !this._hoverSaved) return;
      this._hoverClear();
      const accent = resolveAccent(this._el);
      const radius = o.hoverRadius;
      const aspect = o.glyphAspect || GLYPH_ASPECT; // rows are ~aspect× taller than cols
      const rSpan  = Math.ceil(radius / aspect) + 1;

      for (let r = Math.max(0, r0 - rSpan); r <= Math.min(grid.rows - 1, r0 + rSpan); r++) {
        for (let c = Math.max(0, c0 - radius); c <= Math.min(grid.cols - 1, c0 + radius); c++) {
          const dx = c - c0, dy = (r - r0) * aspect;
          const t = falloffWeight(Math.sqrt(dx * dx + dy * dy), radius, o.hoverFalloff);
          if (t <= 0) continue;
          const sp = this._spans[r * grid.cols + c];
          if (!sp) continue;
          this._saveSpan(sp);
          this._applyHoverStyle(sp, t, accent);
        }
      }
    }

    _applyHoverStyle(sp, t, accent) {
      switch (this._opts.hoverEffect) {
        case 'highlight':
          sp.style.color = accent;
          sp.style.opacity = (0.55 + 0.45 * t).toFixed(2);
          break;
        case 'invert':
          sp.style.filter = 'invert(' + t.toFixed(2) + ')';
          break;
        case 'pulse':
          sp.style.color = accent;
          sp.style.animation = 'ascii-pulse ' + (this._opts.hoverDuration * 4) + 'ms ease-in-out infinite';
          break;
        case 'magnify':
          sp.style.display = 'inline-block';
          sp.style.transform = 'scale(' + (1 + 0.6 * t).toFixed(2) + ')';
          break;
        case 'reveal':
          sp.style.opacity = (0.15 + 0.85 * t).toFixed(2);
          break;
        case 'ripple': // handled by _rippleAt; treat stray calls as highlight
          sp.style.color = accent;
          break;
      }
    }

    // Expanding ring: accent flash reaches each cell after a distance-
    // proportional delay, then restores.
    _rippleAt(c0, r0) {
      const o = this._opts, grid = this._grid;
      if (!grid || !this._spans || prefersReducedMotion()) return;
      const accent = resolveAccent(this._el);
      const radius = o.hoverRadius * 2; // rings read better a bit wider
      const aspect = o.glyphAspect || GLYPH_ASPECT;
      const perCell = Math.max(20, o.hoverDuration / radius);
      const rSpan = Math.ceil(radius / aspect) + 1;

      for (let r = Math.max(0, r0 - rSpan); r <= Math.min(grid.rows - 1, r0 + rSpan); r++) {
        for (let c = Math.max(0, c0 - radius); c <= Math.min(grid.cols - 1, c0 + radius); c++) {
          const dx = c - c0, dy = (r - r0) * aspect;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius) continue;
          const sp = this._spans[r * grid.cols + c];
          if (!sp) continue;
          const delay = Math.round(d * perCell);
          this._rippleTimers.push(setTimeout(() => {
            this._saveSpan(sp);
            sp.style.color = accent;
            this._rippleTimers.push(setTimeout(() => {
              const s = this._hoverSaved && this._hoverSaved.get(sp);
              if (s) { sp.style.color = s.color; this._hoverSaved.delete(sp); }
            }, o.hoverDuration));
          }, delay));
        }
      }
    }

    // Coarse-pointer (touch) fallback: a slow Lissajous drift of the virtual
    // cursor. Skipped under prefers-reduced-motion (README §8).
    _startAmbient() {
      if (this._ambient) return;
      const o = this._opts;
      if (!coarsePointer() || prefersReducedMotion() || o.hoverEffect === 'ripple') return;
      if (typeof setInterval === 'undefined') return;
      let t = 0;
      this._ambient = setInterval(() => {
        const g = this._grid;
        if (!g) return;
        t += 0.045;
        const c = Math.round(g.cols / 2 + Math.cos(t) * g.cols * 0.35);
        const r = Math.round(g.rows / 2 + Math.sin(t * 1.7) * g.rows * 0.35);
        this._hoverAt(c, r);
      }, 120);
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
      'data-ascii-edge-blend':    'edgeBlend',
      'data-ascii-glow':          'glow',
      'data-ascii-noise':         'noise',
      'data-ascii-anim-speed':    'animSpeed',
      'data-ascii-color-quant':   'colorQuant',
      'data-ascii-fg':            'fg',
      'data-ascii-bg':            'bg',
      'data-ascii-accent':        'accent',
      'data-ascii-hover':         'hoverEffect',
      'data-ascii-hover-radius':  'hoverRadius',
      'data-ascii-hover-duration':'hoverDuration',
      'data-ascii-hover-easing':  'hoverEasing',
      'data-ascii-hover-falloff': 'hoverFalloff',
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

  ASCIIEngine.PRESETS = PRESETS;
  ASCIIEngine.HOVER_EFFECTS = HOVER_EFFECTS.slice();

  // Internals exposed for the test harness only — not public API.
  ASCIIEngine._internals = {
    applyEdgeBlend, normalizeEdgeBlend, measureGlyphAspect, toneValue,
    toneAndDither, popcount, densityToCols,
    mulberry32, quantizeAnsi256, noiseProbability, tickInterval, glowShadow,
    falloffWeight, resolveAccent,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ASCIIEngine;

}());
