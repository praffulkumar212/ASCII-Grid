# ASCII Art Generator — Build Plan v2

**Context locked in:**
- Fun side project → primary use: **interactive thumbnails/graphics for articles** on Prafful's website; may publish publicly if it turns out great
- **Images first** (video/webcam/text-banner deferred to backlog)
- **Playground UI is in scope** — flow: image input → pick style → art generates → tune parameters → (later) add hover states + transitions → export embed code
- **Theme-adaptive by default** — art inherits the host site's light/dark theme

---

## 1. Product Shape: Two Layers

### Layer A — The Engine (`ascii-engine.js`)
Zero-dependency vanilla JS, single minified file, embeddable via `<script>` tag or ESM import. This is what lives on the website inside articles.

### Layer B — The Playground (single HTML page)
A visual configurator that *uses* the engine. You never hand-write config JSON — the playground generates it. Output of a playground session = a **copy-paste embed snippet**.

```
Playground flow:
[1] Drop/upload image
[2] Pick a style preset (visual gallery of thumbnails, not a dropdown)
[3] Art renders instantly
[4] Tweak sliders (density, contrast, dither, edge, color, glow, noise...)
[5] (Phase later) Configure hover effect + transition
[6] Export → copy embed snippet / download config JSON / download PNG-SVG
```

---

## 2. Engine — Core Pipeline (unchanged from v1, with fixes)

1. **Preprocessing**: downsample to grid — **with character aspect-ratio correction** (monospace glyphs are ~2:1 tall; sampling must compensate or output looks vertically squashed). This is a Phase 1 requirement, not polish.
2. Grayscale + optional gamma correction
3. Optional edge detection (Sobel) — blendable 0–100% with brightness mapping
4. Optional dithering (Floyd–Steinberg / ordered Bayer)
5. Character mapping via selected ramp
6. Optional per-cell color sampling
7. Post effects (glow, noise/glitch with **seed parameter** for reproducible randomness, scanlines)
8. Render to target

**Caching rule:** for static images, the brightness/color grid is computed **once** and cached. Hover effects and theme changes only mutate styles — the pipeline never re-runs unless the image or structural params (cols, charset, dither, edge) change.

**Web Worker** offload for the pixel math so large images never jank the article page.

## 3. Character Sets
- Classic 10-level ramp `" .:-=+*#%@"`
- Extended 70-char ramp
- Unicode blocks `░▒▓█`
- Braille dot-matrix (highest fidelity)
- Custom ramp (user-supplied string)

## 4. Render Modes
- **`dom` (default)** — one `<span>` per character. Chosen as default because the primary use case is article thumbnails/hero pieces (small-to-medium grids) where per-glyph hover matters. Practical cap ~5–8k glyphs.
- **`pre`** — plain text, lightest possible, no interactivity
- **`canvas`** — opt-in for large/animated grids; hover via coordinate hit-testing

## 5. Theme Adaptation (new, first-class)

The engine reads CSS custom properties from the host page:

```css
:root {
  --ascii-fg: currentColor;      /* falls back to inherited text color */
  --ascii-bg: transparent;
  --ascii-accent: #4f8cff;       /* used by hover/glow effects */
}
```

- `color: 'theme'` mode → glyph colors derived from `--ascii-fg`, so the art flips automatically with the site's light/dark toggle (`prefers-color-scheme` or class-based themes both work, since it's just CSS vars).
- `color: 'source'` mode still available for full-color art; a `themeBlend: 0–100%` slider mixes source color toward theme color (e.g. 70% theme = tinted monochrome that still matches the site).
- A **theme-adaptive default preset** ships as the out-of-box style.

## 6. Accessibility (new, non-negotiable defaults)
- Art container gets `aria-hidden="true"` automatically; engine **requires** an `alt`/`label` option and renders it as a visually-hidden description (and warns in console if omitted).
- `prefers-reduced-motion: reduce` → animated presets (glitch, scanline, typing-reveal) automatically render their static final frame.
- Keyboard focus never lands inside the glyph soup.

## 7. Responsive Behavior (new, Phase 1 concern)
- `fitMode: 'width'` (default) — engine measures container, picks font-size so the fixed `cols` grid always fills it. One config works from mobile to desktop.
- `fitMode: 'fixed'` — exact cols + font-size, container scrolls/clips.
- Re-render (cheap, cached grid) on `ResizeObserver`, debounced.

## 8. Hover & Transitions (secondary phase, per your call)
Deferred but designed-for now so nothing needs retrofitting:
- DOM mode already gives each glyph a `data-brightness` / `data-cell` attribute from day one → hover system later is pure CSS/JS on top, zero pipeline changes.
- Planned effects: highlight, radius ripple, invert, color pulse (uses `--ascii-accent`), magnify, reveal-on-hover.
- Each effect gets a **transition config**: duration, easing, radius, falloff.
- **Touch fallback**: on touch devices, cursor effects degrade to touch-drag or a slow ambient auto-animation (respecting reduced-motion).

## 9. Attribute → Implementation Mapping (making percentages real)

| Attribute | 0% means | 100% means | Concrete mapping |
|---|---|---|---|
| Density | 40 cols | 240 cols | `cols = 40 + pct × 200` |
| Contrast | flat midtones | full black↔white spread | levels remap curve exponent `0.5 → 2.5` |
| Dither | off | full FS error diffusion | error-diffusion strength multiplier `0 → 1` |
| Edge blend | pure brightness | pure line art | Sobel layer opacity `0 → 1` |
| Color saturation | mono/theme | full source RGB | HSL saturation multiplier `0 → 1` |
| Noise | none | heavy corruption | per-frame cell-flip probability `0 → 0.35`, seeded |
| Glow | none | heavy phosphor | `text-shadow: 0 0 (pct × 12px) currentColor`, layered ×2 above 60% |
| Anim speed | static | fast | effect tick interval `∞ → 60ms` |

Presets from v1 (Classic Mono, Matrix Rain, Blueprint, CRT, Halftone, Braille, Blocks, Line-Art, Cyberpunk, Glitch, Faded, ANSI-256) all remain — now reproducible because each slider has a defined formula. **New addition: "Theme Adaptive" preset as the default.**

## 10. Playground Spec (Layer B)

Single self-contained HTML page (can itself live on your site later):
- **Step 1 — Input**: drag-drop / file picker / URL. Image preview.
- **Step 2 — Style**: visual preset gallery — each preset shown as a live mini-render of *your uploaded image*, not a canned sample.
- **Step 3 — Tune**: slider panel (all attributes from §9), charset picker, color mode toggle (theme / source / blend), fit mode. Live re-render, debounced.
- **Step 4 — Export**:
  - **Copy embed snippet** (script tag + one `<div data-ascii-...>` — see below)
  - Download config JSON
  - Download PNG / **SVG** (SVG prioritized — crisp anywhere, importable into Figma)
  - Copy raw text
- Later: Step 3.5 hover-effect configurator.

**Declarative embed** (no JS needed in articles):
```html
<script src="ascii-engine.min.js" defer></script>
<div data-ascii-src="/img/article-hero.jpg"
     data-ascii-preset="theme-adaptive"
     data-ascii-config='{"density":62,"glow":15}'
     data-ascii-alt="Portrait of a trader at a terminal"></div>
```

## 11. Entrance Animations (small, high-impact)
- Typing-in reveal and fade-per-cell entrance, triggered via `IntersectionObserver` when the art scrolls into view. Static-frame fallback under reduced-motion. Great for article thumbnails.

---

## 12. Revised Build Phases

| Phase | Scope | Outcome |
|---|---|---|
| **1 — Core engine** | Image → aspect-corrected sampling → charset mapping → `pre`/`dom` render, `fitMode`, caching, a11y defaults | A working embed of any image |
| **2 — Color + charsets + theme** | Source color, theme mode (`--ascii-fg` etc.), themeBlend, blocks/braille charsets, dithering | Theme-adaptive art |
| **3 — Preset system** | Attribute formulas (§9), 13 presets as JSON, seeded noise, glow | One-line style switching |
| **4 — Playground v1** | Upload → preset gallery → sliders → export snippet/JSON/SVG/PNG | The tool you envisaged |
| **5 — Hover + transitions** | DOM hover effects, transition configs, touch fallback, playground hover panel | Interactive thumbnails |
| **6 — Publish polish** (only if it turns out great) | Minified CDN build, docs page, entrance animations, canvas mode | Public release |
| Backlog | Video/webcam, text banners, GIF export, ANSI terminal output | Later, if ever |

---

## Permission Checkpoint

No code written yet. Green-light **Phase 1** to begin?
