---
name: ascii-engine
description: Neo-brutalist product UI for a designer-focused ASCII art playground.
colors:
  ink: "#1A1A1A"
  black: "#000000"
  paper: "#F5F5F0"
  canvas: "#FFFFFF"
  panel: "#E8E4DA"
  divider: "#D3CEC2"
  muted: "#6F6C65"
  digital-blue: "#4F8CFF"
  active-blue: "#005CFF"
  bauhaus-yellow: "#FFCC00"
  alert-red: "#EF3B33"
  success-green: "#6EDB8F"
typography:
  display:
    fontFamily: "Space Grotesk, Arial Black, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "0.06em"
  mono:
    fontFamily: "IBM Plex Mono, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  round-four: "4px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.round-four}"
    padding: "12px 20px"
  button-accent:
    backgroundColor: "{colors.bauhaus-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.round-four}"
    padding: "12px 20px"
  button-selected:
    backgroundColor: "{colors.active-blue}"
    textColor: "{colors.canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.round-four}"
    padding: "12px 16px"
  panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.round-four}"
    padding: "16px"
  input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
    rounded: "{rounded.round-four}"
    padding: "10px 12px"
---

# Design System: ascii-engine

## 1. Overview

**Creative North Star: "Form Follows Function"**

ascii-engine uses a neo-brutalist product interface: bold, raw, precise, and visibly constructed. The UI should feel like a designer's technical bench for image-to-ASCII work, with the preview as the main object and every control behaving like a compact editor instrument.

The visual system borrows from Bauhaus and brutalist architecture without becoming costume. Hard borders, square geometry, high-contrast typography, and sparse color create trust. Deliberate imperfection is allowed in the artwork and ASCII empty states; the product chrome stays crisp and controlled.

This system explicitly rejects generic SaaS dashboard UI, neon terminal overload, beige editorial design, glassmorphism, decorative card clutter, purple-blue AI gradients, and novelty ASCII cosplay. The ASCII output is the expressive object; the interface is the precise frame around it.

**Key Characteristics:**
- High-contrast cream, black, white, and gray surfaces with one active blue.
- Strong 1px and 2px borders instead of shadows.
- Compact product density built on a 4px spacing grid.
- Square panels, toolbars, inspectors, and modal shells with 4px radius.
- Monospace chips for technical status, glyph counts, values, seeds, and snippets.

## 2. Colors

The palette is high-contrast monochrome with Bauhaus utility accents. Color is rare and functional: selection, primary action, warning, status, and no decoration.

### Primary
- **Digital Blue** (#4F8CFF): The main interactive accent. Use for active navigation, selected presets, focus affordances, links, and selected tool states.
- **Active Blue** (#005CFF): A stronger blue for filled selected states when contrast against cream or gray must be unmistakable.

### Secondary
- **Bauhaus Yellow** (#FFCC00): Use for export, active sliders, "ready" status, and destructive-neutral emphasis where a designer needs to notice a control without reading it as danger.
- **Alert Red** (#EF3B33): Use for destructive actions, render-final warnings, invalid states, and the emphasized "click to pick a file" wordmark style.
- **Success Green** (#6EDB8F): Use only for small ready/success indicators.

### Neutral
- **Ink** (#1A1A1A): Primary text, borders, toolbar chrome, modal headers, and filled primary buttons.
- **Black** (#000000): Maximum contrast for modal headers, canvas-dark art modes, and occasional heavy rules.
- **Paper** (#F5F5F0): Main app background. It is a technical drafting surface, not editorial beige.
- **Canvas** (#FFFFFF): Artboard and embedded code surfaces when a pure work area is needed.
- **Panel** (#E8E4DA): Secondary furniture: sidebars, inspector groups, footer strips, and inactive tool areas.
- **Divider** (#D3CEC2): Thin internal separators and disabled component outlines.
- **Muted** (#6F6C65): Secondary labels and helper copy. Keep contrast AA-compliant.

### Named Rules

**The One Accent Rule.** Blue is for current selection, primary interaction, links, and focus. Do not use blue as ambient decoration.

**The No Gradient Rule.** No gradients, no glass, no soft glow, no shadow-as-style. Depth comes from borders, layers, and tonal surfaces.

**The Functional Red Rule.** Red means destructive, invalid, or upload call-to-action emphasis. It is not a brand color.

## 3. Typography

**Display Font:** Space Grotesk with Arial Black and system-ui fallback.
**Body Font:** system-ui with platform sans fallbacks.
**Label/Mono Font:** IBM Plex Mono with SFMono-Regular, Menlo, Consolas fallback.

**Character:** Typography should feel engineered and graphic. Labels are compact and assertive; values are technical; body text stays plain and readable.

### Hierarchy

- **Display** (700, 32px, 1): Large empty-state calls, modal titles, and major workspace moments. Keep letter spacing no tighter than -0.02em.
- **Headline** (700, 22px, 1.1): Panel headings, inspector group labels, export modal section titles, and major sidebar titles.
- **Title** (700, 16px, 1.2): Navigation items, preset names, layer labels, action card labels, and buttons.
- **Body** (400, 14px, 1.45): Helper copy, descriptions, documentation snippets inside the UI, and empty-state explanations. Keep long copy to 65-75ch.
- **Label** (700, 12px, 0.06em, uppercase): Control labels, group headers, compact metadata, and sidebar section labels.
- **Mono** (500, 12px, 1.35): Numeric values, coordinates, seeds, snippets, glyph counts, source IDs, and status chips.

### Named Rules

**The Information Grid Rule.** Designers should be able to scan the page by label, value, and state. Labels use Space Grotesk; values use mono; prose uses plain sans.

**The No Novelty Type Rule.** Do not use display fonts for form controls, inspector values, or long helper copy.

## 4. Elevation

This system is flat by default. It does not use decorative shadows. Depth is conveyed through black borders, inset separators, tonal panels, and the occasional offset hard edge on modals or selected cards. A surface should look assembled, not floating.

### Shadow Vocabulary

- **None at rest** (`box-shadow: none`): Default for panels, cards, controls, and toolbars.
- **Hard offset** (`box-shadow: 4px 4px 0 #1A1A1A`): Reserved for temporary top-layer UI such as export dialogs, active draggable layers, and selected sample cards. Never combine with soft blur.

### Named Rules

**The Border Is Structure Rule.** Use 1px borders for internal structure and 2px borders for primary panel edges, selected items, dialogs, and high-emphasis controls.

**The Quiet Furniture Rule.** Sidebars, inspectors, and control groups are furniture. They frame the work and should not compete with the artwork.

## 5. Components

### Buttons

- **Shape:** Round Four only (4px radius). Never pill buttons.
- **Primary:** Ink fill with white text for final actions, modal confirmation, and high-commit actions.
- **Accent:** Bauhaus Yellow fill with ink text for export and active workspace action buttons.
- **Selected:** Active Blue fill with white text, 2px ink border, and no shadow.
- **Hover / Focus:** 150ms ease-out. Hover may invert border/fill or add a 2px hard outline. Focus must be visible without relying on color alone.
- **Disabled:** Paper or panel fill, divider border, muted text, no opacity below 60 percent.

### Chips

- **Style:** Mono, compact, rectangular, 4px radius, 1px border.
- **Status:** Use tiny color squares or dots plus text. Green for ready, yellow for pending, red for blocked.
- **Metrics:** Glyph counts, viewport scale, render mode, cache entries, and version labels should be chips, not paragraphs.

### Cards / Containers

- **Corner Style:** 4px radius across all cards, panels, export tiles, preset tiles, code blocks, and inputs.
- **Background:** Paper for the main shell, canvas for artboards and code samples, panel for secondary controls.
- **Shadow Strategy:** No soft shadows. Use 1px or 2px ink borders and optional hard offset only for top-layer UI.
- **Border:** 2px ink for selected, modal, and primary work areas; 1px divider for internal panels.
- **Internal Padding:** 16px default; 12px for compact controls; 24px for modal body and main empty states.

### Inputs / Fields

- **Style:** Canvas fill, 1px or 2px ink border, mono values where the input carries technical data.
- **Focus:** Blue outline plus border weight change. Do not use glow.
- **Error / Disabled:** Red border and direct helper text for errors; muted text with panel background for disabled.
- **Sliders:** Heavy black track, yellow or blue thumb, mono value chip aligned to the right.

### Navigation

- **Top Bar:** Cream surface, 2px bottom border, brand at left, compact text navigation, icon actions at right.
- **Sidebar:** Paper or panel surface, 2px right border, stacked navigation with strong selected state.
- **Active Item:** Blue fill or underline, 2px ink border when presented as a block. Always include text and icon or text and strong position cue.
- **Mobile:** Collapse sidebars into a top tab or drawer; preserve the preview before secondary inspector controls.

### Preview Workspace

- **Artboard:** White or black canvas with 2px ink border. Keep the ASCII result visually centered and inspectable.
- **Drop Zone:** Dashed 2px ink border, oversized display type, red emphasis only on the clickable phrase.
- **Inspector:** Right-side technical controls with accordion groups, mono values, compact sliders, and no explanatory marketing copy.
- **Lasso / Masking:** Treat as a tool mode. Use blue selection state and visible dashed geometry, not translucent glass overlays.

### Export Dialog

- **Shell:** Ink header, paper body, hard offset edge, 2px border.
- **Title:** Display or headline type in white.
- **Code Block:** Canvas or paper code area with mono text, 1px or 2px border, and small status color squares.
- **Export Options:** Rectangular action tiles in a two-column grid on desktop, one column on mobile.
- **Footer:** Panel strip with ready chip, version chip, cancel link, and final action button.

### Empty States

- **Style:** ASCII-art driven or hard geometric file-upload iconography.
- **Copy:** Direct, imperative, and short. Example: "DROP AN IMAGE HERE OR CLICK TO PICK A FILE."
- **Samples:** Show sample cards as real visual choices with labels, not decorative marketing cards.

## 6. Do's and Don'ts

### Do:

- **Do** use a 4px base unit for spacing, size, and radius decisions.
- **Do** use strong 1px and 2px borders to define hierarchy.
- **Do** reserve Digital Blue (#4F8CFF) and Active Blue (#005CFF) for selected states, focus, links, and primary interactive state.
- **Do** keep the preview/workspace as the dominant surface.
- **Do** make inspector controls compact, grouped, and value-forward.
- **Do** use mono type for technical values, snippets, seeds, glyph counts, and status chips.
- **Do** respect `prefers-reduced-motion` by removing non-essential UI animation.
- **Do** use 150ms ease-out transitions for selection, accordion, hover, and panel changes.

### Don't:

- **Don't** make this look like generic SaaS dashboard UI.
- **Don't** use neon terminal overload. Black and monospace can appear, but the whole interface should not become a hacker theme.
- **Don't** use beige editorial styling. Paper is a drafting surface, not magazine warmth.
- **Don't** use glassmorphism, backdrop blur, translucent cards, or frosted overlays.
- **Don't** add decorative card clutter, nested cards, or repeated icon-heading-text grids.
- **Don't** use purple-blue AI gradients, gradient text, bokeh, or decorative background grids.
- **Don't** round controls into pills. Round Four is the rule.
- **Don't** pair soft shadows with borders. Use borders and hard offsets only.
- **Don't** hide important state in color alone.
