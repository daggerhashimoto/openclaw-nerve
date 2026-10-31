---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/index.css","src/lib/themes.ts","src/features/chat/ChatPanel.tsx","src/features/sessions/SessionList.tsx"]
---

# App shell and chat view

Scope: the persistent app shell (top bar, workspace tree, session header, transcript, composer, agents column with Memory/Crons/Tasks/Config, status bar) and the chat view inside it. Mode: Operate.

Job: an operator keeps Nerve open for hours, glances to see which agents are working and which need them, reads long answers, and steers. Must read instantly: agent activity, long answers, run state.

Constraints confirmed with the user (2026-10-31): keep the three-column layout; the old look stays available as an opt-in Classic skin (CSS layer over the same components), new design is the default; must not lose density against today's shell; no hacker costume (scanlines, glowing HUD chrome, tracked uppercase labels). Retire the 14 community themes for one identity in dark and light.

Memorable moment: the agents column reads like a tower block at night; you know which rooms are awake.

Unresolved: light version specifics beyond its rule below; logo mark (open per PRODUCT.md, out of scope for this pass); "waiting on you" maps to unread sessions until the gateway exposes a true awaiting-input state.

## Direction contract

THESIS: Light temperature tells you who is acting. Cold electric blue is agent work in progress; warm cantaloupe is the operator and anything waiting on the operator; finished work goes dark. Refuses the grey dashboard with a decorative accent and the incumbent's glowing amber HUD.

OWN-WORLD: Midnight ground #080B12, panels #0D1119, raised #141A26, rules #1B2232, reading white #ECE6DA, secondary #8C94A6. Blue #3D7EFF only for live agent work; cantaloupe #FFA567 only for the operator and unread work; red only for errors. Flat 10x14 lit panes are the only state marker (no coloured side rails), never glow, gradient or glass; 2 to 4px radii. Atkinson Hyperlegible Next and Mono, sentence case, one 28px row unit across all columns. Light version is daylight: cool paper ground, panes printed as ink swatches, same meanings.

STORY: The operator glances at the agents column, sees which panes are lit, opens the warm one, reads the answer on a calm measure that spans the column, and replies; Send is the one warm control.

FIRST VIEWPORT: 44px top bar: wordmark, Chat/Tasks, usage, settings (no jump field: the product keeps the command palette trigger in the composer, a setting-controlled decision covered by tests). 248px workspace tree, file the agent is touching marked by a blue pane. Centre: 28px session header with model and effort selects and a lit run-state readout; transcript with operator messages led by a cantaloupe pane, prose across the column (72em cap), tool rows lit blue while running and dark when done; composer at the foot, cantaloupe Send. 340px right: agent rows each led by a pane, then Memory/Crons/Tasks/Config. 28px status bar with a strip of session panes. Signature interaction: panes switch on and off in step with gateway state, a 120ms light switch, never a pulse; motion grammar is switch, not breathe, and reduced motion makes it instant.

FORM: Night light, position 4 of 7 on the ordered list; seed:e92968e12d7df247.

AMENDMENT (2026-10-31, after the user called the first build "super vanilla"): same world, turned up. Ground deepened to #06080E with panels #0B0F17 and raised #151C2A; rules dropped to #171E2C so plates read by value and a 1px edge light (--plate-shadow) rather than by drawn borders; the composer floats on a real offset shadow (--float-shadow) and its border lights cantaloupe only while the operator is in it. Display face: Bricolage Grotesque (display optical size, 94% width) for the wordmark and every agent and speaker name; Atkinson stays the reading and UI face. Wordmark at 1.267rem/700/-0.03em followed by one fleet pane (blue while any agent works, cantaloupe when work waits). The agents column is the rows themselves, each led by its pane (a facade of windows above the rows was built and then removed at the user's request as a duplicate of the list); the status bar keeps only the counts in words. The browser tab icon is the same mark and follows the fleet (white pane at rest, blue while agents work, cantaloupe when work waits, red on failure). Transcript panes moved into a 24px gutter so every message, tool stack and plate shares one left text edge, forming a spine of lights down the column. Operator turns (name, time and body together) sit on one warm plate (card + 10% cantaloupe, warm edge light, faint warm frame) spanning the column; agent turns stay bare prose. The transcript and composer take the whole column (prose capped at 72em). Tool stacks are one plate with hairline dividers. Composer hints are keycaps. Workspace tree drops type icons; folders carry weight instead. Chat/Tasks is a segmented track. Classic skin hides the skyline and keeps its borders.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
