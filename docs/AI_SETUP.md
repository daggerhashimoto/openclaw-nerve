# AI agent setup

Nerve can be installed, configured, and validated by an AI agent that can read files and run shell commands on a macOS or Linux machine.

The agent follows [`INSTALL.md`](./INSTALL.md), the install contract. This page is the human-readable summary: the prompt to paste, what the agent will and will not do on its own, and where to go for other setups.

- Contract: [`INSTALL.md`](./INSTALL.md)
- Raw URL: `https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md`

## Copy-paste prompt

```text
Install, configure, and validate Nerve on this machine.

Fetch and follow instructions from:
https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md
```

## What to expect

Unless you say otherwise, the agent works local-first:

1. Looks for an existing OpenClaw gateway and prefers it.
2. Runs `install.sh`, which installs Nerve in `~/nerve` and starts it as a service.
3. Runs the setup wizard, keeping Nerve on localhost only.
4. Checks that Nerve responds and is connected to the gateway.

Nerve is not standalone. It needs an OpenClaw gateway. If the agent finds none, it explains the dependency and asks before installing OpenClaw.

## What the agent does without asking

On the default local path it may:
- inspect the machine, an existing `~/nerve`, and the local OpenClaw install
- install missing core prerequisites (Node.js 22 or later, npm, git, build tools)
- run the installer and the setup wizard, and write a minimal local `.env` if the wizard cannot run
- apply the small local OpenClaw changes setup makes: device pairing and scopes, and the `cron`, `gateway`, and `sessions_spawn` tool allow entries, followed by a local gateway restart
- restart local services and run its checks

## What needs your approval

The agent asks before anything that changes exposure, trust, or ownership of the install:
- installing OpenClaw
- exposing Nerve beyond localhost (LAN, Tailscale, or the public internet), or setting up a reverse proxy
- reinstalling, replacing, or deleting an existing install
- changing the config of a remote gateway (setup never edits one: it prints the steps for you)
- cloud-hosted setups that change the security posture

Short version: local repair and local setup can be automated. Public or destructive changes need your consent.

## How you know it worked

The agent reports success only when Nerve is installed, running, connected to the intended gateway, and answering its health check. A script finishing is not enough. If a step fails, it reports which step failed, what it checked and changed, and what still needs you.

## Choose your setup

Pick the guide that matches your topology. Local is the recommended default.

- **Local, same machine:** [DEPLOYMENT-A.md](./DEPLOYMENT-A.md)
- **Hybrid, local Nerve with a remote gateway:** [DEPLOYMENT-B.md](./DEPLOYMENT-B.md)
- **Cloud, remote Nerve:** [DEPLOYMENT-C.md](./DEPLOYMENT-C.md)
- **Add Tailscale to an existing install:** [TAILSCALE.md](./TAILSCALE.md)

To see exactly what the installer does, read [INSTALLER-STEPS.md](./INSTALLER-STEPS.md). To update a running install later, see [UPDATING.md](./UPDATING.md).

## Example prompts

### Default local install

```text
Install, configure, and validate Nerve on this machine.
Use the safest local-first path and keep it localhost-only unless you need my approval.

Fetch and follow instructions from:
https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md
```

### Local Nerve with an existing remote gateway

```text
Install Nerve on this machine and connect it to my existing remote OpenClaw gateway.
Do not expose Nerve beyond localhost unless I approve it.
If remote gateway config needs changing, tell me before you do it.

Fetch and follow instructions from:
https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md
```

### Tailscale setup

```text
Install Nerve and make it reachable over Tailscale.
Ask before making any exposure or gateway allowlist changes.
Use the repo's Tailscale guidance instead of inventing a new flow.

Fetch and follow instructions from:
https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md
```

### Existing install repair

```text
Inspect my existing Nerve install, repair it if needed, and validate it.
Do not reinstall or delete anything unless you ask first.

Fetch and follow instructions from:
https://raw.githubusercontent.com/daggerhashimoto/openclaw-nerve/master/docs/INSTALL.md
```
