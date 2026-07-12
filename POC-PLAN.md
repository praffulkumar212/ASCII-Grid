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
- Changes to the public engine API
