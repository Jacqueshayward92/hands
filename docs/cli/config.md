---
summary: "CLI reference for `hands config` (get/set/unset config values)"
read_when:
  - You want to read or edit config non-interactively
title: "config"
---

# `hands config`

Config helpers: get/set/unset values by path. Run without a subcommand to open
the configure wizard (same as `hands configure`).

## Examples

```bash
hands config get browser.executablePath
hands config set browser.executablePath "/usr/bin/google-chrome"
hands config set agents.defaults.heartbeat.every "2h"
hands config set agents.list[0].tools.exec.node "node-id-or-name"
hands config unset tools.web.search.apiKey
```

## Paths

Paths use dot or bracket notation:

```bash
hands config get agents.defaults.workspace
hands config get agents.list[0].id
```

Use the agent list index to target a specific agent:

```bash
hands config get agents.list
hands config set agents.list[1].tools.exec.node "node-id-or-name"
```

## Values

Values are parsed as JSON5 when possible; otherwise they are treated as strings.
Use `--json` to require JSON5 parsing.

```bash
hands config set agents.defaults.heartbeat.every "0m"
hands config set gateway.port 19001 --json
hands config set channels.whatsapp.groups '["*"]' --json
```

Restart the gateway after edits.
