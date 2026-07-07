# ascii-engine

Turn any image into interactive, theme-adaptive ASCII art for the web. Zero dependencies, one 11 KB (gzipped) file, embeds in an article with two lines of HTML.

**Playground:** https://praffulkumar212.gitlab.io/ascii-art/playground/ · **Docs:** https://praffulkumar212.gitlab.io/ascii-art/docs/

## Quick start

```html
<script src="ascii-engine.min.js" defer></script>
<div data-ascii-src="/img/hero.jpg"
     data-ascii-preset="theme-adaptive"
     data-ascii-alt="Portrait of a trader at a terminal"></div>
```

Don't hand-write configs — open the playground, drop an image, pick a preset, tune, and copy the generated snippet.

## What it does

13 style presets (Matrix Rain, CRT, Blueprint, Glitch, Braille, ANSI-256, …) built on a real image pipeline: aspect-corrected sampling, Sobel edge detection, Floyd–Steinberg and Bayer dithering, per-cell source color. Art inherits your site's light/dark theme through CSS custom properties. Interactive hover effects (highlight, ripple, invert, pulse, magnify, reveal) with configurable radius, easing, and falloff — the default radius scales to 25% of the image. Seeded noise animation and entrance reveals (typing / per-cell fade) that respect `prefers-reduced-motion`. Accessibility is on by default: the glyph soup is `aria-hidden`, a visually-hidden description is required, and keyboard focus never lands in the art. Three render modes: `dom` (interactive), `canvas` (large/animated grids), `pre` (lightest).

## Repo layout

| Path | What |
|---|---|
| `src/ascii-engine.js` | the engine (readable source) |
| `dist/ascii-engine.min.js` | production build |
| `playground/` | visual configurator → embed snippet / JSON / SVG / PNG |
| `docs/` | full option reference |
| `presets/presets.json` | canonical preset definitions |
| `examples/` | dev test page + real-world embed test |
| `PLAN.md` | original build plan (all 6 phases complete) |

## Development

```sh
npm test         # 55-check functional suite, no dependencies (Node only)
npm run build    # terser → dist/ascii-engine.min.js
```

Engine details for contributors are in `CLAUDE.md`; open findings live in `FIXES.md`.

## License

MIT © Prafful Kumar
