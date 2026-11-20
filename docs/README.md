# Nerve docs

Start here for setup, operations and contributor guidance.

## Top-level entry points

- [Project README](../README.md): product overview and quick start
- [Contributing](../CONTRIBUTING.md): local development, tests and pull requests
- [Design system](../DESIGN.md): UI source of truth (colour, type, panes, layout, motion)
- [Changelog](../CHANGELOG.md): release notes

## Setup and deployment

- [AI agent setup](./AI_SETUP.md): let an AI agent install and configure Nerve
- [Agent install contract](./INSTALL.md): the step-by-step contract an installing agent follows
- [Installer steps](./INSTALLER-STEPS.md): what `install.sh` does, in order
- [Deployment A](./DEPLOYMENT-A.md): Nerve and the gateway on one machine
- [Deployment B](./DEPLOYMENT-B.md): cloud gateway, Nerve on your laptop
- [Deployment C](./DEPLOYMENT-C.md): Nerve and the gateway in the cloud
- [Tailscale](./TAILSCALE.md): add private remote access to an existing install
- [Updating](./UPDATING.md): the built-in updater and rollback

## Reference

- [Configuration](./CONFIGURATION.md): `.env` variables, auth, access modes, TTS and STT providers
- [API](./API.md): backend endpoints and their behaviour
- [Agent markers](./AGENT-MARKERS.md): TTS, chart and kanban markers in agent replies
- [Security](./SECURITY.md): threat model and hardening
- [Troubleshooting](./TROUBLESHOOTING.md): common failures and fixes

## Contributors

- [Architecture](./ARCHITECTURE.md): code structure, data flow, Kanban subsystem, build and tests
- [Code review](./CODE_REVIEW.md): how to review changes against the codebase as it is
