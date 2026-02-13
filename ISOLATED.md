# Hands Fork — Isolation Guide

This is a development fork. It MUST run completely isolated from the production Hands instance.

## Quick Start (Isolated)

```powershell
# Set isolation environment BEFORE running anything
$env:HANDS_STATE_DIR = "C:\Users\jacqu\.hands-hands"
$env:HANDS_PROFILE = "hands"
$env:HANDS_PORT = "19789"  # Different from production 18789

# Install dependencies
cd C:\Users\jacqu\.hands\workspace\hands
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
| State dir | `~/.hands` | `~/.hands-hands` |
| Workspace | `~/.hands/workspace` | `~/.hands/workspace-hands` |
| Port | 18789 | 19789 |
| Config | `~/.hands/hands.json` | `~/.hands-hands/hands.json` |
| Sessions | `~/.hands/sessions/` | `~/.hands-hands/sessions/` |
| Task ledger | `~/.hands/task-ledger/` | `~/.hands-hands/task-ledger/` |
| Tool failures | `~/.hands/tool-failures/` | `~/.hands-hands/tool-failures/` |
| Scratch pads | `~/.hands/scratch/` | `~/.hands-hands/scratch/` |
| Execution plans | `~/.hands/execution-plans/` | `~/.hands-hands/execution-plans/` |

## NEVER

- Run without setting `HANDS_STATE_DIR` first
- Use port 18789 (production)
- Write to `~/.hands/` directly
- Run `hands gateway start` (that's the production service)
