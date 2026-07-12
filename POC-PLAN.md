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

- [ ] Reuse the existing engine's appearance options instead of creating a
      second visual-processing implementation.
- [ ] Add Density while keeping the current Columns value available as its
      precise/advanced representation.
- [ ] Add character-set selection and custom character input.
- [ ] Add contrast and gamma.
- [ ] Add color mode, foreground color, background color, and saturation.
- [ ] Add dithering strength and dithering mode.
- [ ] Add glow and noise.
- [ ] Add edge strength and edge style.
- [ ] Group appearance separately from Motion and Interaction.
- [ ] Re-render only the stable ASCII source when an appearance value changes;
      do not restart or duplicate the presentation render loop.
- [ ] Preserve motion and interaction settings while appearance changes.
- [ ] Verify PNG, WebM, and interactive HTML use the selected appearance.
- [ ] Benchmark expensive combinations such as high density + glow + motion.

### Phase 7 — universal website embedding

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

## Not in scope

- Remixing or gallery/community behavior
- Timeline or keyframes
- AI assistance
- Multi-source textures
- MP4 transcoding
- Transparent video
- Production UI integration
- Direct React/Vue/Web Component packages
- Changes to the public engine API until the iframe route is validated
