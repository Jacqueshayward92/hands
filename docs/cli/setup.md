---
summary: "CLI reference for `hands setup` (initialize config + workspace)"
read_when:
  - You’re doing first-run setup without the full onboarding wizard
  - You want to set the default workspace path
title: "setup"
---

# `hands setup`

Initialize `~/.hands/hands.json` and the agent workspace.

Related:

- Getting started: [Getting started](/start/getting-started)
- Wizard: [Onboarding](/start/onboarding)

## Examples

```bash
hands setup
hands setup --workspace ~/.hands/workspace
```

To run the wizard via setup:

```bash
hands setup --wizard
```
