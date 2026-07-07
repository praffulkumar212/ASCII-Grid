# CLAUDE.md — ascii-engine project handbook

Complete operating context for any agent (Claude Code, Opus, Cowork session)
picking up this project. Read this fully before writing code. Companion docs:
**PLAN.md** (original product spec — §-references below point there),
**UI-SPEC.md** (next milestone), **FIXES.md** (findings log + parked backlog).

## What this is

ASCII art generator for interactive, theme-adaptive article thumbnails on
Prafful's website. Live at https://praffulkumar212.gitlab.io/ascii-art/
(GitLab Pages, auto-deploys from `main`). Two layers:

- **Engine** (`src/ascii-engine.js`, v0.6.2, ~1,100 lines): zero-dependency
  vanilla JS, single file, one IIFE. Embeds via `<script>` + `data-ascii-*`
  attributes (declarative-first; programmatic API secondary).
- **Playground** (`playground/index.html`): self-contained visual configurator
  → copy-paste embed snippet / config JSON / SVG / PNG exports.

## Who you're working with

Prafful is a **designer**, not an engineer. This changes how you work:

- Explain technical things in design terms (Figma analogies land well —
  e.g. DOM glow lag = "30k layers each with a drop shadow").
- He QAs by *using* the tool and sending screenshots. Take screenshot reports
  seriously — every one so far exposed a real bug, sometimes not the one he
  named (e.g. "transparent background" that was actually opaque black pixels;
  "stuck invert" that was a paint-storm frame drop).
- He values: concise replies, shipped increments, honest "this is inherent,
  here's the workaround" over hedging.
- **Park discipline is strict.** FIXES.md #9 (video export) and the entire
  #12 backlog are parked BY HIS DECISION. Do not pick them up, suggest starting
  them, or "quickly add" them. When he reports a new idea/observation, log it
  in FIXES.md immediately (he's lost messages before and expects the repo to
  be the memory).

## Non-negotiable working rules

1. **Run `npm test` before every commit.** 71 checks, ~1s, no dependencies.
   Never commit red. Extend the suite with every feature/fix (regression test
   for every bug found).
2. **Rebuild dist after touching src**: `npm run build` (terser via npx).
   dist/ is committed — a stale dist ships broken code to Pages.
3. **Presets live in TWO places** — `PRESETS` in src and `presets/presets.json`
   — and must stay byte-identical (a test enforces key order too). Edit both.
4. **Commits**: meaningful units, descriptive messages, identity flags
   `git -c user.name="Prafful" -c user.email="praffulkumar212@gmail.com"`.
5. **Pushing is manual by Prafful** (sandboxed agents can't reach GitLab; his
   SSH key is on his machine). End work sessions with "run `git push`".
   Remote: `git@gitlab.com:praffulkumar212/ascii-art.git`, branch `main`
   (protected, no force pushes).
6. Stale git lock files appear in sandboxes: `rm -f .git/*.lock` before git ops.
7. Version bumps: package.json + the src header comment. Feature = minor-ish
   bump (v0.6.1 → v0.6.2 style has been used for small features).

## Repo map

| Path | Notes |
|---|---|
| `src/ascii-engine.js` | the engine — single IIFE, section-commented |
| `dist/ascii-engine.min.js` | terser build (~11 KB gz), committed, used by embeds + examples/embed.html |
| `playground/index.html` | configurator; two-column (sticky stage left, controls right 30%) |
| `presets/presets.json` | canonical preset data (mirror of src PRESETS) |
| `test/engine.test.js` | Node DOM-shim harness, 71 checks, `npm test` |
| `docs/index.html` | option/attr reference — update tables when adding options |
| `examples/basic.html` | dev slider page (older; playground supersedes it) |
| `examples/embed.html` | article simulation: dist build + declarative API only |
| `PLAN.md` | original spec; §2 pipeline, §9 slider formulas, §10 embed shape |
| `UI-SPEC.md` | NEXT MILESTONE: playground v2 editor + layer compositor |
| `FIXES.md` | numbered findings log; #12 = parked backlog (do not touch) |
| `.gitlab-ci.yml` | test job every push; Pages deploy from main |

## Engine architecture

### Pipeline (PLAN.md §2)
image → `loadImage` (crossOrigin anonymous) → canvas `getImageData` →
**Web Worker** (`WORKER_SRC` string; main-thread `processPixels` fallback —
identical algorithm, keep in sync) → grid `{rows, cols, brightness Float32,
colors Uint8×3, alphas Uint8}` → optional Sobel (`applyEdge` → brightness +
`edgeDir Int8`) → **cache** → render (dom | pre | canvas).

- Alpha composited against white; per-cell average alpha kept for masking.
- `rows = round(cols × (imgH/imgW) / glyphAspect)`.

### The caching rule (sacred)
Grid computed ONCE per (src, cols, edgeBlend, glyphAspect) — that's `cacheKey`.
Everything else (contrast, gamma, dither, color, charset, glow, noise, hover,
masks, edgeStyle, autoContrast) is **render-time** and must NEVER re-run the
pipeline or mutate the cached grid (copy-on-write everywhere). `update()`
decides structural (`src|cols|edgeBlend` changed → re-render) vs render-time
(→ `_paint` only). Global `Map` cache, unbounded (accepted).

### Option resolution (Phase 3)
`_userOpts` holds ONLY what the user explicitly set; presets are a baseline
underneath (`_resolveOpts`: preset spread, then userOpts). Preset switches
never leak old preset values. **FIXES.md #1 pattern**: normalized opts carry a
*computed* `cols`; when incoming opts have `density` without `cols`, delete
stored `cols` first or density is shadowed. Same guard on preset switch.

### Render modes
- **dom** (default): span per glyph, row divs (`whiteSpace:pre`,
  `position:relative` — keeps rows above the maskFill underlay). Every span
  gets `data-cell="r,c"` + `data-brightness` (raw, pre-tone) — the hover
  system depends on these. **Patch path**: if span count matches grid size,
  repaints mutate textContent/color in place (never rebuild 10k+ nodes for a
  slider change). >10k glyphs → one-time console warning steering to canvas.
- **pre**: single text node, `\n` rows. Text index = `r*(cols+1)+c`.
- **canvas**: font calibrated via `measureText` so glyph advance fills the
  cell pitch (uncalibrated fonts left ~50% of each cell empty → washed-out
  look). Glow via per-glyph `shadowColor`. `meta.drawCell(i, chOverride,
  colorOverride)` is the single cell-redraw primitive (noise + hover use it).
  No 2d context (tests) → warn + fall back to pre.

### Tone & art quality
- **Tone-before-dither (FIXES #6)**: gamma/contrast applied BEFORE
  quantization (`toneAndDither`); `mapChar` runs neutral when dithering.
- **Glyph aspect (FIXES #3)**: measured at runtime (`measureGlyphMetrics`,
  hidden span probe); hardcoded 2.0 only as fallback (Node tests rely on the
  fallback for deterministic grid dims). Part of the cache key.
- **Edge glyphs**: `edgeStyle:'line'` renders cells with `edgeDir >= 0` as
  `EDGE_GLYPHS = '-\\|/'`. **y points down in screen coords** — 45° gradient
  bucket maps to `\`, 135° to `/`. Don't "fix" this to math convention.
- **Braille (FIXES #4)**: ramp is dot-count (popcount) sorted, 256 levels.
  True 2×4 dot-matrix rendering is parked backlog.
- **autoContrast**: 2%/98% percentile stretch, computed over *visible*
  (unmasked) cells only, no-ops on flat images.

### Masking (v0.6.x) — all combined in `buildMask`, in this order
1. `maskAlpha` (default ON): cell avg alpha < 5% → outside.
2. `maskBackground` (opt-in): border-color estimate → bail if border <60%
   uniform (photos safe) → flood-fill inward within tolerance 0.12. Interior
   same-color regions survive (not border-connected).
3. `mask`: polygon [[x,y]…] normalized 0–1 image coords (playground lasso;
   decimated ≤48 pts), point-in-polygon at cell centers.
4. `maskInvert`: flips the combined mask (only when one exists).

Masked cells: render as space, excluded from noise (via `_noisePool` index
array), hover, and ripple. `maskFill`: `'image'` = aria-hidden underlay `<img>`
in dom (z-index 0, container position:relative) / `drawImage` in canvas;
any CSS color = per-cell backgroundColor (dom) / fillRect (canvas).

### Effects
- **Noise**: seeded (`mulberry32`), O(k) sampling — `k = N×p` picks, NOT an
  rng roll per cell. Restore iterates corrupted list in REVERSE (duplicate
  picks). §9 formulas: p = noise% × 0.35; tick = 1000→60ms by animSpeed.
- **Hover (Phase 5 + perf rewrite)**: pointer events (covers touch-drag),
  rAF-coalesced. `_hoverAt` is **incremental-diff**: prev/next Maps of
  span→quantized intensity (1/20 steps); restore only leavers, write only
  changed; skip t<0.03. NEVER go back to clear-all-reapply per frame — that
  caused visible freezes ("stuck on invert"). Style snapshots (`_hoverSaved`)
  include `transition` and are restored on clear. Radius default `'25%'` of
  cols, resolved at hover time (`effectiveHoverRadius`); absolute numbers
  respected. Ripple: ring-batched timers (2 per integer-distance ring).
  Canvas hover = highlight semantics only (documented). Coarse-pointer →
  ambient Lissajous drift; reduced-motion kills ripple/ambient/noise anims.
- **Entrance**: typing (rAF batches) / fade (seeded stagger), via
  IntersectionObserver, dom mode only, reduced-motion → static.

### A11y (always on, PLAN.md §6)
Container `aria-hidden`; required `alt` → visually-hidden `role="img"` label
(console.warn if missing); no keyboard focus in glyphs; reduced-motion
respected everywhere.

## Testing

`test/engine.test.js` — Node harness with a ~60-line DOM shim. Shim quirks
you must know: no Blob/Worker/URL → engine uses `processPixels` fallback; no
offsetHeight → `measureGlyphAspect` returns the 2.0 fallback (grid-dim tests
depend on this); `getComputedStyle` stubbed (accent = `#4f8cff`);
DocumentFragment flattens on append; style objects carry a `setProperty`
shim. Tests drive internals directly (`engine._runWorker`, `_paint`,
`_hoverAt`, `ASCIIEngine._internals.*`) with synthetic ImageData (gradients,
step edges, half-transparent). Expected stderr noise: two caught
`Image is not defined` errors from fake-src renders. Pattern for every bug:
reproduce as a failing check first, fix, keep the check as regression.

## Performance model (be honest about it)

- Agent-controllable: DOM rebuilds (→ patch path), noise scans (→ O(k)),
  hover floods (→ diffing), pointermove storms (→ rAF).
- **Inherent**: per-glyph text-shadow paint at >10k DOM nodes. No JS fix.
  The answer is canvas mode; the playground status bar warns and steers.
- Guidance: dom = interactive thumbnails ≤~8k glyphs; canvas = dense/animated;
  pre = static minimal.

## History (what shipped, in order)

Phases 1–2 (core pipeline, color/dither/theme — built by Claude Code) →
independent review found 8 issues (FIXES #1–8) → v0.2.1 fixed 1–6 →
v0.3.0 presets/noise/glow/ANSI-256 → v0.4.0 playground + hover →
v0.5.0 perf + two-column layout + entrance/canvas/dist/docs →
v0.5.1 relative hover radius + Pages CI + README/LICENSE →
v0.5.2 hover diffing + canvas font calibration + fullscreen →
v0.6.0 alpha+lasso masking, edge-direction glyphs, auto-contrast →
v0.6.1 maskBackground flood fill → v0.6.2 maskFill + maskInvert.

## Current state & next

- **All 6 planned phases complete + masking suite.** 71/71 tests green.
- **Next milestone: UI-SPEC.md** — playground v2 editor + layer compositor.
  Process is **Figma-first**: WAIT for Prafful's Figma file; implement to spec
  via the Figma connection. M1 (state-doc refactor + undo/redo) may start
  without the design if he asks.
- **Open (allowed)**: FIXES #7 (theme-toggle repaint for source+themeBlend —
  playground re-renders as workaround); canvas hover parity.
- **PARKED (forbidden without his explicit go)**: FIXES #9 video export;
  FIXES #12 backlog — layer compositor (until UI milestone starts), URL
  sharing, saved presets, batch mode, Figma plugin, golden-file tests, CORS
  UX, SSR mode, braille dot-matrix, Safari pass.
