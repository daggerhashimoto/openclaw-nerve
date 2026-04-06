---
goal: Make Kanban launches resolve a safe effective thinking level across primary and macOS fallback execution paths
version: 1.0
date_created: 2026-03-31
last_updated: 2026-03-31
owner: Jen
status: 'Completed'
tags: [feature, bug, kanban, execution, thinking, regression]
---

# Introduction

![Status: Completed](https://img.shields.io/badge/status-Completed-brightgreen)

This plan fixes Kanban execution failures caused by missing or unusable thinking-level resolution during task launch. The implementation preserves explicit task and board settings, avoids silent regressions, and applies the same launch-resolution rules to both the primary execution path and the macOS fallback path.

## 1. Requirements & Constraints

- **REQ-001**: Kanban task execution must resolve launch-time `thinking` using the same deterministic rules on both the primary `sessions_spawn` path and the macOS fallback `sessions.create` + `sessions.send` path.
- **REQ-002**: Launch-time resolution order must be: execute-time override → saved task settings → board defaults → safe automation fallback.
- **REQ-003**: If the effective thinking value is missing or `off`, launch-time thinking must be coerced to `low`.
- **REQ-004**: Explicit non-off task or board defaults must be preserved unchanged.
- **REQ-005**: Synthetic launch-time fallback thinking must not mutate persisted task state unless explicitly supplied by the caller.
- **REQ-006**: Existing model resolution behavior must remain intact unless the change is required for consistent shared launch-option handling.
- **CON-001**: No Kanban UI work is in scope for this patch.
- **CON-002**: No retry loop is allowed; the fix must prevent bad launches before they happen.
- **CON-003**: The implementation must minimize blast radius and avoid altering unrelated Kanban behavior.
- **PAT-001**: Follow strict TDD: add failing regression tests first, verify red, then implement minimal code, then verify green.
- **GUD-001**: Prefer a shared launch-resolution helper over duplicated ad hoc logic in route branches.

## 2. Implementation Steps

### Implementation Phase 1

- **GOAL-001**: Lock expected behavior with failing regression tests before production changes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add a failing route test proving the macOS fallback path launches with `thinking: low` when request/task/config thinking are absent. | ✅ | 2026-03-31 |
| TASK-002 | Add a failing route test proving the primary path launches with `thinking: low` when request/task/config thinking are absent. | ✅ | 2026-03-31 |
| TASK-003 | Add passing-preservation tests proving explicit non-off thinking values still win over the fallback. | ✅ | 2026-03-31 |

### Implementation Phase 2

- **GOAL-002**: Implement shared launch-time option resolution with minimal code changes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Implement a shared helper for resolving effective launch model/thinking in `server/routes/kanban.ts` or a dedicated Kanban helper module. | ✅ | 2026-03-31 |
| TASK-005 | Wire the helper into both the primary and fallback execution branches without changing persisted task state for synthetic defaults. | ✅ | 2026-03-31 |
| TASK-006 | Keep existing explicit task/config model handling unchanged unless required for shared helper consistency. | ✅ | 2026-03-31 |

### Implementation Phase 3

- **GOAL-003**: Verify the patch is regression-safe and ready for review.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Run focused Kanban route tests and confirm the new regression tests pass. | ✅ | 2026-03-31 |
| TASK-008 | Run broader Kanban/fallback-related tests and a server build to catch integration regressions. | ✅ | 2026-03-31 |
| TASK-009 | Summarize the fix, verification evidence, and any follow-up UI work that remains out of scope. | ✅ | 2026-03-31 |

## 3. Alternatives

- **ALT-001**: Patch only the macOS fallback path. Rejected because the underlying missing-thinking behavior exists conceptually in both launch paths.
- **ALT-002**: Add a retry on reasoning-required errors. Rejected because it treats the symptom after a bad launch instead of resolving launch options correctly up front.
- **ALT-003**: Block the fix on new Kanban UI controls for task/board thinking. Rejected because the server bug can be fixed immediately without expanding scope.

## 4. Dependencies

- **DEP-001**: Existing Kanban route test harness in `server/routes/kanban.test.ts`.
- **DEP-002**: Existing fallback launcher tests in `server/lib/kanban-subagent-fallback.test.ts` if helper extraction affects fallback integration.
- **DEP-003**: Existing Kanban store/config behavior in `server/lib/kanban-store.ts`.

## 5. Files

- **FILE-001**: `server/routes/kanban.ts` — shared launch-option resolution and execution wiring.
- **FILE-002**: `server/routes/kanban.test.ts` — route-level regression tests for both execution paths.
- **FILE-003**: `plan/feature-kanban-launch-thinking-resolution-1.md` — implementation plan and execution record.

## 6. Testing

- **TEST-001**: Verify fallback path sends `thinking: low` when no usable thinking is configured.
- **TEST-002**: Verify primary path sends `thinking: low` when no usable thinking is configured.
- **TEST-003**: Verify configured board thinking still wins over the fallback.
- **TEST-004**: Run focused Kanban route tests.
- **TEST-005**: Run fallback helper tests.
- **TEST-006**: Run `npm run build:server` and `npm run build`.

## 7. Risks & Assumptions

- **RISK-001**: Coercing `off` to `low` changes behavior for tasks that explicitly requested zero reasoning; accepted because strict providers otherwise reject the launch and current UI offers no Kanban thinking control.
- **RISK-002**: Future launch paths could drift if they bypass the shared resolver.
- **ASSUMPTION-001**: `low` is a safe cross-provider automation default within current Kanban semantics.
- **ASSUMPTION-002**: Persisted task state should reflect user intent, not synthetic launch-only defaults.

## 8. Related Specifications / Further Reading

- `server/routes/kanban.ts`
- `server/routes/kanban.test.ts`
- `server/lib/kanban-store.ts`
- Issue #207: https://github.com/daggerhashimoto/openclaw-nerve/issues/207
