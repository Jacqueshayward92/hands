# Hands Fork — Isolation Guide

This is a development fork. It MUST run completely isolated from the production OpenClaw instance.

## Quick Start (Isolated)

```powershell
# Set isolation environment BEFORE running anything
$env:OPENCLAW_STATE_DIR = "C:\Users\jacqu\.openclaw-hands"
$env:OPENCLAW_PROFILE = "hands"
$env:OPENCLAW_PORT = "19789"  # Different from production 18789

# Install dependencies
cd C:\Users\jacqu\.openclaw\workspace\hands
npm install

# Build
npm run build

# Run tests
npm test

# Run gateway (isolated)
node dist/gateway.js
```

## What's Isolated

| Resource | Production | Hands Fork |
|----------|-----------|------------|
| State dir | `~/.openclaw` | `~/.openclaw-hands` |
| Workspace | `~/.openclaw/workspace` | `~/.openclaw/workspace-hands` |
| Port | 18789 | 19789 |
| Config | `~/.openclaw/openclaw.json` | `~/.openclaw-hands/openclaw.json` |
| Sessions | `~/.openclaw/sessions/` | `~/.openclaw-hands/sessions/` |
| Task ledger | `~/.openclaw/task-ledger/` | `~/.openclaw-hands/task-ledger/` |
| Tool failures | `~/.openclaw/tool-failures/` | `~/.openclaw-hands/tool-failures/` |
| Scratch pads | `~/.openclaw/scratch/` | `~/.openclaw-hands/scratch/` |
| Execution plans | `~/.openclaw/execution-plans/` | `~/.openclaw-hands/execution-plans/` |

## NEVER

- Run without setting `OPENCLAW_STATE_DIR` first
- Use port 18789 (production)
- Write to `~/.openclaw/` directly
- Run `openclaw gateway start` (that's the production service)
