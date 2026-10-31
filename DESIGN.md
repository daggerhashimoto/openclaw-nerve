---
name: Nerve
description: A night-lit operator console for an OpenClaw agent fleet, where light temperature tells you who is acting.
colors:
  midnight: "#06080E"
  panel: "#0B0F17"
  raised: "#151C2A"
  popover: "#121826"
  rule: "#171E2C"
  input-edge: "#1F2736"
  reading-white: "#ECE6DA"
  slate: "#8C94A6"
  electric-blue: "#3D7EFF"
  electric-blue-text: "#4F8BFF"
  cantaloupe: "#FFA567"
  signal-red: "#FF5A5A"
  pane-off: "#161D2C"
  pane-edge: "#263044"
  identity-cantaloupe: "#FFA567"
  identity-mint: "#7CC99A"
  identity-lilac: "#B9A7FF"
  identity-aqua: "#7FD1C7"
  identity-rose: "#FF7A9E"
  identity-lemon: "#F2D46B"
  identity-sky: "#6FC3F7"
  operator-plate: "#231E1F"
  scrollbar: "#1D2433"
  success-green: "#7CC99A"
  daylight-paper: "#F3F5F9"
  daylight-panel: "#FFFFFF"
  daylight-raised: "#EAEEF4"
  daylight-rule: "#D9DFE8"
  daylight-ink: "#131722"
  daylight-slate: "#566072"
  daylight-blue: "#1F5FE0"
  daylight-cantaloupe: "#FF9F55"
  daylight-cantaloupe-text: "#B4520F"
  daylight-red: "#C8322F"
  daylight-pane-off: "#E4E9F1"
  daylight-pane-edge: "#B9C2D0"
  daylight-operator-plate: "#FFF7EF"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.267rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontVariation: "'opsz' 96, font-stretch 94%"
  name:
    fontFamily: "Bricolage Grotesque, Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.933rem"
    fontWeight: 700
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.867rem"
    fontWeight: 600
    lineHeight: 1.55
  body:
    fontFamily: "Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'kern' 1, 'liga' 1, 'calt' 1"
  ui:
    fontFamily: "Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.867rem"
    fontWeight: 500
    lineHeight: 1.55
  label:
    fontFamily: "Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8rem"
    fontWeight: 500
    lineHeight: 1.45
  mono:
    fontFamily: "Atkinson Hyperlegible Mono, JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace"
    fontSize: "0.8rem"
    fontWeight: 400
    lineHeight: 1
    fontFeature: "'tnum' 1"
  keycap:
    fontFamily: "Atkinson Hyperlegible Mono, JetBrains Mono, Fira Code, Cascadia Code, Consolas, monospace"
    fontSize: "0.733rem"
    fontWeight: 400
rounded:
  xs: "1px"
  sm: "2px"
  md: "3px"
  lg: "4px"
  float: "6px"
spacing:
  hairline: "1px"
  gap-xs: "2px"
  gap-sm: "4px"
  gap-md: "6px"
  gap: "8px"
  inset-sm: "10px"
  inset: "12px"
  row-unit: "1.867rem"
  control-unit: "2.133rem"
  top-bar: "2.933rem"
  touch-min: "44px"
  gutter: "24px"
  reading-measure: "72em"
components:
  pane:
    backgroundColor: "{colors.pane-off}"
    rounded: "{rounded.xs}"
    width: "0.667rem"
    height: "0.933rem"
  pane-live:
    backgroundColor: "{colors.electric-blue}"
    rounded: "{rounded.xs}"
    width: "0.667rem"
    height: "0.933rem"
  pane-operator:
    backgroundColor: "{colors.cantaloupe}"
    rounded: "{rounded.xs}"
    width: "0.667rem"
    height: "0.933rem"
  pane-error:
    backgroundColor: "{colors.signal-red}"
    rounded: "{rounded.xs}"
    width: "0.667rem"
    height: "0.933rem"
  pane-sm:
    backgroundColor: "{colors.pane-off}"
    rounded: "{rounded.xs}"
    width: "0.533rem"
    height: "0.733rem"
  button-primary:
    backgroundColor: "{colors.cantaloupe}"
    textColor: "{colors.midnight}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0 0.875rem"
    height: "2rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.reading-white}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 0.875rem"
    height: "2.25rem"
  button-outline-hover:
    backgroundColor: "{colors.raised}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 0.875rem"
    height: "2.25rem"
  button-ghost-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.reading-white}"
  button-destructive:
    backgroundColor: "{colors.signal-red}"
    textColor: "{colors.midnight}"
    rounded: "{rounded.md}"
    padding: "0 0.875rem"
    height: "2.25rem"
  shell-chip:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "{spacing.row-unit}"
  shell-chip-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.reading-white}"
  shell-chip-active:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.reading-white}"
  shell-icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 6px"
    size: "{spacing.row-unit}"
  shell-icon-button-hover:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.reading-white}"
  seg-track:
    backgroundColor: "{colors.midnight}"
    rounded: "{rounded.lg}"
    padding: "2px"
  input:
    backgroundColor: "{colors.midnight}"
    textColor: "{colors.reading-white}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "{spacing.control-unit}"
  inline-select-trigger:
    backgroundColor: "transparent"
    textColor: "{colors.reading-white}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "1.75rem"
  inline-select-trigger-hover:
    backgroundColor: "{colors.raised}"
  plate:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.md}"
  plate-operator:
    backgroundColor: "{colors.operator-plate}"
    textColor: "{colors.reading-white}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  tool-row:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.reading-white}"
    typography: "{typography.mono}"
    padding: "0 10px"
    height: "{spacing.row-unit}"
  tool-row-hover:
    backgroundColor: "{colors.raised}"
  composer:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.reading-white}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
  panel-header:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.reading-white}"
    typography: "{typography.title}"
    padding: "0 4px 0 12px"
    height: "{spacing.row-unit}"
  keycap:
    backgroundColor: "{colors.midnight}"
    textColor: "{colors.slate}"
    typography: "{typography.keycap}"
    rounded: "{rounded.sm}"
    padding: "0 5px"
    height: "1.333rem"
  badge:
    backgroundColor: "transparent"
    textColor: "{colors.slate}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
    height: "1.333rem"
  command-shell:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.reading-white}"
    rounded: "{rounded.float}"
---

# Design System: Nerve

## Overview

**Creative North Star: "Night Light"**

An operator's console is a building seen at night. You do not read the facade by its architecture; you read it by which rooms are lit and how warm the light is. Nerve borrows that reading. Cold electric blue is an agent at work. Warm cantaloupe is the operator, and anything that has finished and now waits on the operator. When work is done the window goes dark. Colour never decorates, it reports, and because every lit surface means something, the shell can hold a whole fleet in a glance without asking for attention.

The mood is midnight, exact, calm, dense, lit. This is an Operate-mode surface that stays open for hours, so the brand lives in precise details rather than expression: a 28px row unit shared by every list row, tool row and panel header; plates that read by value and a 1px edge light instead of drawn borders; one display face reserved for the wordmark and the names of agents and speakers; prose held to a measure that spans the column. Density is welcome because nothing pulses, glows or gradients. State changes are a light switch, 120ms, on or off.

The system refuses the hacker costume (scanlines, glowing HUD chrome, tracked uppercase labels), the grey dashboard with one decorative accent, glass and gradients, coloured side rails, and any pulsing or breathing motion. Daylight is the same building by day: cool paper, printed hairlines instead of edge light, panes printed as ink swatches, identical meanings. The previous appearance survives only as an opt-in Classic skin scoped under its own attribute and is not part of this system.

**Key Characteristics:**
- Light temperature is the state vocabulary: blue works, cantaloupe waits on you, red failed, dark is done.
- Flat lit panes (10x14 default, 8x11 small) are the only state marker; no glows, dots, rails or glyph icons.
- One 28px row unit across list rows, tool rows, panel headers and the status bar; the top bar is 44px.
- Raised plates read by tonal value plus a 1px top edge light; only floating surfaces cast a real offset shadow.
- Corners stay between 1px and 4px; larger radius steps clamp to 4px.
- Atkinson Hyperlegible Next for reading and UI, Atkinson Hyperlegible Mono with tabular numerals for measures, Bricolage Grotesque for names only.
- Sentence case everywhere; no eyebrows, kickers or tracked caps.
- Motion is a 120ms switch with a near-linear ease-out; reduced motion makes it instant.

## Colors

A deep blue-black night with two temperatures of light on it, a warm reading white for text, and a cool slate for everything secondary.

### Primary
- **Cantaloupe** (`cantaloupe`): the operator's light. It fills the Send button, the caret, the focus ring, text selection at 30%, the operator's pane, the operator plate's edge light, the composer border while the operator is inside it, and the hover colour of link underlines. It also marks finished work waiting on the operator (unread sessions, fleet pane). It never appears as decoration or on an agent's output.

### Secondary
- **Electric Blue** (`electric-blue`): agent work in progress. Lights a pane while a session runs, a tool row while it executes, the streaming cursor, the file the agent is touching in the workspace tree, and the fleet pane beside the wordmark. **Electric Blue Text** (`electric-blue-text`) is the slightly lifted tint used for live measures and elapsed clocks so the text passes on the panel ground.

### Tertiary
- **Signal Red** (`signal-red`): failure only. An error pane, a failed message's marker, destructive buttons and their hover border. It is the destructive token as well, so there is one red.
- **Success Green** (`success-green`): confined to diff additions, copy-confirmed feedback and the new-file view. Never a state pane.

### Neutral
- **Midnight** (`midnight`): the ground. The centre column, inputs, the segmented track's sunk channel, keycaps and the composer band sit on it.
- **Panel** (`panel`): one step up. Side columns, the top bar, status bar, panel headers, plates and tool stacks.
- **Raised** (`raised`): the hover and selected fill for rows, chips, icon buttons and the active chip on the segmented track; also inline code background.
- **Popover** (`popover`): floating menus, the command palette and inline select listboxes.
- **Rule** (`rule`): hairline dividers, panel borders and the tool stack's row separators. It is kept low so plates read by value, not by lines.
- **Input Edge** (`input-edge`): the one stroke that is allowed to be drawn: text inputs, outline buttons and inline select triggers at rest.
- **Reading White** (`reading-white`): all primary text and the wordmark; warm so prose does not glare at night.
- **Slate** (`slate`): secondary text, chip labels at rest, tool arguments, metadata and placeholders.
- **Pane Off** and **Pane Edge** (`pane-off`, `pane-edge`): a dark window with a 1px inset edge; Pane Edge is also the blockquote rule, link underline at rest, and the active toolbar button's border.
- **Operator Plate** (`operator-plate`): Panel warmed by roughly 10% cantaloupe, the ground of the operator's message.
- **Scrollbar** (`scrollbar`): a quiet rule, never a feature.

Daylight (`daylight-*`) keeps every role and swaps the values: paper ground, white panels, ink text, a darker blue and cantaloupe text tone so both pass on paper, and pane edges that print as a visible hairline.

### Identity
Seven hues name agent families, not states: Cantaloupe (#FFA567, reserved for the main agent), Mint (#7CC99A), Lilac (#B9A7FF), Aqua (#7FD1C7), Rose (#FF7A9E), Lemon (#F2D46B) and Sky (#6FC3F7). A family's hue is assigned on first sight, least-used first, remembered in the browser, and adjustable by the operator from a root row's actions. Subagents and cron children take lighter shades of the parent hue (62% and 44% of the hue mixed toward white). Electric Blue is deliberately absent from this list so an idle blue family can never be mistaken for work in progress.

### Named Rules
**The Light Temperature Rule.** Blue is agent work, cantaloupe is the operator and anything waiting on the operator, red is error, and nothing else is coloured. A surface that is not reporting one of those three states is a neutral.

**The Identity Rule.** An agent family's hue shows only in the glass of a pane whose light is off: 56% of the hue mixed into Pane Off for the fill and 62% into Pane Edge for the frame. The moment a pane lights, it speaks the state colour and nothing else. Identity never appears as a rail, a tinted row or a coloured name.

## Typography

**Display Font:** Bricolage Grotesque (with Atkinson Hyperlegible Next, Helvetica Neue, Arial)
**Body Font:** Atkinson Hyperlegible Next (with Helvetica Neue, Arial)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with JetBrains Mono, Fira Code, Cascadia Code, Consolas)

**Character:** Atkinson carries the whole console at a 15px base with kerning, ligatures and contextual alternates on; it is built for legibility at small sizes and long sessions. Bricolage Grotesque appears only where a name is spoken: the wordmark at its display optical size and 94% width, and agent or speaker names. The mono face shares Atkinson's skeleton so code and measures feel like the same voice, with tabular numerals so counts and clocks do not shimmer.

### Hierarchy
- **Display** (700, 1.267rem, line-height 1, -0.03em, opsz 96, width 94%): the Nerve wordmark only, followed by the 8x12 fleet pane.
- **Name** (700 or 600, 0.933rem in the chat header, inherits size in rows and message headers, -0.01em): agent and speaker names in the session header, top-level session rows and message headers. The operator's name takes Cantaloupe text.
- **Headline** (600, 1.2rem, 1.2, -0.01em): section titles on settings and dialog surfaces.
- **Title** (600, 0.867rem): panel header labels, field labels, Send, table heads.
- **Body** (400, 1rem, 1.6): agent prose, held to the 72em reading measure (about 140 characters, which is the whole column on most screens). Code blocks, tables and charts may take the full column.
- **UI** (500, 0.867rem): chips, list rows, inputs, toolbar buttons, tree entries.
- **Label** (500, 0.8rem): status bar, metadata, hints, badges, intermediate assistant messages at 0.7 opacity.
- **Mono** (400, 0.8rem, tabular): tool rows, timestamps, durations, model names, inline select menus and code block language bars. Keycaps drop to 0.733rem.

### Named Rules
**The Names Rule.** Bricolage Grotesque is used only for the wordmark and for agent or speaker names. Headings, labels and buttons stay in Atkinson.

**The Sentence Case Rule.** Every label, header, chip and button is sentence case. No eyebrows, no kickers above headings, no letterspaced capitals.

## Layout

Three columns on one dark ground, no outer chrome. A 44px top bar carries the wordmark and fleet pane, the Chat and Tasks segmented track, usage and settings. Below it the workspace tree sits left, the transcript and composer in the centre, and the agents column right with the session rows and then Memory, Crons, Tasks and Config. A 28px status bar closes the frame with connection pane and counts in words. Column widths are user-resizable (ResizablePanels stores percentages), and the layout collapses to a single column with panel toggles at 900px.

Vertical rhythm is the row unit: 1.867rem (28px at the 15px base) for every list row, tool row, panel header, slash menu item and the status bar. Controls that hold text input use 2.133rem (32px); on viewports at or under 640px chips, icon buttons and inputs grow to a 44px minimum and inputs go to 16px text so mobile browsers do not zoom. Horizontal insets are 12px on panel headers and plates, 10px on chips and tool rows, 4px to 8px between siblings.

In the transcript every message, tool stack and plate shares one left text edge. The state pane sits in a 24px gutter to the left of that edge, so the lit panes form a spine down the column. Prose is capped at the 72em reading measure, which is the whole column on most screens; the transcript and the composer span the column edge to edge.

### Named Rules
**The One Row Rule.** Every list row, tool row, panel header and the status bar sits on the 1.867rem (28px) row unit; density comes from sharing one rhythm, not from shrinking it.

## Elevation & Depth

Nerve is a tonal system with one lighting trick. Depth comes from stepping value: Midnight ground, Panel one step up, Raised for hover and selection, Popover for anything floating. A raised plate does not draw a border; it carries a 1px highlight along its top edge (the edge light) so it reads as a lit surface against the ground. Only surfaces that truly float (the composer, popovers, menus, the command palette) cast a real offset shadow, and they keep the edge light too. There is never a zero-offset glow, and nothing animates its shadow.

In Daylight there is no edge to catch light, so the plate token becomes a printed hairline in the rule colour and the float shadow softens to an ink tint.

### Shadow Vocabulary
- **Edge light** (`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055)`): every plate, tool stack and the active chip on the segmented track. Daylight: `inset 0 0 0 1px var(--color-border)`.
- **Warm edge light** (`box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-operator) 30%, transparent)`): the operator's message plate. Daylight: `inset 0 0 0 1px color-mix(in srgb, var(--color-operator) 45%, var(--border))`.
- **Float** (`box-shadow: 0 14px 36px rgba(0, 0, 0, 0.46), 0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.07)`): the composer and the command palette shell. Daylight: `0 14px 36px rgba(19, 23, 34, 0.14), 0 1px 2px rgba(19, 23, 34, 0.08), inset 0 0 0 1px var(--border)`.
- **Menu** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32)`): inline select listboxes, slash menus and top bar panels.
- **Pane edge** (`box-shadow: inset 0 0 0 1px var(--color-pane-edge)`): a dark pane's window frame; it drops to none when the pane lights.

### Named Rules
**The Edge Light Rule.** Plates read by value and a 1px top highlight, not by drawn borders; Daylight prints a hairline instead. Drawn borders are reserved for inputs, outline buttons and hairline dividers.

**The Switch Rule.** State changes switch in 120ms with `cubic-bezier(0.2, 0, 0, 1)`; nothing breathes or pulses, and reduced motion makes every transition and animation instant. Entrances (messages, menus, drawers) fade or slide once in 140ms to 220ms using the same ease.

## Shapes

Corners are tight and deliberate. Panes are 1px, keycaps and badges 2px, buttons, chips, inputs, plates and tool stacks 3px, the composer and segmented track 4px, and the command palette shell 6px. The radius scale is clamped: every larger step resolves to 4px so legacy utilities cannot round a panel again, and shell panels are square. Panes are upright rectangles, taller than wide (10x14), never circles or dots, and never carry a glyph.

Borders are hairlines in the rule colour or the input edge colour, 1px, used for dividers, inputs and outline controls. Everything else is a plate: a flat fill with an edge light. Content inside stacks is clipped to the stack's radius.

## Components

Flat, exact, lit. Controls are quiet fills that step to Raised on hover; state is shown by the lit pane next to them, never by a coloured background on the control itself.

### Pane (signature component)
The state marker and the whole brand in one element. An inline rectangle, 0.667rem by 0.933rem (10x14), radius 1px. Off: Pane Off fill with a 1px inset Pane Edge frame. Live: Electric Blue fill, frame removed. Operator: Cantaloupe fill. Error: Signal Red fill. Small (0.533rem by 0.733rem, 8x11) sits on text lines: tool rows, message headers, the chat header's run state, composer voice state. The brand pane beside the wordmark is 0.533rem by 0.8rem. Transitions are background and box-shadow over 120ms; colour is never the only signal, so a pane with no adjacent text carries an accessible label (Running, Waiting on you, Failed, Idle). The browser tab icon is the same mark on a Midnight ground: Reading White at rest, blue while any agent works, cantaloupe when work waits, red on failure. A pane that belongs to an agent family carries its identity hue in the off state only (see The Identity Rule), so idle rows, the chat header and the transcript still say whose room it is.

### Buttons
- **Shape:** tight corners (3px), 1px transparent border reserved for outline and secondary variants, 120ms transition on background, border, colour and filter, 1px downward press on active.
- **Primary (Send):** Cantaloupe fill with a Midnight label, 600 weight at 0.867rem, 0 by 0.875rem padding, 2rem tall (2.75rem on touch viewports). Hover raises brightness 10%; a sent message flashes it brighter for 200ms; a send error shakes it 2px. It is the one warm control on the screen.
- **Hover / Focus:** every variant takes a 2px Cantaloupe outline offset 1px on focus-visible. Disabled drops to 50% opacity.
- **Outline:** transparent fill, Input Edge stroke, Reading White text, Raised on hover. **Ghost:** no stroke, Slate text, Raised fill and Reading White text on hover. **Destructive:** Signal Red fill with a Midnight label. **Link:** Reading White text underlined in Pane Edge, underline turns Cantaloupe on hover.
- **Toolbar button:** row-unit tall, Rule stroke, Reading White text; active state takes Raised fill and a Pane Edge stroke.

### Chips
- **Shell chip:** transparent, Slate text at 0.867rem 500, row-unit tall, 0 by 10px padding, 3px radius. Hover and active both switch to Raised fill with Reading White text. No stroke, no accent colour.
- **Segmented track:** a Midnight channel with 2px padding and 4px radius holding chips 6px shorter than the row unit; the active chip is lifted onto the track with Raised fill and the edge light.
- **Badge:** 1.333rem tall, 2px radius, Rule stroke, Slate text at 0.8rem. Tones tint the stroke by mixing 45% of the state colour into Rule: live takes Electric Blue Text, primary and warning take Cantaloupe text, danger takes Signal Red.

### Cards / Containers
- **Corner Style:** 3px for plates and tool stacks, 4px for the composer, 6px for the command palette.
- **Background:** Panel; Popover for floating menus.
- **Shadow Strategy:** edge light on plates (The Edge Light Rule); float shadow on the composer and command palette; menu shadow on listboxes.
- **Border:** none on plates. Panel headers have a hairline below in Rule. Code blocks and tool result details keep a Rule hairline because they sit inside prose.
- **Internal Padding:** 12px horizontal on headers and plates, 8px 12px on message plates, 10px 12px on code blocks.
- **Operator plate:** the operator's whole turn (name, time and body) sits on Operator Plate (Panel warmed by 10% cantaloupe), 3px radius, warm edge light, no border, width fit to content and capped at the reading measure. The small pane in the gutter is Cantaloupe and the speaker name is Cantaloupe text in the display face.
- **Tool stack:** consecutive tool rows share one plate with the edge light, clipped to 3px, divided by Rule hairlines.

### Inputs / Fields
- **Style:** Midnight fill, 1px Input Edge stroke, 3px radius, 2.133rem tall (2.75rem on touch), 0 by 10px padding, UI size text, Slate placeholder.
- **Focus:** stroke turns Cantaloupe and a 1px Cantaloupe outline sits flush on it; no glow.
- **Error / Disabled:** aria-invalid turns the stroke Signal Red; disabled drops to 50% opacity and refuses the pointer.
- **Composer:** a floating plate on Panel with the float shadow, 4px radius, a 1px border that is transparent at rest and Cantaloupe at 60% while the operator is typing (solid Cantaloupe while recording). The textarea is borderless at 1rem on a 42px minimum height; a toolbar row below holds shell icon buttons on the left, shortcut hints as keycaps on the right, and Send at the end. The composer spans the column together with the transcript.
- **Inline select trigger:** transparent, Input Edge stroke, 3px radius, 0.8rem text, 1.75rem tall on desktop (2.75rem on touch), Raised on hover, chevron in Slate. Its listbox is Popover with a Rule stroke, the menu shadow and 0.667rem mono options.
- **Keycap:** inline flex, 1.333rem tall, 0 by 5px padding, 2px radius, Rule stroke, Midnight fill, mono at 0.733rem in Slate. Used for composer shortcut hints and nowhere decorative.

### Navigation
- **Top bar:** 2.933rem (44px) tall on Panel with a Rule hairline below; wordmark then fleet pane at left, the Chat and Tasks segmented track, usage and settings as shell icon buttons at right. On viewports under 372px the chips drop to a 40px minimum.
- **Shell icon button:** row-unit square, 3px radius, Slate icon, Raised fill and Reading White on hover and when active; icons never shrink.
- **Panel header:** row-unit tall, Panel fill, Rule hairline below, 0 4px 0 12px padding, 600 label at 0.867rem in sentence case.
- **List rows (sessions, tree):** row-unit tall, 0.867rem text, Raised on hover and when selected; a pane leads the row (default size in the agents column, small in the tree). Top-level session names use the display face; folders in the workspace tree carry 500 weight instead of type icons.
- **Status bar:** row-unit tall, Panel with a Rule hairline above, 0.8rem Slate text; a connection pane, then counts in words with tabular numerals, version in mono at the right.
- **Wordmark:** Bricolage Grotesque, 1.267rem, 700, 94% width, display optical size, -0.03em, Reading White, followed by the fleet pane.

### Tool row
One 28px line of mono text at 0.8rem: a small pane (live while running, off when done, red when failed), the verb in Reading White capped at 45% width, the arguments in Slate, and a right-aligned tabular measure that turns Electric Blue Text while live. Expandable rows take Raised on hover and focus and end with a 14px chevron in Slate.

## Do's and Don'ts

### Do:
- **Do** show state only with a lit pane: Electric Blue for agent work, Cantaloupe for the operator and work waiting on the operator, Signal Red for failure, Pane Off when done (The Light Temperature Rule).
- **Do** tint an off pane with its agent family's identity hue and leave lit panes to the state colours (The Identity Rule).
- **Do** switch panes and hover fills in 120ms with `cubic-bezier(0.2, 0, 0, 1)` and let reduced motion make them instant (The Switch Rule).
- **Do** build raised surfaces as plates: Panel fill plus the 1px edge light, no drawn border; in Daylight the token prints a hairline (The Edge Light Rule).
- **Do** keep every list row, tool row, panel header and the status bar on the 1.867rem row unit (The One Row Rule).
- **Do** reserve Bricolage Grotesque for the wordmark and agent or speaker names (The Names Rule).
- **Do** hold agent prose to the 72em reading measure and let code, tables and charts take the column.
- **Do** set timestamps, counts, durations, models and code in Atkinson Hyperlegible Mono with tabular numerals.
- **Do** keep corners between 1px and 4px; 6px is only for the floating command palette shell.
- **Do** make Send the one warm control on a screen: Cantaloupe fill, Midnight label, 3px radius.
- **Do** give every pane without adjacent text an accessible label (Running, Waiting on you, Failed, Idle).

### Don't:
- **Don't** colour anything that is not reporting agent work, operator ownership, an error, or an agent family's identity inside an off pane; no decorative accents, coloured side rails or tinted headers.
- **Don't** pulse, breathe, glow or animate a shadow; the only blinking element is the streaming cursor pane, and it stops under reduced motion.
- **Don't** add scanlines, HUD chrome, letterspaced uppercase labels, eyebrows or kickers above headings; labels are sentence case.
- **Don't** use glass, blur, gradients or zero-offset shadows; depth is tonal value plus the edge light, and only floating surfaces cast an offset shadow.
- **Don't** draw a border around a plate; borders belong to inputs, outline buttons and hairline dividers.
- **Don't** replace a pane with a dot, a circle, a badge or a glyph icon, and never make colour the only signal.
- **Don't** use Bricolage Grotesque for headings, labels or buttons, or a system display face anywhere.
- **Don't** round panels or shell surfaces beyond 4px, or reintroduce the Classic skin's rounded panels and amber accents into the Nerve style.
