# Product

## Register

product

## Users

Designers use ascii-engine's playground to turn source images into tuned ASCII artwork for publication, embeds, and visual experiments. They are judging the result by eye, iterating across presets and rendering controls, and exporting a usable snippet or asset once the image feels right.

## Product Purpose

ascii-engine is a zero-dependency ASCII art engine for interactive, theme-adaptive article graphics. The product UI should make image selection, preset comparison, tuning, previewing, masking, and export feel precise and fast. Success means a designer can move from image to polished embed without reading the full API reference or fighting the controls.

## Brand Personality

Precise, visual, restrained. The interface should feel like a capable creative tool: calm enough for repeated use, visually confident enough to match the generative-art output, and exact in its labels and controls.

## Anti-references

Do not make the playground feel like generic SaaS dashboard UI, neon terminal overload, beige editorial design, glassmorphism, decorative card clutter, purple-blue AI gradients, or novelty ASCII cosplay. The ASCII output is the expressive object; the interface should support it without competing.

## Design Principles

1. Keep the artwork first: the preview is the main workspace, and controls exist to sharpen decisions around it.
2. Make tuning legible: related controls should be grouped by the kind of visual decision they affect, with clear values and predictable behavior.
3. Preserve creative flow: image loading, preset switching, mask work, and exports should feel immediate and reversible.
4. Use restraint as confidence: color, motion, borders, and density should help designers scan and compare, not decorate the page.
5. Ship embed-ready output: every UI path should reinforce that the final artifact is accessible, theme-aware, and production friendly.

## Accessibility & Inclusion

Target WCAG AA contrast for the playground UI. Preserve the engine's existing accessibility posture: required alt text, `aria-hidden` glyph output, visually hidden descriptions, no keyboard focus inside the art, and reduced-motion support for animated effects. Controls should remain usable by keyboard, and color should not be the only cue for active, selected, warning, or disabled states.
