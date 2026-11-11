---
id: js-ts-dependency-upgrades
purpose: Keep JavaScript and TypeScript dependencies current with low-noise grouped upgrade pull requests.
routines:
  - Scan the configured manifests and lockfile for available JavaScript and TypeScript dependency updates.
  - Identify safe patch and minor dependency upgrades, grouped by runtime and development dependency type.
  - Create or update focused dependency upgrade pull requests with verification evidence and clear rollback notes.
deny:
  - Do not proceed while any configuration placeholder remains unresolved.
  - Do not auto-merge dependency pull requests.
  - Do not perform major-version upgrades unless the repository policy explicitly allows them.
  - Do not change dependency range style, package manager, registry configuration, or workspace layout.
  - Do not make broad refactors or unrelated code changes while fixing upgrade fallout.
  - Do not run package-manager commands outside the configured outdated scan, update, install, and verification commands.
schedule: '0 8 * * 1'
---

# JavaScript/TypeScript Dependency Update Maintainer

## Configuration

Use these repository-specific values:

- Package manager: `npm`
- Dependency manifests: `package.json`
- Lockfile: `package-lock.json`
- Outdated scan: `npm outdated`
- Runtime dependency update: `npm update --save-prod --omit=dev`
- Development dependency update: `npm update --save-dev --include=dev --omit=prod`
- Install or lockfile refresh: `npm install`
- Verification:
  - `npm run lint`
  - `npm run build`
  - `npm run build:server`
  - `npm test -- --run`
- Runtime dependency branch: `chore/deps-runtime-minor-patch`
- Development dependency branch: `chore/deps-dev-minor-patch`
- Runtime dependency title: `chore(deps): update runtime dependencies (patch/minor)`
- Development dependency title: `chore(deps-dev): update development dependencies (patch/minor)`
- PR labels: `none` by default

## Update policy

Default scope:

- patch and minor updates only
- runtime dependencies and development dependencies in separate pull requests
- no package manager migration
- no registry or workspace layout changes

Major upgrades are out of scope unless the repository has an explicit policy for major upgrade pull requests.

Run the configured outdated scan before choosing updates. Use the configured runtime dependency update command for runtime dependencies and the configured development dependency update command for development dependencies.

## PR policy

Create or update at most two pull requests per run:

1. runtime dependency patch/minor updates
2. development dependency patch/minor updates

Use the configured branch and title for each dependency bucket.

Do not add labels by default. This repository typically keeps pull requests unlabeled unless a human explicitly requests labels.

Each PR body must include:

- configured package manager
- packages updated
- dependency type bucket
- install command run
- verification commands run
- failures, skipped packages, and follow-ups

## Verification and freshness

Before modifying files, re-read the current default branch and existing daemon upgrade branches or pull requests to avoid duplicate work.

After applying updates:

1. run the configured install or lockfile refresh command
2. run the configured verification commands
3. inspect the diff to confirm it only contains dependency update changes and minimal lockfile changes

If verification fails and the fix is not a small dependency-related adjustment, leave the pull request as draft or stop with a concise handoff note. Do not broaden into feature or refactor work.

## Limits

- Max open pull requests created or updated per run: 2
- Max packages per grouped pull request: 20
- No changes outside dependency manifests, lockfiles, and minimal generated dependency metadata unless the pull request is explicitly marked draft with rationale

## No-op when

- no patch or minor upgrades are available
- any configuration placeholder remains unresolved
- verification cannot be run safely
- an existing human-owned dependency upgrade is already active for the same dependency bucket
