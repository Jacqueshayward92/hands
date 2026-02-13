---
summary: "CLI reference for `hands agents` (list/add/delete/set identity)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
title: "agents"
---

# `hands agents`

Manage isolated agents (workspaces + auth + routing).

Related:

- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
hands agents list
hands agents add work --workspace ~/.hands/workspace-work
hands agents set-identity --workspace ~/.hands/workspace --from-identity
hands agents set-identity --agent main --avatar avatars/hands.png
hands agents delete work
```

## Identity files

Each agent workspace can include an `IDENTITY.md` at the workspace root:

- Example path: `~/.hands/workspace/IDENTITY.md`
- `set-identity --from-identity` reads from the workspace root (or an explicit `--identity-file`)

Avatar paths resolve relative to the workspace root.

## Set identity

`set-identity` writes fields into `agents.list[].identity`:

- `name`
- `theme`
- `emoji`
- `avatar` (workspace-relative path, http(s) URL, or data URI)

Load from `IDENTITY.md`:

```bash
hands agents set-identity --workspace ~/.hands/workspace --from-identity
```

Override fields explicitly:

```bash
hands agents set-identity --agent main --name "Hands" --emoji "🦞" --avatar avatars/hands.png
```

Config sample:

```json5
{
  agents: {
    list: [
      {
        id: "main",
        identity: {
          name: "Hands",
          theme: "space lobster",
          emoji: "🦞",
          avatar: "avatars/hands.png",
        },
      },
    ],
  },
}
```
