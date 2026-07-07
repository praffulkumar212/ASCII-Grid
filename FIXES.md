# FIXES.md — Review findings after Phase 2

Independent code review + functional test of `src/ascii-engine.js` (v0.2.0).

**STATUS (v0.2.1): items 1–6 FIXED and covered by tests (19/19 passing —
`node test/engine.test.js`). Item 7 still open (deferred; see below). Braille
dot-matrix render mode (#4, real fix) deferred to its own task. Phase 3 is
unblocked.**

## 1. BUG — `update({density})` is silently ignored  [FIXED v0.2.1]

`update()` merges `newOpts` over the previous **normalized** opts, which already
contain a computed `cols`. In `_normalizeOpts`, `raw.cols` wins over `density`,
so a new density can never change the column count. Net effect: the density
slider in `examples/basic.html` does nothing after the first render.

Repro: init with `density: 62` (cols 164) → `update({ density: 100 })` →
`_opts.cols` is still 164, expected 240.

Fix direction: when the incoming opts contain `density` but not `cols`, drop the
stale `cols` before normalizing (or track whether cols was user-set vs derived).

## 2. BUG — stale `cols` captured by ResizeObserver  [FIXED v0.2.1]

`_setupResizeObserver(cols)` early-returns if `this._ro` exists, and the debounced
callback closes over the `cols` from the **first** render. After any structural
update (density/cols change), window resizes re-fit with the old column count →
wrong font-size.

Fix direction: have the callback read `this._grid.cols` at call time; don't pass
cols into the closure.

## 3. DESIGN — hardcoded `GLYPH_ASPECT = 2.0` squashes output  [FIXED v0.2.1 — measured at runtime, glyphAspect now part of cache key]

Rendering uses `line-height: 1em`, and a monospace glyph is ~0.6em wide, so the
real cell aspect is ≈ 1.67, not 2.0. Sampling with 2.0 produces ~17% vertically
squashed art.

Fix direction: measure the actual ratio at runtime — extend `measureCharWidth()`
to also measure line height (one hidden `<span>` probe gives both), and use
`measuredLineHeight / measuredCharWidth` as the default `glyphAspect`.
Keep the `glyphAspect` option as an override. Note: measured aspect feeds the
cache key indirectly via rows — recompute rows when it changes.

## 4. DESIGN — braille charset is not a brightness ramp  [FIXED v0.2.1 — dot-count-sorted 256-level ramp; true dot-matrix mode still TODO]

`CHARSETS.braille` lists glyphs in codepoint order, which is not dot-count order
(e.g. ⠇ = 3 dots precedes ⠈ = 1 dot). As a ramp it's perceptually wrong → noisy
output.

Two-part fix:
- Short term: sort the ramp by dot count (popcount of the low 8 bits of
  `codepoint - 0x2800`).
- Real fix (per README §3, "Braille dot-matrix (highest fidelity)"): braille
  should be a distinct **render technique**, not a ramp — each glyph encodes a
  2×4 subpixel block: threshold 8 samples per cell, set dots via
  `0x2800 + bitmask`. Grid sampling for braille mode needs 2×4 sub-samples per
  cell. OK to defer to its own task, but don't ship the unsorted ramp.

## 5. GAP — `edgeBlend` is a silent no-op  [FIXED v0.2.1 — Sobel implemented, accepts 0–1 or percent]

`edgeBlend` is accepted, documented as structural, and part of the cache key,
but no Sobel pass exists. Either implement Sobel edge detection (README §2 step
3: blendable 0–100% with brightness mapping) or throw/warn until implemented —
silent acceptance is misleading, and presets in Phase 3 (Blueprint, Line-Art)
depend on it.

## 6. MINOR — dither runs on pre-contrast values  [FIXED v0.2.1 — toneAndDither applies gamma/contrast first, mapChar runs neutral when dithering]

Dithering quantizes raw luminance, but `mapChar` then applies gamma/contrast,
warping the quantized levels so error diffusion no longer lands on charset
boundaries. Apply gamma/contrast to the brightness copy **before** quantization
(then `mapChar` should skip them when dither is active).

## 7. MINOR — source+themeBlend colors don't track theme toggles  [OPEN — good Phase 3/5 candidate: color-mix() or theme-change repaint]

In `colorMode: 'source'` with `themeBlend > 0`, the theme color is resolved once
and baked into inline `rgb()` styles, so a light/dark toggle doesn't update the
art until a repaint (plan §5 promises automatic flipping). Options:
`color-mix(in srgb, rgb(...) X%, var(--ascii-fg))` as the inline color (CSS does
the blend live), or observe theme changes and repaint (cheap — grid is cached).
Pure `theme` mode is already correct.

## 8. ENHANCEMENT — hover radius should scale with the image  [OPEN — requested 2026-07-07]

The hover radius must cover **at least 25% of the image**, not a fixed cell
count. Today `hoverRadius` is absolute (default 4, clamped 1–20 cells): on a
240-col render, radius 4 is a barely-visible 1.7% of the width; even the max
(20) is only 8%.

Fix direction:
- Support relative values: `hoverRadius: '25%'` (of cols) alongside numbers;
  compute effective radius at hover time from the live grid
  (`Math.max(minCells, cols * pct)`), so density changes keep it proportional.
- Make **25% of cols the default floor**: effective radius =
  `max(hoverRadius, cols * 0.25)` unless the user explicitly opts out.
- Raise or drop the 20-cell clamp (25% of 240 cols = 60 cells).
- Perf note: at radius 60 the affected-cell loop is ~60×60÷aspect ≈ 2.2k
  cells/frame in dom mode — fine with the rAF coalescing, but re-check on a
  low-end machine; canvas mode unaffected.
- Update: playground radius slider (switch to % of width), docs table,
  `data-ascii-hover-radius` parsing ('25%' string), tests.

## 9. NOTES — no action needed now

- Grid cache Map is unbounded; fine at current sizes, revisit if playground
  churns many images (LRU cap ~20).
- `URL.revokeObjectURL` immediately after `new Worker(url)` is spec-safe but has
  been flaky in old Safari; revoke on first successful message if paranoid.
- Cross-origin images without CORS headers will taint the canvas and fail with a
  console error only — playground (Phase 4) should surface this to the user.
- `examples/basic.html` sliders use `change` events; switch to `input` (debounced)
  for live-drag feedback in the real playground.

## Test harness

Functional checks used for this review (11 checks: grid dims, ramp mapping,
data-attrs, a11y, dither purity/determinism, density-update repro) live in
`test/engine.test.js` — a Node DOM-shim harness, no dependencies. Run with
`node test/engine.test.js`. Currently 10/11 pass; the failing check is bug #1
and should pass once fixed. Extend it as you fix items above (a stale-closure
check for #2, a measured-aspect check for #3, dot-count monotonicity for #4).
