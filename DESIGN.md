---
name: Nerve
description: A night-lit operator console for an OpenClaw agent fleet, where light temperature tells you who is acting.
colors:
  midnight: "#06080E"
  panel: "#0D121C"
  plate: "#121926"
  raised: "#1A2232"
  popover: "#1B2334"
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
  operator-plate: "#372A25"
  scrollbar: "#1D2433"
  success-green: "#7CC99A"
  daylight-paper: "#F3F5F9"
  daylight-panel: "#FFFFFF"
  daylight-plate: "#F7F9FC"
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
  daylight-operator-plate: "#FFEBD6"
typography:
  display:
    fontFamily: "Geist, Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.533rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  nameplate:
    fontFamily: "Geist, Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.2rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  name:
    fontFamily: "Geist, Atkinson Hyperlegible Next, Helvetica Neue, Arial, sans-serif"
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

An operator's console is a building seen at night. You do not read the facade by its architecture; you read it by which rooms are lit and how warm the light is. Nerve borrows that reading. Cold electric blue is an agent at work. Warm cantaloupe is the operator, and anything that has finished and now waits on the operator. When work is done the window goes back to its family colour: every room keeps its own light on at idle, so the building reads as inhabited, and only a lit pane blooms, which is how work shows. Colour never decorates, it reports, and because every lit surface means something, the shell can hold a whole fleet in a glance without asking for attention.

The mood is midnight, exact, calm, dense, lit. This is an Operate-mode surface that stays open for hours, so the brand lives in precise details rather than expression: a 28px row unit shared by every list row, tool row and panel header; plates that read by value and a 1px edge light instead of drawn borders; one display face reserved for the wordmark and the names of agents and speakers; prose held to a measure that spans the column. Density is welcome because nothing pulses; the only light that spreads is a lit pane's bloom, and the only gradient is the room's ambient light from above. State changes are a light switch, 120ms, on or off.

The system refuses the hacker costume (scanlines, glowing HUD chrome, tracked uppercase labels), the grey dashboard with one decorative accent, glass and decorative gradients, coloured side rails, and any pulsing or breathing motion. Daylight is the same building by day: cool paper, printed hairlines instead of edge light, panes printed as ink swatches, identical meanings. The previous appearance and its community themes are retired; Night and Daylight are the only two themes.

**Key Characteristics:**
- Light temperature is the state vocabulary: blue works, cantaloupe waits on you, red failed, dark is done.
- Panes are the state marker: an idle pane shows its family colour at 84% strength, a lit pane switches to the state colour and casts a short bloom; no dots, rails or glyph icons.
- One 28px row unit across list rows, tool rows, panel headers and the status bar; the top bar is 44px.
- The shell is a Midnight frame around one lifted Panel room with a 6px reveal; tool stacks, code and the composer step up once more to Plate.
- Raised plates read by tonal value plus a 1px top edge light; only floating surfaces cast a real offset shadow.
- Corners stay between 1px and 4px; larger radius steps clamp to 4px.
- Atkinson Hyperlegible Next for reading and UI, Atkinson Hyperlegible Mono with tabular numerals for measures, Geist for names only.
- Sentence case everywhere; no eyebrows, kickers or tracked caps.
- Motion is a 120ms switch with a near-linear ease-out; light travels down the spine 70ms per region when a run starts; a new turn lands with one 200ms rise; arrivals decelerate on the arrive ease; reduced motion makes all of it instant.
- The composer is the operator's next window: a dark plate with a dark gutter pane at rest, warmed to the operator plate with a lit pane while the operator is in it.

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
- **Midnight** (`midnight`): the ground and the frame. The top bar, both side columns, the status bar, inputs and keycaps sit on it.
- **Panel** (`panel`): one step up, the room. The centre column (chat header, transcript, composer band) is one lifted plate of Panel inside the Midnight frame; the segmented track in the top bar also sits on it.
- **Plate** (`plate`): one more step, for surfaces inside the room: tool stacks, code blocks and the composer.
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
**The Light Temperature Rule.** Blue is agent work, cantaloupe is the operator and anything waiting on the operator, red is error, and nothing else is coloured. A surface that is not reporting one of those three states is a neutral. Family hues are identity, not state: they sit on idle panes, on names, on the header band and on the open row, and a pane that is lit always shows the state colour with its bloom.

**The Identity Rule.** Every agent family owns one of seven hues (main is pinned to Cantaloupe; children take a lighter shade of their root's hue), assigned on first sight and operator-pickable from a root row. The hue stays on at idle: 84% of it fills the family's off panes (70% in the frame), the agent's name takes it in the display face (darkened 42% toward ink in Daylight), the chat header band takes a 9% tint (14% in Daylight) and the open room's row a 14% tint over Raised. Electric Blue is never an identity hue, and a lit pane always shows the state colour, so identity and state never trade places.

**The Window Rule.** The composer is the operator's next window. At rest it is a dark plate with a dark pane in the gutter; while the operator is in it (focus, or text already typed) it warms to Operator Plate with the warm edge light and the pane lights Cantaloupe, so the turn being written looks like the turns already sent. The side-column editors are windows too: the memory editor and the config editor sit on Plate and, while the operator is in them, warm to Operator Plate with the warm edge light while the small pane in their status line lights Cantaloupe; no focus ring, no drawn border.

## Typography

**Display Font:** Geist (with Atkinson Hyperlegible Next, Helvetica Neue, Arial)
**Body Font:** Atkinson Hyperlegible Next (with Helvetica Neue, Arial)
**Label/Mono Font:** Atkinson Hyperlegible Mono (with JetBrains Mono, Fira Code, Cascadia Code, Consolas)

**Character:** Atkinson carries the whole console at a 15px base with kerning, ligatures and contextual alternates on; it is built for legibility at small sizes and long sessions. Geist appears only where a name is spoken: the wordmark, the nameplate of the open session in the chat header, and agent or speaker names, always at 700 weight with tight tracking. The mono face shares Atkinson's skeleton so code and measures feel like the same voice, with tabular numerals so counts and clocks do not shimmer.

### Hierarchy
- **Display** (700, 1.533rem, line-height 1, -0.03em): the Nerve wordmark only, followed by the 12x17 fleet pane.
- **Nameplate** (700, 1.2rem, line-height 1.1, -0.02em): the open session's agent name in the chat header, in its family hue; the one place a name is set larger than the text around it.
- **Name** (700 or 600, inherits size in rows and message headers, -0.01em): agent and speaker names in top-level session rows and message headers. An agent's name takes its family hue (darkened toward ink in Daylight); the operator's name stays in Reading White on its warm plate.
- **Headline** (600, 1.2rem, 1.2, -0.01em): section titles on settings and dialog surfaces.
- **Title** (600, 0.867rem): panel header labels, field labels, Send, table heads.
- **Body** (400, 1rem, 1.6): agent prose, held to the 72em reading measure (about 140 characters, which is the whole column on most screens). Code blocks, tables and charts may take the full column.
- **UI** (500, 0.867rem): chips, list rows, inputs, toolbar buttons, tree entries.
- **Label** (500, 0.8rem): status bar, metadata, hints, badges, intermediate assistant messages at 0.7 opacity.
- **Mono** (400, 0.8rem, tabular): tool rows, timestamps, durations, model names, inline select menus and code block language bars. Keycaps drop to 0.733rem.

### Named Rules
**The Names Rule.** Geist is used only for the wordmark and for agent or speaker names. Headings, labels and buttons stay in Atkinson.

**The Sentence Case Rule.** Every label, header, chip and button is sentence case. No eyebrows, no kickers above headings, no letterspaced capitals.

## Layout

Three columns on one dark ground, no outer chrome. A 44px top bar carries the wordmark and fleet pane, the Chat and Tasks segmented track, usage and settings. Below it the workspace tree sits left, the transcript and composer in the centre, and the agents column right with the session rows and then Memory, Crons, Tasks and Config. A 28px status bar closes the frame with connection pane and counts in words. Column widths are user-resizable (ResizablePanels stores percentages), and the layout collapses to a single column with panel toggles at 900px.

Vertical rhythm is the row unit: 1.867rem (28px at the 15px base) for every list row, tool row, panel header, slash menu item and the status bar. Controls that hold text input use 2.133rem (32px); on viewports at or under 640px chips, icon buttons and inputs grow to a 44px minimum and inputs go to 16px text so mobile browsers do not zoom. Horizontal insets are 12px on panel headers and plates, 10px on chips and tool rows, 4px to 8px between siblings.

In the transcript every message, tool stack and plate shares one left text edge. The state pane sits in a 24px gutter to the left of that edge, so the lit panes form a spine down the column. Prose is capped at the 72em reading measure, which is the whole column on most screens; the transcript and the composer span the column edge to edge.

### Named Rules
**The One Row Rule.** Every list row, tool row, panel header and the status bar sits on the 1.867rem (28px) row unit; density comes from sharing one rhythm, not from shrinking it.

## Elevation & Depth

Nerve is a tonal system with one lighting trick. Depth comes from stepping value: Midnight for the frame, Panel for the room, Plate for surfaces inside the room, Raised for hover and selection, Popover for anything floating. A raised plate does not draw a border; it carries a 1px highlight along its top edge (the edge light) so it reads as a lit surface against the ground. Only surfaces that truly float (the composer, popovers, menus, the command palette) cast a real offset shadow, and they keep the edge light too. There is never a zero-offset glow, and nothing animates its shadow.

In Daylight there is no edge to catch light, so the plate token becomes a printed hairline in the rule colour and the float shadow softens to an ink tint.

### Shadow Vocabulary
- **Edge light** (`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055)`): every plate, tool stack and the active chip on the segmented track. Daylight: `inset 0 0 0 1px var(--color-border)`.
- **Warm edge light** (`box-shadow: inset 0 1px 0 color-mix(in srgb, var(--color-operator) 30%, transparent)`): the operator's message plate. Daylight: `inset 0 0 0 1px color-mix(in srgb, var(--color-operator) 45%, var(--border))`.
- **Float** (`box-shadow: 0 14px 36px rgba(0, 0, 0, 0.46), 0 1px 2px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.07)`): the composer and the command palette shell. Daylight: `0 14px 36px rgba(19, 23, 34, 0.14), 0 1px 2px rgba(19, 23, 34, 0.08), inset 0 0 0 1px var(--border)`.
- **Menu** (`box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32)`): inline select listboxes, slash menus and top bar panels.
- **Pane edge** (`box-shadow: inset 0 0 0 1px var(--color-pane-edge)`): a dark pane's window frame; it drops to none when the pane lights.
- **Bloom** (`box-shadow: 0 0 9px 0 color-mix(in srgb, <state colour> 58% to 62%, transparent)`): the light a lit pane throws on the ground, in the pane's own colour (`--bloom-live`, `--bloom-operator`, `--bloom-error`); Daylight sets all three to none.
- **Room light** (`radial-gradient(120% 70% at 50% 0%, 8% Electric Blue in Midnight, Midnight 60%)`): the transcript ground's ambient light from above, so the composer floats in the darkest part of the room; Daylight has none.

### Named Rules
**The Edge Light Rule.** Plates read by value and a 1px top highlight, not by drawn borders; Daylight prints a hairline instead. Drawn borders are reserved for inputs, outline buttons and hairline dividers.

**The Frame Rule.** The shell is a dark frame around one lifted room. Top bar, side columns and status bar sit flat on Midnight with hairlines only; the centre column is a single plate of Panel with the edge light and 4px corners, and the frame shows for 6px around it. Surfaces inside the room step up once more to Plate. Nothing else in the shell is a plate.

**The Switch Rule.** State changes switch in 120ms with `cubic-bezier(0.2, 0, 0, 1)`; nothing breathes or pulses, and reduced motion makes every transition and animation instant. Light travels: when a run starts, the fleet pane beside the wordmark comes on first, the chat header 70ms later, the agents column at 140ms and the transcript gutter at 210ms, so state arrives as one sweep down the spine; lights go out together. Arrivals (drawers, menus, the lifted chip crossing its track) use the arrive ease `cubic-bezier(0.16, 1, 0.3, 1)` at 180ms to 260ms, never a bounce. The Chat and Tasks switch is a view transition: the lifted chip slides across the segmented track in 220ms while the room cross-fades in 160ms. On send the composer lifts 3px and settles in 220ms as the turn leaves it and lands in the transcript. Entrances (messages, menus, drawers) fade or slide once in 140ms to 220ms using the same ease; a new turn in the transcript lands with one 200ms rise of 6px and a fade, and that is the transcript's only entrance.

**The Bloom Rule.** A lit pane casts a short bloom of its own colour, and that is the only light in the system that spreads: off panes, plates, buttons and text never glow. The bloom switches on and off with the pane in 120ms. Daylight prints panes flat.

## Shapes

Corners are tight and deliberate. Panes are 1px, keycaps and badges 2px, buttons, chips, inputs, plates and tool stacks 3px, the composer and segmented track 4px, and the command palette shell 6px. The radius scale is clamped: every larger step resolves to 4px so legacy utilities cannot round a panel again, and shell panels are square. Panes are upright rectangles, taller than wide (10x14), never circles or dots, and never carry a glyph.

Borders are hairlines in the rule colour or the input edge colour, 1px, used for dividers, inputs and outline controls. Everything else is a plate: a flat fill with an edge light. Content inside stacks is clipped to the stack's radius.

## Components

Flat, exact, lit. Controls are quiet fills that step to Raised on hover; state is shown by the lit pane next to them, never by a coloured background on the control itself.

### Pane (signature component)
The state marker and the whole brand in one element. An inline rectangle, 0.667rem by 0.933rem (10x14), radius 1px. Off: Pane Off fill with a 1px inset Pane Edge frame. Live: Electric Blue fill, frame removed. Operator: Cantaloupe fill. Error: Signal Red fill. Small (0.533rem by 0.733rem, 8x11) sits on text lines: tool rows, message headers, the composer's gutter, composer voice state. The chat header's run state uses the default size; the brand pane beside the wordmark is 0.8rem by 1.133rem (12x17). A system line carries a dark pane, or Signal Red when the line reports a failure (a turn that ended before a reply, a send or reset error, a history load error). Transitions are background and box-shadow over 120ms; colour is never the only signal, so a pane with no adjacent text carries an accessible label (Running, Waiting on you, Failed, Idle). The browser tab icon is the same mark on a Midnight ground: Reading White at rest, blue while any agent works, cantaloupe when work waits, red on failure. A pane that belongs to an agent family carries its identity hue at 84% while off (see The Identity Rule) and switches to the state colour with its bloom when lit, so idle rows, the chat header and the transcript say whose room it is and lit work still reads at a glance.

### Buttons
- **Shape:** tight corners (3px), 1px transparent border reserved for outline and secondary variants, 120ms transition on background, border, colour and filter, 1px downward press on active.
- **Primary (Send):** Cantaloupe fill with a Midnight label, 600 weight at 0.867rem, 0 by 0.875rem padding, 2rem tall (2.75rem on touch viewports). Hover raises brightness 10%; a sent message flashes it brighter for 200ms; a send error shakes it 2px. It is the one warm control on the screen.
- **Hover / Focus:** every variant takes a 2px Cantaloupe outline offset 1px on focus-visible. Disabled drops to 50% opacity.
- **Outline:** transparent fill, Input Edge stroke, Reading White text, Raised on hover. **Ghost:** no stroke, Slate text, Raised fill and Reading White text on hover. **Destructive:** Signal Red fill with a Midnight label. **Link:** in prose, Electric Blue Text with an underline at 38% that fills on hover; in chrome, Reading White underlined in Pane Edge.
- **Toolbar button:** row-unit tall, Rule stroke, Reading White text; active state takes Raised fill and a Pane Edge stroke.

### Chips
- **Shell chip:** transparent, Slate text at 0.867rem 500, row-unit tall, 0 by 10px padding, 3px radius. Hover and active both switch to Raised fill with Reading White text. No stroke, no accent colour.
- **Segmented track:** a Panel channel on the Midnight bar with 2px padding and 4px radius holding chips 6px shorter than the row unit; the active chip is lifted onto the track with Raised fill and the edge light.
- **Badge:** 1.333rem tall, 2px radius, Rule stroke, Slate text at 0.8rem. Tones tint the stroke by mixing 45% of the state colour into Rule: live takes Electric Blue Text, primary and warning take Cantaloupe text, danger takes Signal Red.

### Cards / Containers
- **Corner Style:** 3px for plates and tool stacks, 4px for the composer, 6px for the command palette.
- **Background:** Plate inside the room; Popover for floating menus.
- **Shadow Strategy:** edge light on plates (The Edge Light Rule); float shadow on the composer and command palette; menu shadow on listboxes.
- **Border:** none on plates. Panel headers have a hairline below in Rule. Code blocks and tool result details keep a Rule hairline because they sit inside prose.
- **Internal Padding:** 12px horizontal on headers and plates, 8px 12px on message plates, 10px 12px on code blocks.
- **Operator plate:** the operator's whole turn (name, time and body) sits on Operator Plate (Panel warmed by 18% cantaloupe), 3px radius, warm edge light, no border, width fit to content and capped at the reading measure. The small pane in the gutter is Cantaloupe with its bloom; the speaker name stays in Reading White in the display face, since the plate already says who is speaking.
- **Tool stack:** consecutive tool rows share one plate with the edge light, clipped to 3px, divided by Rule hairlines.
- **Code block:** Plate with a Rule hairline and a row-unit language bar; tokens take the palette: keywords, built-ins and types in Electric Blue Text, strings in Cantaloupe text, numbers and attributes in a blue-white mix, names in Reading White at 600, comments in Slate italic, diff additions green and deletions red.

### Inputs / Fields
- **Style:** Midnight fill, 1px Input Edge stroke, 3px radius, 2.133rem tall (2.75rem on touch), 0 by 10px padding, UI size text, Slate placeholder.
- **Focus:** stroke turns Cantaloupe and a 1px Cantaloupe outline sits flush on it; no glow.
- **Error / Disabled:** aria-invalid turns the stroke Signal Red; disabled drops to 50% opacity and refuses the pointer.
- **Composer:** the operator's next window. A floating plate of Plate with the float shadow, 4px radius, a small pane in the gutter to its left and a 1px border that is transparent at rest. While the operator is in it (focus, or text already typed) the plate warms to Operator Plate with the warm edge light, the border lights Cantaloupe at 60% (solid Cantaloupe while recording) and the gutter pane switches to Cantaloupe, so the turn being written matches the turns already sent (The Window Rule). The textarea is borderless at 1rem on a 42px minimum height; a toolbar row below holds shell icon buttons on the left, shortcut hints as keycaps on the right, and Send at the end. The composer shares the transcript's gutter and spans the column with it.
- **Inline select trigger:** transparent, Input Edge stroke, 3px radius, 0.8rem text, 1.75rem tall on desktop (2.75rem on touch), Raised on hover, chevron in Slate. Its listbox is Popover with a Rule stroke, the menu shadow and 0.667rem mono options.
- **Keycap:** inline flex, 1.333rem tall, 0 by 5px padding, 2px radius, Rule stroke, Midnight fill, mono at 0.733rem in Slate. Used for composer shortcut hints and nowhere decorative. A hairline sits beneath it and a thread of light on top, so it reads as a raised cap.

### Navigation
- **Top bar:** 2.933rem (44px) tall on Midnight with a Rule hairline below; wordmark then the 12x17 fleet pane at left, then the fleet in words (mono; Slate when all is quiet, Electric Blue Text while agents work, Cantaloupe text when work waits on you, Signal Red when a run stands failed; a failed run is never counted as working, and the fleet pane and tab icon go red for it), the Chat and Tasks segmented track, usage and settings as shell icon buttons at right. On viewports under 372px the chips drop to a 40px minimum.
- **Chat header:** row-unit tall at the top of the room plate with a Rule hairline below; the open session's agent name as a nameplate in the display face, then the model and effort selects, then the run state: a default-size pane in the family hue with "Idle", or the stage word and the live clock in Electric Blue Text while the agent works. The band and its hairline take a 9% tint of the open agent's family hue (14% in Daylight), and the nameplate is set in that hue.
- **Shell icon button:** row-unit square, 3px radius, Slate icon, Raised fill and Reading White on hover and when active; icons never shrink.
- **Panel header:** row-unit tall, transparent on the frame, Rule hairline below, 0 4px 0 12px padding, 600 label at 0.867rem in sentence case.
- **List rows (sessions, tree):** row-unit tall, 0.867rem text, Raised on hover and when selected; a pane leads the row (default size in the agents column, small in the tree). Top-level session names use the display face; folders in the workspace tree carry 500 weight instead of type icons. An idle session row says nothing at its right end; text appears there only as a live token count, "waiting on you" in Cantaloupe text, or "error" in Signal Red, so the quiet rows stay quiet and the lit ones stand out. The open room's row takes a 14% tint of its family hue over Raised.
- **Login page:** the operator's first window. The sign at 2.4rem over Midnight with the brand pane lit Cantaloupe (Nerve is waiting on you), one line of Reading White copy, then a floating window for the password: Plate with the float shadow and edge light, warming to Operator Plate while the operator is in it, a status line with the window pane and "Waiting on you", the Enter keycap hint and a Sign in button in the Send style. A failed attempt is a line under the window with a Signal Red pane. No feature cards, no kickers, no logo mark; the loading state is the same sign with its pane off.
- **Settings drawer:** a floating Panel plate on the right (float shadow, edge light along its inner edge, no blur; the backdrop dims the room to 60% Midnight). The header is a nameplate row with "Settings" in the display face and a close button; Connection, Audio and Appearance are the same underline text tabs as the workspace column. Content is a list of settings rows separated by hairlines, never boxed: an icon in Muted Foreground, a 0.867rem label with a 0.8rem hint, and the control at the right. Section headings are 0.867rem 600 sentence case. Selects are the flat Raised triggers of the chat header; provider choices sit on a segmented track recessed to Midnight; warnings are operator-toned notes; confirmations are plain notes without glyphs. The switch is a pane: a Raised track with a Muted Foreground thumb, and a Cantaloupe thumb on a warm track when on. The gateway status row carries a pane with the status bar's mapping (quiet when connected, Cantaloupe while connecting, Signal Red when down). The footer is one row: Sign out as a chip at the left, the version at the right.
- **Transcript dividers:** one hairline across the column with a word on it in the mono voice (Today, Yesterday, "Mon 20 May", the year only in another year; "Older messages" at the top while more can load). Day dividers appear only when the visible transcript spans more than one day, and then the first day is labelled too. An empty room says "Nothing said here yet" in Reading White with one muted line naming the agent, and only once its history has been fetched; it never flashes while history loads.
- **Dialogs (Create task, Create cron, Add memory, confirmations):** a Popover plate with a 1px border and the float shadow, a 1.067rem 600 title with one line of copy, flat fields with 0.867rem 600 labels and 0.8rem hints, sections separated by hairlines, never nested cards. The field where the operator writes a brief, a memory or a description is an operator window (The Window Rule). Cancel then the warm primary at the right, in sentence case.
- **Tasks board:** the fleet's work laid out as rooms. The board is the lifted room plate; its header is a nameplate row ("Tasks" in the display face, the board in words beside it, then search, the priority filter, Proposals with a pane that lights Cantaloupe while any wait on you, and New task). Columns are lanes separated by hairlines with a row-unit header (sentence-case title, count in mono; Done and Cancelled read in Muted Foreground); a lane under a dragged card lifts to Raised. A task is a row on Plate with the edge light, Raised on hover: its pane leads (Electric Blue while its agent runs, Signal Red when the run broke, Cantaloupe while it waits in Review, the assignee's family hue in the glass otherwise), then the title in Reading White, one line of description, the labels as words, and who holds it (the agent's name in its hue, the operator as "You"), the priority as a word (Critical in Signal Red, High in Reading White, Low muted, Normal silent) and the run in a word. No pills, no dots, no badges. Only the card in the operator's hand casts the float shadow. The task drawer is the Panel drawer of Settings: the task's pane and status in the header, a flat form with the description as an operator window, Details, Agent run (its own pane), Result and Feedback as sections on Plate, and the workflow actions in the footer with Execute and Approve as the warm primary. The quick view in the workspace column uses the column's row idiom: a pane leads each task, the assignee closes the row.
- **Workspace column (Memory, Crons, Config):** one underline tab strip on the row unit, then flat rows on Midnight with Raised on hover; no row borders. Memory: a section row carries a chevron, a 500-weight title and its count; items read in Reading White and wrap to two lines before clipping; dated notes sit under one collapsible "Daily notes" group with the date as a mono column and the title in Reading White. Crons: the pane leads each row and follows the Light Temperature Rule (Electric Blue while a run is in flight, Signal Red while an enabled job's last run stands broken, off otherwise; a skipped run is quiet, not broken); the name takes the row and toggles the run history, Run and History come forward on hover or keyboard focus over the end of the name, the settings menu carries every action so touch reaches them, schedules read in sentences and times in relative mono with the full date on hover. Config: one flat picker on the header row names the open file or the Skills view, with Edit and Refresh beside it; the file reads in mono at 0.867rem, and editing opens an operator window (The Window Rule) with Cancel and Save in its status line.
- **Status bar:** row-unit tall, Midnight with a Rule hairline above, 0.8rem Slate text; a connection pane, then counts in words with tabular numerals, version in mono at the right. The context meter fills Electric Blue, Cantaloupe past the warning threshold and Signal Red when nearly full.
- **Wordmark:** Geist, 1.533rem, 700, -0.03em, Reading White, followed by the 12x17 fleet pane.

### Tool row
One 28px line of mono text at 0.8rem: a small pane (live while running, off when done, red when failed), the verb in Reading White capped at 45% width, the arguments in Slate, and a right-aligned tabular measure that turns Electric Blue Text while live. Expandable rows take Raised on hover and focus and end with a 14px chevron in Slate.

## Do's and Don'ts

### Do:
- **Do** show state only with a lit pane: Electric Blue for agent work, Cantaloupe for the operator and work waiting on the operator, Signal Red for failure, Pane Off when done (The Light Temperature Rule).
- **Do** keep an agent family's hue on at idle: its panes at 84%, its name, the header band and the open row; lit panes always show the state colour with its bloom (The Identity Rule).
- **Do** switch panes and hover fills in 120ms with `cubic-bezier(0.2, 0, 0, 1)` and let reduced motion make them instant (The Switch Rule).
- **Do** warm the composer to Operator Plate and light its gutter pane while the operator is in it, on focus or with text typed, so the turn being written matches the turns already sent (The Window Rule).
- **Do** treat the side-column editors as operator windows: Plate at rest, Operator Plate with a lit status-line pane while the operator types, never a focus ring (The Window Rule).
- **Do** let a cron row's pane carry the job's light: blue in flight, red while an enabled job stands broken, off otherwise; a skipped run stays quiet.
- **Do** let a new turn land with one 200ms rise and fade on the switch ease; the transcript has no other entrance.
- **Do** let light travel: stagger a state's arrival by region (fleet pane, chat header, agents column, transcript gutter, 70ms apart) and never by element; lights go out together.
- **Do** move chrome on the arrive ease (`cubic-bezier(0.16, 1, 0.3, 1)`, 180ms to 260ms) and switch views with a view transition; no bounce, no elastic curves.
- **Do** build raised surfaces as plates: Panel for the room, Plate inside it, each with the 1px edge light and no drawn border; in Daylight the token prints a hairline (The Edge Light Rule, The Frame Rule).
- **Do** keep every list row, tool row, panel header and the status bar on the 1.867rem row unit (The One Row Rule).
- **Do** reserve Geist for the wordmark and agent or speaker names (The Names Rule).
- **Do** hold agent prose to the 72em reading measure and let code, tables and charts take the column.
- **Do** set timestamps, counts, durations, models and code in Atkinson Hyperlegible Mono with tabular numerals.
- **Do** keep corners between 1px and 4px; 6px is only for the floating command palette shell.
- **Do** make Send the one warm control on a screen: Cantaloupe fill, Midnight label, 3px radius.
- **Do** give every pane without adjacent text an accessible label (Running, Waiting on you, Failed, Idle).

### Don't:
- **Don't** colour anything that is not reporting agent work, operator ownership, an error, a link, code syntax or an agent family's identity; no decorative accents or coloured side rails.
- **Don't** pulse, breathe or animate a shadow; the only glow is a lit pane's bloom (The Bloom Rule) and the only blinking element is the streaming cursor pane, which stops under reduced motion.
- **Don't** add scanlines, HUD chrome, letterspaced uppercase labels, eyebrows or kickers above headings; labels are sentence case.
- **Don't** use glass, blur or decorative gradients; depth is tonal value plus the edge light, the room's ambient light is the one gradient, the bloom is the one zero-offset shadow, and only floating surfaces cast an offset shadow.
- **Don't** draw a border around a plate; borders belong to inputs, outline buttons and hairline dividers.
- **Don't** replace a pane with a dot, a circle, a badge or a glyph icon, and never make colour the only signal.
- **Don't** use Geist for headings, labels or buttons, or a system display face anywhere.
- **Don't** round panels or shell surfaces beyond 4px, or bring back the retired look's rounded panels and amber accents.
