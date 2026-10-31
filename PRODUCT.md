# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-hosting operators: technical individuals who run their own OpenClaw gateway and a fleet of agents. They work mostly at a desk in long sessions, keeping Nerve open while agents run, and check in from a phone (often over a tailnet) to monitor, answer, or steer. They value density, control, and visibility over hand-holding; they already understand agents, sessions, and models and do not need the concepts explained.

## Product Purpose

Nerve is the browser cockpit for OpenClaw. Chat is fine for talking to an agent but too small for operating several of them: once an operator cares about visibility, control, and coordination, they need the workspace, sessions, task board, editor, usage, and agent context in one place. Nerve is that place. Success means an operator can see what every agent is doing, act on it, and verify the result without dropping to a terminal or digging through chat history.

## Positioning

Nerve sits directly in front of the OpenClaw gateway and proxies it, so it operates the real fleet rather than a copy: per-agent workspaces, memory, identity, soul, and skills are inspected and edited live; cron runs appear as their own sessions; work is delegated onto a kanban board and reviewed when it comes back; voice is built in, not bolted on. A generic chat UI or LLM front end cannot claim this, because it has no gateway-level view of agents, sessions, schedules, and workspaces.

## Operating Context

- Self-hosted. Nerve binds to 127.0.0.1 by default; operators choose localhost, LAN, Tailscale tailnet IP, or Tailscale Serve. Password auth protects network-exposed installs.
- Topologies: local (Nerve and gateway on one machine, the recommended default), hybrid (Nerve local, gateway in the cloud), cloud (both remote).
- Installed with a one-line installer that hands off to a setup wizard; updated with `npm run update`, which rebuilds, health-checks, and rolls back on failure.
- Sessions run for hours. Crons and subagents keep working while the operator is away, so returning to Nerve means catching up on what happened.
- Desk is the primary seat; the phone is a real second seat for monitoring and quick actions, not an afterthought.

## Capabilities and Constraints

Capabilities (shipped, preserve through the overhaul):

- Agent fleet: multiple agents from one control plane, each with its own workspace, subagents, memory, identity, soul, and skills.
- Interaction: streaming chat, markdown, syntax highlighting, diff views, image paste, file previews, voice input (push-to-talk, wake word, local Whisper, multilingual stop and cancel phrases), multiple TTS providers, live transcription preview.
- Workspace: per-agent file browser, tabbed editor, memory editing, config editing, skills browser.
- Operations: session tree, subagents, cron scheduling, kanban task board, review flow, proposal inbox, model overrides.
- Observability: token usage, cost tracking, context meter, agent logs, event logs.
- Rich agent output via agent markers: real charts, TTS, kanban markers, structured tool rendering.
- Command palette with jump to agents and sessions by name.
- Font family choice and a 10px to 24px font size control; mobile-safe input sizing; hot-reloadable settings; updater with rollback.

Decided for the overhaul (2026-10-31):

- Theming: Nerve ships one branded identity in a dark and a light version, and every install defaults to it.
- Legacy look: the previous appearance stays selectable as an opt-in Classic style (its 14 community themes, Instrument Sans, rounded panels, amber accents), applied as a skin over the same layout and components.

Technical constraints:

- Frontend: React 19, Tailwind CSS 4, shadcn/ui on Radix, Vite 7, lucide-react icons. CodeMirror 6 for editing, highlight.js for code, recharts and lightweight-charts for charts. All of these must follow the new identity in both dark and light.
- Backend: Hono 4 on Node.js 22+; WebSocket proxy to the gateway, SSE for file watchers and real-time sync, REST for files, memories, TTS, and models.
- Open source under MIT; contributors work from the public repo, so the design system has to be legible in code.

Terminology: agent, fleet, gateway, session, subagent, cron, workspace, memory, identity, soul, skills, kanban / task board, proposal inbox, model override, context meter.

## Brand Commitments

- Name: Nerve. This is the only binding brand asset.
- The logo mark, the tagline ("The cockpit OpenClaw deserves."), and the cockpit framing in copy are all open to redesign.
- Palette pinned by the user for the overhaul: midnight black, electric blue, cantaloupe orange.

## Evidence on Hand

- README with feature descriptions and capability table.
- Product demo video (linked from the README) and `docs/demo.gif`.
- Three mobile screenshots (linked from the README).
- Discord community and a public contributors graph on GitHub.
- CHANGELOG with release history (current release 1.5.4).

Absent, do not fabricate: testimonials, user counts, star counts beyond the live badge, benchmarks, press, or named customers.

## Product Principles

1. Operate, not just chat. Every surface should help the operator see state, take action, and confirm the result; conversation is one tool among several.
2. No black boxes. What each agent is doing, what it costs, how close it is to its context limit, and what ran while the operator was away should always be findable.
3. Built for long sessions. Operators keep Nerve open for hours, so density is welcome as long as it stays scannable and nothing demands attention without reason.
4. Desk first, phone ready. Full power at the desk; the phone must handle monitoring and quick actions properly.
5. Local and trustworthy by default. Self-hosting is the point: exposure, auth, and destructive actions are always explicit.

## Accessibility & Inclusion

No formal standard has been set. Existing commitments to keep: user-adjustable font size (10px to 24px) and font family, mobile-safe input sizing, voice as an alternative input, and full keyboard reach through the command palette.
