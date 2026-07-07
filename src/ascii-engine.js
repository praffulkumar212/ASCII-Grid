/*!
 * ascii-engine.js — v0.5.2
 * Phase 1: image → brightness grid → dom/pre render, fitMode, caching, a11y
 * Phase 2: source color, theme mode, themeBlend, saturation, FS + Bayer dithering
 * v0.2.1: FIXES.md 1-6 — density update, live RO cols, measured glyph aspect,
 *         dot-count-ordered braille, Sobel edge blend, tone-before-dither
 * Phase 3: preset system (13 presets, PLAN.md §9 formulas), seeded noise
 *          animation (mulberry32), glow, ANSI-256 color quantization.
 *          Canonical preset data also lives in presets/presets.json — keep in
 *          sync (enforced by test/engine.test.js).
 * Phase 5 (v0.4.0): hover effects (highlight/ripple/invert/pulse/magnify/
 *          reveal) with transition configs (duration/easing/radius/falloff),
 *          touch-drag support via pointer events + coarse-pointer ambient
 *          fallback, reduced-motion respected. DOM mode only; style-only —
 *          the cached grid and pipeline are never touched.
 * Phase 6 (v0.5.0): entrance animations (typing/fade via IntersectionObserver,
 *          PLAN.md §11), canvas render mode for large/animated grids (hover =
 *          highlight semantics via hit-testing), perf: in-place span patching
 *          on non-structural repaints, O(k) noise sampling, rAF-coalesced
 *          hover, >10k-glyph dom warning.
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
  // PLAN.md §9. Canonical copy: presets/presets.json (test-enforced sync).
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

  // ─── Seeded RNG — mulberry32 (PLAN.md §2: reproducible randomness) ─────────
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

  // ─── Hover effects (Phase 5, PLAN.md §8) ────────────────────────────────────

  const HOVER_EFFECTS = ['highlight', 'ripple', 'invert', 'pulse', 'magnify', 'reveal'];

  // Weight 0–1 for a cell at distance d (in column units) from the cursor.
  function falloffWeight(d, radius, mode) {
    if (d > radius) return 0;
    if (mode === 'none') return 1;
    const x = radius === 0 ? 0 : d / radius;
    if (mode === 'linear') return 1 - x;
    return 0.5 + 0.5 * Math.cos(Math.PI * x); // 'smooth' (cosine)
  }

  // FIXES.md #8: hover radius scales with the image. Accepts 'N%' (of cols,
  // the default — '25%') or an absolute cell count. Resolved against the live
  // grid at hover time, so density changes keep it proportional.
  function effectiveHoverRadius(hoverRadius, cols) {
    if (typeof hoverRadius === 'string') {
      const m = hoverRadius.match(/^([\d.]+)\s*%$/);
      if (m) return Math.max(1, Math.round(cols * Math.min(100, parseFloat(m[1])) / 100));
      const n = parseFloat(hoverRadius);
      if (!isNaN(n)) return Math.max(1, Math.round(n));
      return Math.max(1, Math.round(cols * 0.25));
    }
    return Math.max(1, Math.round(hoverRadius));
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

  // PLAN.md §9 formulas for animated effects.
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
  // glyphs, flat areas → space. amount 0..1 (PLAN.md §9: Sobel layer opacity).

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
      this._pendingHover  = null;
      this._hoverRaf      = null;
      this._canvasMeta    = null;   // Phase 6 canvas render state
      this._canvasHoverPrev = null;
      this._paintGrid     = null;
      this._io            = null;   // Phase 6 entrance observer
      this._entranceRaf   = null;
      this._warnedSize    = false;
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
      this._teardownEntrance();
      if (this._worker) { this._worker.terminate(); this._worker = null; }
      if (this._ro)     { this._ro.disconnect();    this._ro = null; }
      this._el.innerHTML = '';
      this._grid = null;
      this._spans = null; this._preEl = null; this._baseText = null;
      this._canvasMeta = null; this._canvasHoverPrev = null; this._paintGrid = null;
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
        // FIXES.md #8: relative by default ('25%' of cols); explicit numbers
        // are respected as absolute cells. Resolved at hover time.
        hoverRadius:   raw.hoverRadius != null
          ? (typeof raw.hoverRadius === 'string' ? raw.hoverRadius : Math.max(1, Number(raw.hoverRadius)))
          : '25%',
        hoverDuration: raw.hoverDuration != null ? Math.max(0, Number(raw.hoverDuration)) : 150,
        hoverEasing:   raw.hoverEasing   || 'ease-out',
        hoverFalloff:  ['none', 'linear', 'smooth'].indexOf(raw.hoverFalloff) !== -1 ? raw.hoverFalloff : 'smooth',
        // Phase 6 — entrance animations (PLAN.md §11)
        entrance:      ['typing', 'fade'].indexOf(raw.entrance) !== -1 ? raw.entrance : null,
        entranceDuration: raw.entranceDuration != null ? Math.max(0, Number(raw.entranceDuration)) : 900,
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
      this._teardownEntrance();
      if (opts.renderMode === 'pre') {
        this._renderPre(grid, opts);
      } else if (opts.renderMode === 'canvas') {
        this._renderCanvas(grid, opts);
      } else {
        this._renderDOM(grid, opts);
      }
      this._applyEffectStyles(opts);
      this._setupHover();
      this._setupEntrance();
    }

    // ── Canvas render mode (Phase 6) ───────────────────────────────────────
    // Opt-in for large/animated grids (PLAN.md §4): one draw call per cell, no
    // DOM nodes. Hover is supported via coordinate hit-testing (highlight
    // semantics for all effects except ripple). Glow via ctx.shadowBlur.
    _renderCanvas(grid, opts) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext && canvas.getContext('2d');
      if (!ctx) {
        console.warn('[ascii-engine] canvas 2d context unavailable — falling back to pre mode.');
        return this._renderPre(grid, opts);
      }
      const charset  = resolveCharset(opts.charset);
      const dithered = opts.dither > 0;
      const exp      = dithered ? 1.0 : contrastExponent(opts.contrast);
      const gamma    = dithered ? 1.0 : opts.gamma;
      const brightness = dithered
        ? toneAndDither(grid.brightness, grid.rows, grid.cols, charset.length, opts)
        : grid.brightness;

      const scale = 2; // crisp on hidpi
      const cw = 8 * scale, ch = Math.round(8 * (opts.glyphAspect || GLYPH_ASPECT)) * scale;
      canvas.width  = grid.cols * cw;
      canvas.height = grid.rows * ch;
      canvas.style.width = '100%';
      canvas.style.display = 'block';

      const useColor = opts.colorMode === 'source' && grid.colors;
      const blend    = opts.themeBlend / 100;
      const satPct   = opts.saturation;
      let themeRGB   = null;
      if (useColor && blend > 0) themeRGB = resolveCSSColor(this._el);
      let fg = '#888';
      try { fg = getComputedStyle(this._el).color || fg; } catch (_) {}

      const chars  = new Array(grid.rows * grid.cols);
      const colors = new Array(grid.rows * grid.cols);
      for (let i = 0; i < chars.length; i++) {
        chars[i] = mapChar(brightness[i], charset, exp, gamma);
        if (useColor) {
          let cr = grid.colors[i*3], cg = grid.colors[i*3+1], cb = grid.colors[i*3+2];
          if (satPct !== 100) { [cr, cg, cb] = applySaturation(cr, cg, cb, satPct); }
          if (blend > 0 && themeRGB) { [cr, cg, cb] = blendColors([cr, cg, cb], themeRGB, blend); }
          if (opts.colorQuant === 'ansi256') { [cr, cg, cb] = quantizeAnsi256(cr, cg, cb); }
          colors[i] = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
        } else {
          colors[i] = fg;
        }
      }

      const bg = opts.bg || null;
      // Calibrate the font so the glyph advance fills the cell pitch. A naive
      // "fontSize < cellWidth" leaves ~50% of every cell empty → sparse,
      // washed-out art (QA finding: "canvas colors are very dull").
      ctx.font = '100px monospace';
      const adv100 = ctx.measureText('0').width || 60;   // advance at 100px
      const fontPx = Math.min(Math.floor(cw * 100 / adv100), ch);
      ctx.font = fontPx + 'px monospace';
      ctx.textBaseline = 'top';
      const yOff = Math.max(0, (ch - fontPx) / 2);
      const glowBlur = opts.glow > 0 ? (opts.glow / 100) * 12 * scale : 0;
      if (glowBlur) { ctx.shadowColor = fg; ctx.shadowBlur = glowBlur; }

      const meta = {
        canvas, ctx, cw, ch, cols: grid.cols, rows: grid.rows, chars, colors, bg,
        yOff, glowBlur, useColor,
        drawCell(i, chOverride, colorOverride) {
          const r = (i / this.cols) | 0, c = i % this.cols;
          const sb = this.ctx.shadowBlur; this.ctx.shadowBlur = 0;
          this.ctx.clearRect(c * this.cw, r * this.ch, this.cw, this.ch);
          if (this.bg) {
            this.ctx.fillStyle = this.bg;
            this.ctx.fillRect(c * this.cw, r * this.ch, this.cw, this.ch);
          }
          this.ctx.shadowBlur = sb;
          const color = colorOverride || this.colors[i];
          if (this.glowBlur) this.ctx.shadowColor = color; // glow matches the glyph
          this.ctx.fillStyle = color;
          this.ctx.fillText(chOverride || this.chars[i], c * this.cw, r * this.ch + this.yOff);
        },
      };
      if (bg) {
        const sb = ctx.shadowBlur; ctx.shadowBlur = 0;
        ctx.fillStyle = bg; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.shadowBlur = sb;
      }
      for (let i = 0; i < chars.length; i++) {
        if (chars[i] === ' ') continue;
        const r = (i / grid.cols) | 0, c = i % grid.cols;
        if (glowBlur) ctx.shadowColor = colors[i]; // per-glyph glow, not flat fg
        ctx.fillStyle = colors[i];
        ctx.fillText(chars[i], c * cw, r * ch + yOff);
      }

      this._el.innerHTML = '';
      this._el.appendChild(canvas);
      this._canvasMeta = meta;
      this._spans = null; this._preEl = null; this._baseText = null;
      this._paintGrid = grid;
    }

    // Glow (PLAN.md §9: text-shadow 0 0 pct×12px currentColor, layered ×2 >60%)
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

      const colorOf = (idx) => {
        if (!useColor) return '';
        let cr = grid.colors[idx * 3];
        let cg = grid.colors[idx * 3 + 1];
        let cb = grid.colors[idx * 3 + 2];
        if (satPct !== 100) { [cr, cg, cb] = applySaturation(cr, cg, cb, satPct); }
        if (blend > 0 && themeRGB) { [cr, cg, cb] = blendColors([cr, cg, cb], themeRGB, blend); }
        if (opts.colorQuant === 'ansi256') { [cr, cg, cb] = quantizeAnsi256(cr, cg, cb); }
        return 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      };

      // PERF fast path: same grid dimensions → patch spans in place. Slider
      // tuning (contrast, dither, color, charset…) never rebuilds 10k+ nodes.
      if (this._spans && this._spans.length === grid.rows * grid.cols && !this._canvasMeta) {
        const spans = this._spans;
        const gridChanged = this._paintGrid !== grid;
        for (let i = 0; i < spans.length; i++) {
          const sp = spans[i];
          const ch = mapChar(brightness[i], charset, exp, gamma);
          if (sp.textContent !== ch) sp.textContent = ch;
          const col = colorOf(i);
          if ((sp.style.color || '') !== col) sp.style.color = col;
          if (gridChanged) sp.dataset.brightness = grid.brightness[i].toFixed(3);
        }
        this._paintGrid = grid;
        this._preEl = null; this._baseText = null;
        return;
      }

      this._el.innerHTML = '';
      Object.assign(this._el.style, {
        display: 'block', fontFamily: 'monospace',
        color: 'var(--ascii-fg, currentColor)',
        backgroundColor: 'var(--ascii-bg, transparent)',
        userSelect: 'none',
      });

      if (grid.rows * grid.cols > 10000 && !this._warnedSize) {
        this._warnedSize = true;
        console.warn('[ascii-engine] ' + (grid.rows * grid.cols) + ' glyphs in dom mode — '
          + 'consider renderMode:"canvas" (large grids) or lower density for smooth animation/hover.');
      }

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

          const col = colorOf(idx);
          if (col) sp.style.color = col;

          spans.push(sp);
          row.appendChild(sp);
        }
        frag.appendChild(row);
      }
      this._el.appendChild(frag);
      this._spans = spans; this._preEl = null; this._baseText = null;
      this._paintGrid = grid; this._canvasMeta = null;
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
      if (this._canvasMeta) return; // canvas scales via CSS width
      requestAnimationFrame(() => {
        const w = this._el.offsetWidth;
        if (!w || !cols) return;
        const fsize = (w * 100) / (cols * measureCharWidth());
        this._el.style.fontSize   = fsize + 'px';
        this._el.style.lineHeight = '1em';
      });
    }

    // ── Noise animation (Phase 3) ──────────────────────────────────────────
    // Seeded, reproducible glyph corruption (PLAN.md §9: per-tick cell-flip
    // probability 0→0.35). Style-only — the cached grid and pipeline are never
    // touched. Under prefers-reduced-motion the static clean frame stays
    // (PLAN.md §6: animated presets render their static final frame).

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
        // reverse order so duplicate picks restore to the original char
        for (let i = this._corrupted.length - 1; i >= 0; i--) {
          const x = this._corrupted[i];
          if (x.el) x.el.textContent = x.ch;
          else if (this._canvasMeta) this._canvasMeta.drawCell(x.i, null, null);
        }
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
        // PERF: sample k = N·p random cells (O(k)) instead of an rng roll per
        // span (O(N)) — at 240 cols that's ~80 ops/tick instead of ~30,000.
        const spans = this._spans;
        const N = spans.length;
        const k = Math.round(N * p);
        const corrupted = [];
        for (let n = 0; n < k; n++) {
          const sp = spans[(rng() * N) | 0];
          corrupted.push({ el: sp, ch: sp.textContent });
          sp.textContent = charset[(rng() * charset.length) | 0];
        }
        this._corrupted = corrupted;
      } else if (this._canvasMeta) {
        const m = this._canvasMeta;
        const N = m.chars.length;
        const k = Math.round(N * p);
        const corrupted = [];
        for (let n = 0; n < k; n++) {
          const i = (rng() * N) | 0;
          corrupted.push({ i });
          m.drawCell(i, charset[(rng() * charset.length) | 0], null);
        }
        this._corrupted = corrupted;
      } else if (this._preEl && this._baseText != null) {
        const chars = this._baseText.split('');
        const N = chars.length;
        const k = Math.round(N * p);
        for (let n = 0; n < k; n++) {
          const i = (rng() * N) | 0;
          if (chars[i] !== '\n') chars[i] = charset[(rng() * charset.length) | 0];
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

    // ── Entrance animations (Phase 6, PLAN.md §11) ──────────────────────────
    // typing = row-major batched reveal; fade = per-cell staggered opacity.
    // Triggered by IntersectionObserver; static frame under reduced motion or
    // when IO is unavailable. DOM mode only (canvas/pre render statically).

    _setupEntrance() {
      const o = this._opts;
      if (!o.entrance || !this._spans || prefersReducedMotion()
        || typeof IntersectionObserver === 'undefined') return;
      for (const sp of this._spans) sp.style.visibility = 'hidden';
      this._io = new IntersectionObserver((entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        this._io.disconnect(); this._io = null;
        this._runEntrance();
      }, { threshold: 0.15 });
      this._io.observe(this._el);
    }

    _teardownEntrance() {
      if (this._io) { this._io.disconnect(); this._io = null; }
      if (this._entranceRaf && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(this._entranceRaf);
      }
      this._entranceRaf = null;
    }

    _runEntrance() {
      const o = this._opts, spans = this._spans;
      if (!spans) return;
      const N = spans.length;
      if (o.entrance === 'typing') {
        const frames = Math.max(1, Math.round(o.entranceDuration / 16));
        const per = Math.ceil(N / frames);
        let i = 0;
        const raf = typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
        const step = () => {
          for (let n = 0; n < per && i < N; n++, i++) spans[i].style.visibility = '';
          this._entranceRaf = i < N ? raf(step) : null;
        };
        step();
      } else { // fade — seeded stagger so it's reproducible
        const rng = mulberry32((o.seed || 0) + 1);
        for (let i = 0; i < N; i++) {
          const sp = spans[i];
          sp.style.visibility = '';
          sp.style.opacity = '0';
          sp.style.transition = 'opacity 400ms ease '
            + Math.round(rng() * o.entranceDuration) + 'ms';
        }
        const raf = typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
        raf(() => { for (const sp of spans) sp.style.opacity = '1'; });
      }
    }

    // ── Hover system (Phase 5) ─────────────────────────────────────────────
    // Pure CSS/JS on top of day-one data-cell attrs — zero pipeline changes.
    // Pointer events cover mouse AND touch-drag (PLAN.md §8 touch fallback);
    // coarse-pointer devices additionally get a slow ambient auto-animation,
    // skipped under prefers-reduced-motion.

    // [c, r] from a pointer event — span dataset in dom mode, coordinate math
    // in canvas mode.
    _cellFromEvent(e) {
      const cell = e.target && e.target.dataset && e.target.dataset.cell;
      if (cell) {
        const rc = cell.split(',');
        return [+rc[1], +rc[0]];
      }
      const m = this._canvasMeta;
      if (m && e.target === m.canvas && e.offsetX != null) {
        const sx = m.canvas.width  / (m.canvas.clientWidth  || m.canvas.width);
        const sy = m.canvas.height / (m.canvas.clientHeight || m.canvas.height);
        const c = Math.floor((e.offsetX * sx) / m.cw);
        const r = Math.floor((e.offsetY * sy) / m.ch);
        if (c >= 0 && r >= 0 && c < m.cols && r < m.rows) return [c, r];
      }
      return null;
    }

    _setupHover() {
      const o = this._opts;
      if (!o.hoverEffect || o.renderMode === 'pre' || !(this._spans || this._canvasMeta)) return;
      ensureHoverStyles();
      this._hoverSaved = new Map();   // span → snapshot of mutated style props
      this._hoverApplied = null;      // span → quantized intensity (diffing)
      this._rippleTimers = [];

      if (o.hoverEffect === 'reveal' && this._spans) {
        for (const sp of this._spans) sp.style.opacity = '0.15';
      }

      if (this._el.addEventListener) {
        // PERF: coalesce pointermove (fires per pixel) to one hover pass per
        // animation frame.
        const flush = () => {
          this._hoverRaf = null;
          if (this._pendingHover) this._hoverAt(this._pendingHover[0], this._pendingHover[1]);
        };
        const raf = typeof requestAnimationFrame !== 'undefined'
          ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
        const onMove = (e) => {
          if (o.hoverEffect === 'ripple') return; // ripple is press-driven
          const cell = this._cellFromEvent(e);
          if (!cell) return;
          this._pendingHover = cell;
          if (this._hoverRaf == null) this._hoverRaf = raf(flush);
        };
        const onLeave = () => { this._pendingHover = null; this._hoverClear(); };
        const onDown = (e) => {
          if (o.hoverEffect !== 'ripple') return;
          const cell = this._cellFromEvent(e);
          if (cell) this._rippleAt(cell[0], cell[1]);
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
      this._pendingHover = null; this._hoverRaf = null;
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
          transition: sp.style.transition || '',
        });
        const o = this._opts;
        sp.style.transition = ['color', 'opacity', 'transform', 'filter']
          .map((p) => p + ' ' + o.hoverDuration + 'ms ' + o.hoverEasing).join(', ');
      }
    }

    _restoreSpan(sp) {
      const s = this._hoverSaved && this._hoverSaved.get(sp);
      if (!s) return;
      sp.style.color = s.color; sp.style.opacity = s.opacity;
      sp.style.transform = s.transform; sp.style.filter = s.filter;
      sp.style.animation = s.animation; sp.style.display = s.display;
      sp.style.transition = s.transition;
      this._hoverSaved.delete(sp);
    }

    _hoverClear() {
      if (this._canvasHoverPrev && this._canvasMeta) {
        for (const i of this._canvasHoverPrev) this._canvasMeta.drawCell(i, null, null);
        this._canvasHoverPrev = null;
      }
      this._hoverApplied = null;
      if (!this._hoverSaved) return;
      for (const sp of Array.from(this._hoverSaved.keys())) this._restoreSpan(sp);
      this._hoverSaved.clear();
    }

    // Apply the configured effect centred on cell (c0, r0).
    _hoverAt(c0, r0) {
      const o = this._opts, grid = this._grid;
      if (!grid) return;

      // Canvas mode: highlight semantics via cell redraws.
      if (this._canvasMeta) {
        const m = this._canvasMeta;
        if (this._canvasHoverPrev) for (const i of this._canvasHoverPrev) m.drawCell(i, null, null);
        const affected = [];
        const accent = resolveAccent(this._el);
        const radius = effectiveHoverRadius(o.hoverRadius, m.cols);
        const aspect = o.glyphAspect || GLYPH_ASPECT;
        const rSpan = Math.ceil(radius / aspect) + 1;
        for (let r = Math.max(0, r0 - rSpan); r <= Math.min(m.rows - 1, r0 + rSpan); r++) {
          for (let c = Math.max(0, c0 - radius); c <= Math.min(m.cols - 1, c0 + radius); c++) {
            const dx = c - c0, dy = (r - r0) * aspect;
            if (falloffWeight(Math.sqrt(dx * dx + dy * dy), radius, o.hoverFalloff) <= 0) continue;
            const i = r * m.cols + c;
            m.drawCell(i, null, accent);
            affected.push(i);
          }
        }
        this._canvasHoverPrev = affected;
        return;
      }

      if (!this._spans || !this._hoverSaved) return;
      // PERF: incremental diff. A cursor move shifts the affected disc by one
      // cell, so most spans keep their exact intensity — restore only spans
      // that left the disc, write only spans whose (quantized) intensity
      // changed. This is what makes big relative radii (25% of width) smooth,
      // and it also fixes effects appearing "stuck": the old full clear-and-
      // reapply flooded paint with thousands of style writes per frame.
      const accent = resolveAccent(this._el);
      const radius = effectiveHoverRadius(o.hoverRadius, grid.cols);
      const aspect = o.glyphAspect || GLYPH_ASPECT; // rows are ~aspect× taller than cols
      const rSpan  = Math.ceil(radius / aspect) + 1;
      const prev   = this._hoverApplied || new Map();
      const next   = new Map();

      for (let r = Math.max(0, r0 - rSpan); r <= Math.min(grid.rows - 1, r0 + rSpan); r++) {
        for (let c = Math.max(0, c0 - radius); c <= Math.min(grid.cols - 1, c0 + radius); c++) {
          const dx = c - c0, dy = (r - r0) * aspect;
          const t = falloffWeight(Math.sqrt(dx * dx + dy * dy), radius, o.hoverFalloff);
          if (t < 0.03) continue; // imperceptible — skip the style write
          const sp = this._spans[r * grid.cols + c];
          if (!sp) continue;
          next.set(sp, Math.round(t * 20) / 20); // quantize → stable style strings
        }
      }

      for (const sp of prev.keys()) {
        if (!next.has(sp)) this._restoreSpan(sp);
      }
      for (const [sp, t] of next) {
        if (prev.get(sp) === t) continue; // unchanged intensity — no write
        this._saveSpan(sp);
        this._applyHoverStyle(sp, t, accent);
      }
      this._hoverApplied = next;
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
    // proportional delay, then restores. Cells are batched per integer
    // distance ring (2 timers per ring, not 2 per cell) so large relative
    // radii (FIXES.md #8) don't spawn thousands of timeouts.
    _rippleAt(c0, r0) {
      const o = this._opts, grid = this._grid;
      if (!grid || !this._spans || prefersReducedMotion()) return;
      const accent = resolveAccent(this._el);
      const radius = effectiveHoverRadius(o.hoverRadius, grid.cols);
      const aspect = o.glyphAspect || GLYPH_ASPECT;
      const perRing = Math.max(8, o.hoverDuration / radius);
      const rSpan = Math.ceil(radius / aspect) + 1;

      const rings = new Map(); // integer distance → spans
      for (let r = Math.max(0, r0 - rSpan); r <= Math.min(grid.rows - 1, r0 + rSpan); r++) {
        for (let c = Math.max(0, c0 - radius); c <= Math.min(grid.cols - 1, c0 + radius); c++) {
          const dx = c - c0, dy = (r - r0) * aspect;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > radius) continue;
          const key = Math.round(d);
          if (!rings.has(key)) rings.set(key, []);
          rings.get(key).push(this._spans[r * grid.cols + c]);
        }
      }
      for (const [ring, spans] of rings) {
        this._rippleTimers.push(setTimeout(() => {
          for (const sp of spans) { this._saveSpan(sp); sp.style.color = accent; }
          this._rippleTimers.push(setTimeout(() => {
            for (const sp of spans) this._restoreSpan(sp);
          }, o.hoverDuration));
        }, Math.round(ring * perRing)));
      }
    }

    // Coarse-pointer (touch) fallback: a slow Lissajous drift of the virtual
    // cursor. Skipped under prefers-reduced-motion (PLAN.md §8).
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
      'data-ascii-entrance':      'entrance',
      'data-ascii-entrance-duration': 'entranceDuration',
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
    falloffWeight, resolveAccent, effectiveHoverRadius,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = ASCIIEngine;

}());
