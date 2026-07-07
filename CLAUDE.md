# CLAUDE.md — ascii-engine

## What this is
ASCII art generator for interactive article thumbnails/graphics on Prafful's website. Full spec lives in **PLAN.md — read it before writing code.** Two layers:

- **Engine** (`src/ascii-engine.js`): zero-dependency vanilla JS, single file, embeddable via `<script>` tag or ESM. No frameworks, no build step required (minification only, later).
- **Playground** (`playground/index.html`): single self-contained HTML page that uses the engine and exports embed snippets. No external dependencies.

## Folder layout
- `src/` — engine source
- `playground/` — configurator UI (single HTML page)
- `presets/` — preset definitions as JSON (Phase 3)
- `examples/` — sample images + demo embeds for manual testing

## Current status
ALL PHASES (1–6) complete — engine v0.5.0. Core pipeline; color/theme/
dithering; presets (13, seeded noise, glow, ANSI-256); playground (two-column:
sticky preview left, controls right); hover effects; entrance animations
(typing/fade via IntersectionObserver); canvas render mode for large grids;
perf work (in-place span patching, O(k) noise sampling, rAF-coalesced hover,
>10k-glyph warning); `dist/ascii-engine.min.js` (~11 KB gz, `npm run build`);
docs at `docs/index.html`.
Still open: FIXES.md #7 (theme-toggle repaint for source+themeBlend —
playground re-renders as workaround); canvas hover is highlight-semantics only.
PARKED (user decision — do not pick up unprompted): FIXES.md #9 video export
and the full #12 backlog (headline: layer compositor — goes with the planned
UI/interaction overhaul; plus URL sharing, saved presets, batch, Figma plugin,
golden tests, CORS UX, SSR mode, braille dot-matrix, Safari pass).
Shipped: #8 relative hover radius (v0.5.1); #10 QA round (v0.5.2); #11 —
v0.6.0 alpha+lasso masking, edge-direction glyphs, auto-contrast; v0.6.1
maskBackground flood fill; v0.6.2 maskFill (image/color) + maskInvert.
Tests: `npm test` = `node test/engine.test.js` (54 checks) — keep passing and
extend. Presets in `src/ascii-engine.js` (PRESETS) and `presets/presets.json`
must stay identical (test-enforced). After touching src/, re-run `npm run build`
so dist/ stays current. Visual/feel changes need manual browser testing.

## Non-negotiables (from the plan)
- **Aspect-ratio correction** in sampling (~2:1 glyph height) is a Phase 1 requirement, not polish
- **A11y defaults always on**: `aria-hidden="true"` on art container, required `alt`/`label` rendered visually-hidden (console.warn if omitted), reduced-motion → static frame, no keyboard focus inside glyphs
- **Caching rule**: brightness/color grid computed once per image; theme/hover changes must never re-run the pipeline — only structural params (cols, charset, dither, edge) invalidate cache
- **Theme adaptation** via CSS custom properties (`--ascii-fg`, `--ascii-bg`, `--ascii-accent`); `color: 'theme'` is the default mode
- Seeded randomness for noise/glitch so output is reproducible
- Heavy pixel math goes in a Web Worker

## Conventions
- Vanilla JS (ES2020+), no dependencies, no TypeScript
- Engine API is declarative-first: `data-ascii-*` attributes on a `<div>` (see PLAN.md §10 for the embed shape); programmatic API secondary
- Attribute percentages map to concrete formulas per PLAN.md §9 — implement those exact mappings
- Test manually via `examples/` pages; open in browser, no test framework for now

## Git
- Remote: git@gitlab.com:praffulkumar212/ascii-art.git, branch `main` (protected — no force pushes)
- Commit per meaningful unit of work with clear messages
