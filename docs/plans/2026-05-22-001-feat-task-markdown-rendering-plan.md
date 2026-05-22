---
title: "feat: Markdown rendering for Task description and result fields"
status: active
created: 2026-05-22
issue: 329
depth: lightweight
type: feat
---

# feat: Markdown rendering for Task description and result fields

**Origin:** [#329](https://github.com/daggerhashimoto/openclaw-nerve/issues/329)

## Problem Frame

Task description and result fields in the kanban drawer are stored as markdown but rendered as plain text in a `<textarea>` (description) and a `whitespace-pre-wrap <div>` (result). Users producing or receiving structured content - especially markdown tables - have to mentally render the markup, which defeats the point of writing structured plans.

Per issue #329:

- Description field is editable and might be hand-authored or agent-authored. Markdown rendering must therefore be optional and the textarea remains the default.
- Result field is not editable and should always render markdown as HTML.

## Scope

In scope:

- Replace the plain-text result block with markdown rendering, unconditionally.
- Add a per-drawer toggle on the description field that flips between the existing textarea (default, editing on) and a markdown-rendered read-only preview (editing off).
- Toggle is visual only - it does not auto-save. In-flight edits in the textarea persist across toggles via the existing `editDescription` state and land on disk via the existing Save button.

Out of scope:

- Persisting the toggle preference across drawer opens or across tasks.
- Inline editing of the result field.
- New markdown extensions beyond what `MarkdownRenderer` already supports (GFM via `remark-gfm`, etc.).
- Re-theming the markdown renderer for kanban specifically.

## Key Technical Decisions

- **Reuse `src/features/markdown/MarkdownRenderer.tsx`.** It already wraps `react-markdown` with GFM (tables, the OP's stated motivation), code highlighting, and the project's link/image conventions. No new markdown dep, no parallel renderer.
- **Lazy-load via the same `lazy(() => import(...))` pattern used in `src/features/chat/MessageBubble.tsx`.** Keeps the kanban drawer bundle small; markdown rendering only loads when the drawer opens.
- **Toggle state is local-only.** A `useState<boolean>(true)` inside `TaskDetailDrawer` is sufficient. Does not need to live in task state, context, or persisted prefs - issue explicitly says "default to on" and gives no cross-session requirement.
- **Toggle UI: `Pencil` icon from `lucide-react` rendered inline next to the "Description" label, with `aria-pressed` reflecting state.** Avoids inventing a new icon set and gets keyboard/screen-reader semantics for free. Visual "depressed vs raised" lives in className state (`bg-accent` when active vs default when not).
- **Editing-off view is read-only but keeps the existing layout space.** Render the `MarkdownRenderer` inside a div sized similarly to the textarea (`min-h-[180px]`), so toggling does not collapse the drawer height and re-flow the form.

## Implementation Units

### U1. Always-render markdown for `task.result`

**Goal:** Replace the plain-text result block with `MarkdownRenderer`, since the result field is non-editable and always benefits from rich rendering.

**Requirements:** Issue #329 "Result field: Always render the result field as HTML".

**Dependencies:** None.

**Files:**

- Modify: `src/features/kanban/TaskDetailDrawer.tsx`
- Modify: `src/features/kanban/TaskDetailDrawer.test.tsx`

**Approach:**

- Add a lazy import for `MarkdownRenderer` at the top of `TaskDetailDrawer.tsx`, mirroring the pattern at `src/features/chat/MessageBubble.tsx:11`.
- Replace the existing render block around line 428-435 (the `{task.result && (<div className="whitespace-pre-wrap ...">{task.result}</div>)}` cluster) with a `<MarkdownRenderer content={task.result} />` wrapped in a `<Suspense fallback={...}>` boundary, keeping the surrounding "Result" label and outer `cockpit-note` container intact.
- Keep the existing fallback for empty/whitespace results (only render the block when `task.result` is truthy).

**Patterns to follow:**

- Lazy-load and Suspense fallback shape from `src/features/chat/MessageBubble.tsx`.
- MarkdownRenderer mock pattern from `src/features/chat/MessageBubble.test.tsx:4-9`.

**Test scenarios:**

- Given a task with `result: '## Heading\n\n| col | col |\n|--|--|\n| a | b |'`, the result block renders the markdown via `MarkdownRenderer` (assert the mock receives that exact content prop).
- Given a task with `result: ''` (empty string), the result block does not render.
- Given a task with `result: null`, the result block does not render.

**Verification:**

- `npx vitest run src/features/kanban/TaskDetailDrawer.test.tsx` passes.
- `npm run build` succeeds (lazy import resolves; no stray imports left in the bundle entry).

### U2. Description edit toggle with markdown preview when off

**Goal:** Add the "✎" pencil toggle next to the Description label so users can flip the field into a read-only markdown preview without losing in-flight edits.

**Requirements:** Issue #329 "Description field" subsection (edit toggle, default on, depressed vs raised style, behavior switch when off).

**Dependencies:** U1 (uses the same lazy `MarkdownRenderer` import added there; if U1 is reverted, this unit needs to add the import itself).

**Files:**

- Modify: `src/features/kanban/TaskDetailDrawer.tsx`
- Modify: `src/features/kanban/TaskDetailDrawer.test.tsx`

**Approach:**

- Add a `descriptionEditing` boolean state inside `TaskDetailDrawer`, initialized to `true`. Reset it back to `true` whenever a new task is loaded (alongside the existing `setEditDescription` reset in the task-changed effect).
- In the description label row (around line 301-303), wrap the existing label text and a new toggle button in a `flex items-center justify-between` container.
- Toggle button: `<button type="button" aria-label="Toggle description preview" aria-pressed={descriptionEditing} onClick={() => setDescriptionEditing(v => !v)} className="..."><Pencil size={12} /></button>`. The active/inactive classes drive the depressed-vs-raised visual: active uses `bg-accent text-accent-foreground` (depressed), inactive uses `text-muted-foreground hover:text-foreground` (raised).
- When `descriptionEditing` is true, render the existing `<textarea>` block unchanged.
- When `descriptionEditing` is false, render `<Suspense fallback={...}><MarkdownRenderer content={editDescription} /></Suspense>` inside a div with matching `min-h-[180px]` so the form height does not jump.
- Toggling does not call `setEditDescription` or `markDirty` - the field state is independent of the toggle, and the existing dirty/save plumbing remains the source of truth.

**Patterns to follow:**

- Existing `lucide-react` icon usage in `TaskDetailDrawer.tsx` (already importing icons, just add `Pencil`).
- `aria-pressed` pattern for toggle buttons is standard ARIA; no project-specific pattern exists, follow WAI-ARIA Authoring Practices for toggle buttons.

**Test scenarios:**

- Given a task with `description: '## Hello\n\n- bullet'`, the drawer opens with the textarea visible (default state on), the pencil button is `aria-pressed="true"`, and the textarea contains the raw markdown.
- Clicking the pencil button hides the textarea and renders the markdown content through `MarkdownRenderer` (assert the mock receives `editDescription`).
- Pressing the button a second time restores the textarea with the original in-flight edit value intact (typing a change, toggling off, toggling on, asserting the textarea still has the change).
- After a save round-trip, opening the drawer for a different task resets the toggle to "on" (`aria-pressed="true"`) so each drawer session starts in editing mode.
- The toggle button is keyboard accessible: focus + Enter triggers the toggle (assert via `userEvent.keyboard('{Enter}')`).

**Verification:**

- `npx vitest run src/features/kanban/TaskDetailDrawer.test.tsx` passes.
- `npm run build` succeeds.
- Manual smoke: open a task with a markdown table in description, toggle off, confirm the table renders; toggle back on, confirm the textarea still holds the original text.

## System-Wide Impact

- Bundle size: small. `MarkdownRenderer` is already lazy-loaded by `MessageBubble`; adding a second lazy import site does not duplicate the module.
- A11y: new toggle button adds `aria-pressed`, `aria-label`, keyboard activation - net positive.
- No backend changes, no schema changes, no migration. Pure UI.
- No impact on tasks list, board view, or task creation dialog - the markdown rendering lives inside the detail drawer only.

## Risks and Mitigations

- **R1: Toggling off mid-edit feels lossy if users expect the toggle to save.** Mitigation: comment the rationale next to the toggle handler ("Toggle is preview-only; in-flight edits persist across toggles, save via the Save button"). The test for "edits survive toggle round-trip" pins this behavior.
- **R2: Markdown renderer's default styling does not match the cockpit-note aesthetic.** Mitigation: the drawer wrapping divs already supply font sizing (`text-xs`/`text-sm`) and the `cockpit-note` background; `MarkdownRenderer` inherits from those. If specific styling looks off after live verification, that becomes a Phase 2 polish on the renderer, out of scope here.
- **R3: Tables in `task.result` overflow the drawer width on narrow viewports.** `MarkdownRenderer` already handles this in chat; the same overflow rules apply automatically. If kanban-specific drawer width is tighter than chat, surfaces a follow-up issue.

## Deferred to Follow-Up Work

- Persisting the description-preview toggle across drawer opens (would require a user preference - explicitly not in #329 scope).
- A "preview while editing" split view (issue specifies on/off toggle, not a split).
- Markdown rendering in `CreateTaskDialog.tsx` description field (issue is about the detail drawer; create dialog is a separate UX flow).

## Outside this product's identity

- Inline markdown editing in the result field. Issue #329 explicitly keeps the result non-editable.
