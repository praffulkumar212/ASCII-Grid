# Motion, interaction, and export POC

Branch: `poc/animation-interaction-exports`

## Why this POC is smaller than the original proposal

The existing engine already has the important foundations:

- a non-destructive cached image → grid pipeline;
- DOM, Pre, and Canvas renderers;
- seeded noise and entrance animation;
- six hover effects with pointer/touch handling;
- reduced-motion behavior;
- PNG, SVG, text, config, and embed-snippet exports;
- regression coverage for the grid, effects, masking, and exports' source data.

The unknowns are continuous motion over the whole ASCII grid and portable
animated/interactive output. This POC targets only those unknowns.

## Isolation rule

Production engine and playground behavior remain unchanged. The experiment
lives in `poc-motion/index.html` and consumes the engine's Canvas output as an
immutable source frame.

## POC pipeline

```text
existing ASCIIEngine (canvas mode)
  → stable source canvas
  → motion compositor
  → visible preview canvas
  → PNG / WebM / standalone interactive HTML
```

## Atomic phases

### Phase 1 — source-frame adapter

- [x] Render the existing engine in Canvas mode.
- [x] Detect its generated source canvas.
- [x] Copy its dimensions into the presentation canvas.
- [x] Divide the source canvas using the engine grid's rows and columns.
- [x] Keep the source renderer hidden but alive for configuration changes.

### Phase 2 — continuous motion

- [x] Add a single controlled `requestAnimationFrame` loop.
- [x] Use elapsed time rather than frame count.
- [x] Pause when the page is hidden.
- [x] Add Wave.
- [x] Add Random Resolve with deterministic cell ordering.
- [x] Add CRT Glitch.
- [x] Restore a clean frame when motion is disabled.

### Phase 3 — pointer interaction

- [x] Normalize mouse, pen, and touch through Pointer Events.
- [x] Convert pointer coordinates to canvas coordinates.
- [x] Add Cursor Repel with radius, strength, falloff, and return behavior.
- [x] Add Circular Reveal.
- [x] Clear interaction when the pointer leaves.

### Phase 4 — feasibility exports

- [x] Export the current presentation frame as PNG.
- [x] Record the presentation canvas with `captureStream` + `MediaRecorder`.
- [x] Select a supported WebM codec at runtime.
- [x] Add recording progress and cleanup.
- [x] Export a standalone HTML file containing the current ASCII source frame,
      motion settings, interaction settings, and a minimal compositor.

### Phase 5 — evaluation

- [x] Measure FPS at 60, 90, 120, and 160 columns in headless Chrome.
- [ ] Test normal animation, pointer interaction, and the combined case.
- [ ] Test Chrome, Safari, and Firefox where available.
- [ ] Verify touch behavior on a real mobile device.
- [ ] Record browser/container support for video export.
- [ ] Decide whether the production compositor remains Canvas 2D or needs GPU
      acceleration for high-density grids.

### Phase 6 — appearance controls

- [x] Reuse the existing engine's appearance options instead of creating a
      second visual-processing implementation.
- [x] Add Density while keeping the current Columns value available as its
      precise/advanced representation.
- [x] Add character-set selection and custom character input.
- [x] Add contrast and gamma.
- [x] Add color mode, foreground color, background color, and saturation.
- [x] Add dithering strength and dithering mode.
- [x] Add glow and noise.
- [x] Add edge strength and edge style.
- [x] Group appearance separately from Motion and Interaction.
- [x] Re-render only the stable ASCII source when an appearance value changes;
      do not restart or duplicate the presentation render loop.
- [x] Preserve motion and interaction settings while appearance changes.
- [x] Verify PNG, WebM, and interactive HTML use the selected appearance.
- [x] Benchmark expensive combinations such as high density + glow + motion.

### Phase 7 — editor viewport and organization

- [x] Add a persisted light/dark editor toggle that does not alter artwork or
      export colors.
- [x] Constrain the desktop workspace to the browser viewport.
- [x] Keep the stage visible while the inspector scrolls independently.
- [x] Move Appearance, Motion, and Interaction into accordions.
- [x] Keep Appearance closed, Motion open, and Interaction closed by default.
- [x] Summarize active settings in accordion headers.
- [x] Add Fit, 100%, zoom in, zoom out, and live zoom percentage controls.
- [x] Add pointer-centered wheel zoom.
- [x] Add Space/middle-button panning and two-pointer touch pinch navigation.
- [x] Keep artwork interaction coordinates correct after camera transforms.
- [x] Ensure the editor camera never changes PNG, WebM, or HTML export size.

### Phase 7.1 — high-density performance stabilization

- [x] Stop the animation loop from repainting static artwork continuously.
- [x] Copy the stable source canvas in one operation for static frames.
- [x] Render Wave as vertical strips instead of one draw call per cell.
- [x] Render CRT Glitch as horizontal strips instead of one draw call per cell.
- [x] Restrict pointer distance calculations to the affected grid region.
- [x] Keep full per-cell interaction precision through 18,000 cells.
- [x] Group interaction cells into adaptive preview blocks above 18,000 cells.
- [x] Group the inherently per-cell Random Resolve preview at extreme density.
- [x] Throttle extreme-density continuous previews where necessary.
- [x] Show performance-watch, high-density, extreme-density, and preview-quality
      status directly on the stage.

### Phase 8 — lasso and shape masks

- [x] Restore the existing freeform lasso workflow.
- [x] Add square, rectangle, circle, and triangle mask presets.
- [x] Convert preset shapes into normalized polygons accepted by the engine.
- [x] Add move, resize, rotate, invert, clear, and fill controls.
- [x] Convert pointer coordinates through the editor camera before mask edits.
- [x] Preserve masks during pan, zoom, appearance changes, and preset changes.
- [x] Preserve masks in PNG, WebM, and standalone HTML exports.

### Phase 9 — same-source layer POC (parked for the next product release)

- [ ] Introduce one serializable editor document with a selected layer.
- [ ] Add, duplicate, rename, reorder, show/hide, and delete layers.
- [ ] Give each layer independent appearance, motion, interaction, opacity, and
      mask settings.
- [ ] Reuse cached sampling grids when layers share the same source and
      structural settings.
- [ ] Render layer frames offscreen and composite them through one shared
      animation loop into the visible stage canvas.
- [ ] Add a total render-budget indicator and pause hidden layers.
- [ ] Preserve the composite in PNG, WebM, and standalone HTML exports.
- [ ] Keep different source images per layer outside this POC.

### Phase 10 — universal website embedding

The default integration should be a responsive `iframe`, because it isolates
the renderer from a website's CSS and JavaScript and works across plain HTML,
CMS builders, and framework applications. A direct JavaScript/component embed
can remain an advanced production option after this route is proven.

- [ ] Keep the exported interactive artwork self-contained with no dependency
      on the editor or local engine files.
- [ ] Add a Copy Embed Code action beside Interactive HTML export.
- [ ] Generate a minimal responsive `iframe` snippet with an explicit title,
      aspect ratio, lazy loading, and safe default permissions.
- [ ] Document the one-file workflow: export the HTML, upload it to the target
      website, and paste the generated `iframe` snippet.
- [ ] Make the embedded canvas resize with its container without stretching or
      losing its source aspect ratio.
- [ ] Preserve Wave, Random Resolve, CRT Glitch, Cursor Repel, and Circular
      Reveal inside the embed.
- [ ] Preserve mouse, pen, and touch behavior inside the embed.
- [ ] Respect `prefers-reduced-motion` in the exported file.
- [ ] Pause animation when the iframe is hidden, offscreen, or its page is in a
      background tab.
- [ ] Ensure two or more embeds can run on one page without shared state.
- [ ] Ensure website CSS cannot alter the embedded artwork's typography,
      canvas size, colors, or interaction coordinates.
- [ ] Add a versioned configuration payload so older embeds remain readable
      after new controls are introduced.
- [ ] Avoid `eval`, remote scripts, trackers, and unnecessary iframe
      permissions.
- [ ] Test a normal iframe and a sandboxed iframe.
- [ ] Test the snippet in plain HTML and representative CMS/framework shells.
- [ ] Record any `Content-Security-Policy` or `frame-src` requirements.
- [ ] Define a clear fallback poster/static image for browsers where Canvas or
      required animation APIs are unavailable.
- [ ] Measure multi-embed CPU use and establish a recommended maximum number of
      simultaneously animated artworks per page.

## Success criteria

- Existing engine and playground tests remain green.
- Production files are unchanged except for documenting the explicitly
  authorized POC export experiment.
- Three motion presets and two pointer interactions work in isolation.
- Motion and interaction can run together.
- PNG matches the current visible frame.
- WebM records consistent motion on supported browsers.
- Exported HTML runs without the editor or engine source file.
- The POC does not accumulate animation loops or object URLs.
- Appearance settings survive all three export paths.
- A copied responsive iframe snippet preserves every selected animation and
  interaction state without inheriting styles from the host website.
- Multiple embeds on the same page remain isolated and pause when offscreen.

## Initial browser results

Headless Chrome, Wave + Cursor Repel, 640×420 test source:

| Columns | Cells | Preview rate |
|---:|---:|---:|
| 60 | 1,440 | 60 fps |
| 90 | 3,150 | 60 fps |
| 120 | 5,640 | 60 fps |
| 160 | 10,080 | 60 fps |

Desktop and 390px mobile layouts rendered without horizontal overflow. PNG,
4-second WebM, and standalone HTML exports completed successfully. The exported
HTML reopened independently at the full 1280×832 source-frame resolution with
no runtime errors. These are feasibility results, not final cross-browser or
real-device performance claims.

Phase 6 was validated with Blocks, source color, custom background, contrast,
gamma, saturation, Bayer dithering, glow, noise, directional edges, Wave, and
Cursor Repel active together. PNG, WebM, and standalone HTML exports completed
without runtime errors. A high-cost 160-column / 10,080-cell combination with
70% glow, 25% noise, Wave, and Cursor Repel held 60 fps in headless Chrome.

Color-mode polish hides and disables Foreground when Source colors is active,
shows source-only Saturation and Tint/Mix controls, keeps Background available
in both modes, and explains the active behavior inline. The dither modes are
presented by intent (Smooth Diffusion vs Ordered Grid), with a stronger ordered
threshold scale so the organic and graphic textures remain visibly distinct at
the same slider value. Conditional-control and same-settings output comparisons
completed without runtime errors.

Phase 7 keeps the 848px-tall desktop inspector independently scrollable at a
1,650px content height while the stage remains fully contained in the viewport.
Theme changes left the artwork canvas byte-identical. Fit, 100%, zoom, pan, and
reset behavior passed automated browser checks, and PNG, WebM, and standalone
HTML export dimensions remained independent of the editor camera.

Phase 7.1 removed the critical 26,520-cell static repaint loop: the same case
that previously ran at 1 fps now renders once and stays idle. At 15,800 cells,
Wave + Cursor Repel holds 60 fps at full cell precision. At 26,520 cells, Wave
runs at 29 fps and Wave + Cursor Repel runs at 28 fps using a clearly labelled
4× adaptive interaction preview. Random Resolve remains the most expensive
effect and uses a labelled coarse preview at extreme density so the editor stays
responsive; full-quality static source rendering remains unchanged.

Phase 8 restored freeform drawing and added square, rectangle, circle, and
triangle presets backed by the engine's normalized polygon mask. Shape
transforms, inversion, empty/original-image/solid-color fills, and clearing are
available in the Mask accordion. Automated checks drew a freeform mask after
zooming and panning, verified every preset changed the artwork, and reopened
masked PNG and standalone HTML exports without runtime errors.

## Not in scope

- Remixing or gallery/community behavior
- Timeline or keyframes
- AI assistance
- Multi-source textures
- Different source images per layer
- MP4 transcoding
- Transparent video
- Production UI integration
- Direct React/Vue/Web Component packages
- Changes to the public engine API until the iframe route is validated
