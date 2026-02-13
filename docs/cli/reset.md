---
summary: "CLI reference for `hands reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
title: "reset"
---

# `hands reset`

Reset local config/state (keeps the CLI installed).

```bash
hands reset
hands reset --dry-run
hands reset --scope config+creds+sessions --yes --non-interactive
```
