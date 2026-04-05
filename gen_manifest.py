#!/usr/bin/env python3
import yaml
import sys

content = """# Nerve Manifest
# OpenClaw Web UI / Cockpit Interface
# Generated: 2026-04-04
# This file serves dual purposes:
#  1. Human-readable project documentation (this YAML)
#  2. Machine-parseable Debian packaging metadata (debian: section)

# ─────────────────────────────────────────────────────────────
# Debian Package Metadata
# Extract with: python3 scripts/manifest-to-debian.py nerve_manifest.yaml
# ─────────────────────────────────────────────────────────────
debian:
  source: nerve
  section: utils
  priority: optional
  maintainer: "Gregory Blaire 