# OpenClaw issue label taxonomy

This taxonomy is adapted from the current `daggerhashimoto/openclaw-nerve` label set and is the source of truth for `linear-issue-labeler` decisions.

## Required label families

### Type (required, exactly one)

- `bug`
- `enhancement`
- `feature`
- `documentation`
- `question`

### Area (optional but strongly recommended when clear)

- `area:backend`
- `area:ci`
- `area:frontend`
- `area:installer`
- `area:security`
- `area:setup`
- `area:ux`
- `area:voice`

## Auto-add policy

The daemon may auto-add only Type and Area labels, and only when exactly one label in the family is clearly supported by the issue title/body.

## Proposal-only labels

These labels require human triage context and must not be auto-added:

- `duplicate`
- `invalid`
- `wontfix`
- `good first issue`
- `help wanted`

## Deprecated labels

None currently.

## Removal policy

Automatic removal is not allowed. If labels conflict with this taxonomy, post a repair proposal comment instead of mutating labels.
