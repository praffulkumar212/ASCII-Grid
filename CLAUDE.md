# CLAUDE.md — ascii-engine

## What this is
ASCII art generator for interactive article thumbnails/graphics on Prafful's website. Full spec lives in **README.md — read it before writing code.** Two layers:

- **Engine** (`src/ascii-engine.js`): zero-dependency vanilla JS, single file, embeddable via `<script>` tag or ESM. No frameworks, no build step required (minification only, later).
- **Playground** (`playground/index.html`): single self-contained HTML page that uses the engine and exports embed snippets. No external dependencies.

## Folder layout
- `src/` — engine source
- `playground/` — configurator UI (single HTML page)
- `presets/` — preset definitions as JSON (Phase 3)
- `examples/` — sample images + demo embeds for manual testing

## Current status
Phases 1–5 complete (engine v0.4.0): core pipeline, color/theme/dithering,
preset system (13 presets, seeded noise, glow, ANSI-256), playground
(`playground/index.html`), and hover effects (highlight/ripple/invert/pulse/
magnify/reveal with duration/easing/radius/falloff configs, pointer-event
touch-drag + coarse-pointer ambient fallback, reduced-motion respected).
FIXES.md item 7 (theme-toggle repaint for source+themeBlend) still open;
playground works around it by re-rendering on theme toggle.
Next: Phase 6 — publish polish (minified CDN build, docs page, entrance
animations §11, canvas mode) — only if the project "turns out great".
Tests: `node test/engine.test.js` (48 checks) — keep passing and extend.
Presets live in both `src/ascii-engine.js` (PRESETS) and `presets/presets.json`;
they must stay identical (test-enforced). Playground needs manual browser
testing — hover feel, gallery, exports.

## Non-negotiables (from the plan)
- **Aspect-ratio correction** in sampling (~2:1 glyph height) is a Phase 1 requirement, not polish
- **A11y defaults always on**: `aria-hidden="true"` on art container, required `alt`/`label` rendered visually-hidden (console.warn if omitted), reduced-motion → static frame, no keyboard focus inside glyphs
- **Caching rule**: brightness/color grid computed once per image; theme/hover changes must never re-run the pipeline — only structural params (cols, charset, dither, edge) invalidate cache
- **Theme adaptation** via CSS custom properties (`--ascii-fg`, `--ascii-bg`, `--ascii-accent`); `color: 'theme'` is the default mode
- Seeded randomness for noise/glitch so output is reproducible
- Heavy pixel math goes in a Web Worker

## Conventions
- Vanilla JS (ES2020+), no dependencies, no TypeScript
- Engine API is declarative-first: `data-ascii-*` attributes on a `<div>` (see README §10 for the embed shape); programmatic API secondary
- Attribute percentages map to concrete formulas per README §9 — implement those exact mappings
- Test manually via `examples/` pages; open in browser, no test framework for now

## Git
- Remote: git@gitlab.com:praffulkumar212/ascii-art.git, branch `main` (protected — no force pushes)
- Commit per meaningful unit of work with clear messages
