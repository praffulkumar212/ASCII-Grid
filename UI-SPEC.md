# UI-SPEC.md — Playground v2: editor overhaul + layer compositor

Direction agreed 2026-07-07. **Process: Figma-first** — Prafful designs in
Figma and shares the file; implementation reads it via the Figma connection
and builds to spec. Do not start M2/M3 visual work before the Figma handoff.

## 1. Mental model: form → editor

Today's playground is a settings form next to a preview. The target is a small
**editor** (Figma-lite). The stage owns the space; everything else orbits it.

### Zones
- **Stage (center, dominant)** — the art. Direct manipulation lives here:
  lasso, hover preview, drag-drop an image straight onto the stage.
  Empty state (no image yet) must be the most inviting screen, not an
  afterthought.
- **Layers panel** — thumbnail, name (editable), visibility eye, drag to
  reorder, duplicate/delete, add-layer. This is the compositor UI.
- **Inspector (right)** — properties of the **selected layer only**:
  preset strip on top, then collapsible groups: Sampling, Color, Effects,
  Hover, Mask. Progressive disclosure: new users see image → presets → export;
  groups are collapsed by default.
- **Top bar** — image input, undo/redo, theme toggle, single export CTA.

### Components worth careful design (Figma)
- Layer row (smallest, most repeated element)
- Inspector group: collapsed vs expanded states
- Control set: slider, select, color chip, checkbox — light + dark tokens
- Empty state
- Per-layer perf chip: glyph count → flips to "canvas recommended" warning
  (the layers UI should teach the perf rule, not hide it)

## 2. Architecture: one JSON document (the key decision)

The entire editor state is one serializable doc. UI renders FROM the doc;
every interaction mutates the doc and re-renders.

```json
{ "src": "...", "selected": "layer-2",
  "layers": [
    { "id": "layer-1", "name": "Photo",      "visible": true, "type": "image" },
    { "id": "layer-2", "name": "Glitch jar", "visible": true,
      "preset": "glitch", "overrides": { "noise": 40 },
      "mask": [[0.1,0.2]], "maskInvert": false, "maskFill": "none" }
  ] }
```

This buys, nearly free:
- **Undo/redo** — snapshot the doc per change; cmd+Z re-renders from history
  (cheap: grids are cached)
- **Export** — serialize the doc
- Pre-builds three parked backlog items: **URL sharing** (doc in the hash),
  **saved presets** (named docs), **batch mode** (same doc, different src)

Tech: vanilla JS, split into ES modules (`state.js`, `stage.js`, `layers.js`,
`inspector.js`) — no framework, no build step, consistent with the engine.

Engine addition needed: `ASCIIEngine.compose(el, doc)` — stacks absolutely-
positioned engine instances per layer (~60 lines; grid sampling already shared
via the global cache, so N layers ≈ 1 sampling pass). Layer types: `image`
(plain <img> underlay) and `ascii` (engine instance). `maskInvert` gives
complementary regions across layers.

## 3. Milestones (each shippable, tested, pushed)

- **M1 — architecture**: state-doc refactor + editor shell (3 zones, neutral
  styling) + undo/redo. Single layer only. App looks similar; everything after
  becomes easy. Tests: state-doc snapshots, undo/redo invariants.
- **M2 — layers**: engine `compose()` + layers panel + per-layer inspector +
  perf chip. Implemented against the Figma design.
- **M3 — interaction polish**: keyboard (L lasso, F fullscreen, cmd+Z/shift-Z,
  del layer), drag reorder, slider scrubbing feel, entrance/animation of the
  UI itself, final visual pass.

## 4. Performance guardrails
- Per-layer glyph budget chip; auto-suggest canvas render mode when a layer
  crosses ~10k glyphs (existing engine warning feeds this).
- DOM mode: fine for ~2 layers at moderate density with full hover.
- Canvas mode: the default steer for dense/animated layered comps.

## 5. Status
- [ ] Figma design shared (Prafful) ← NEXT
- [ ] M1 architecture
- [ ] M2 layers
- [ ] M3 polish
