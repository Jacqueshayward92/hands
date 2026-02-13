/**
 * Scratch Pad — Persistent working memory for active tasks
 *
 * Problem: During multi-step tasks, tool results fill the context window.
 * When compaction fires, intermediate results are destroyed. The agent
 * loses data it already retrieved and may re-do work or lose accuracy.
 *
 * Fix: Automatically capture key tool outputs to a per-session scratch file.
 * After compaction, the scratch pad is injected back into context so the
 * agent can resume with its intermediate results intact.
 *
 * The scratch pad is:
 * - Per-session (isolated between runs)
 * - Auto-trimmed (keeps last N entries to avoid bloat)
 * - Injected AFTER compaction (not before — avoids double context)
 * - Cleared when the session ends normally
 *
 * Only captures "meaningful" tool outputs — not every Read/exec result,
 * but search results, web fetches, API responses, and similar data-producing tools.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("scratch-pad");

// =========================================================================
// Configuration
// =========================================================================

/** Tools whose output is worth capturing to scratch */
const CAPTURE_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "memory_search",
  "memory_get",
  "sessions_list",
  "sessions_history",
  "session_status",
  "nodes",
  "exec",
]);

/** Maximum entries in the scratch pad */
const MAX_ENTRIES = 20;

/** Maximum chars per entry */
const MAX_ENTRY_CHARS = 2000;

/** Maximum total chars for injection */
const MAX_INJECTION_CHARS = 15000;

// =========================================================================
// Types
// =========================================================================

type ScratchEntry = {
  tool: string;
  /** Brief description (from meta or params) */
  context: string;
  /** Trimmed result text */
  output: string;
  timestamp: number;
};

type ScratchPad = {
  version: 1;
  sessionKey: string;
  entries: ScratchEntry[];
  compactionCount: number;
};

// =========================================================================
// File I/O
// =========================================================================

/** Resolve scratch file path. Uses workspace memory dir for auto-indexing. */
function resolveScratchFile(sessionKey: string, workspaceDir?: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  if (workspaceDir) {
    // Write to workspace memory dir — auto-indexed by file watcher
    return path.join(workspaceDir, "memory", "scratch", `${safe}.md`);
  }
  return path.join(resolveStateDir(), "scratch", `${safe}.json`);
}

async function readPad(sessionKey: string, workspaceDir?: string): Promise<ScratchPad> {
  // Try JSON state file first
  try {
    const statePath = resolveScratchFile(sessionKey);
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1) return parsed as ScratchPad;
  } catch { /* fresh pad */ }
  return { version: 1, sessionKey, entries: [], compactionCount: 0 };
}

async function writePad(sessionKey: string, pad: ScratchPad, workspaceDir?: string): Promise<void> {
  // Write JSON state (for reading back)
  const statePath = resolveScratchFile(sessionKey);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(pad), "utf-8");

  // Also write markdown to workspace memory dir for auto-indexing
  if (workspaceDir && pad.entries.length > 0) {
    const mdDir = path.join(workspaceDir, "memory", "scratch");
    await fs.mkdir(mdDir, { recursive: true });
    const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    const mdPath = path.join(mdDir, `${safe}.md`);

    const lines = [
      `# Working Memory — Active Session`,
      ``,
      `Tool outputs captured during this session. Auto-indexed for recall.`,
      ``,
    ];
    for (const entry of pad.entries) {
      lines.push(`## ${entry.tool}: ${entry.context}`);
      lines.push("```");
      lines.push(entry.output.slice(0, MAX_ENTRY_CHARS));
      lines.push("```");
      lines.push("");
    }
    await fs.writeFile(mdPath, lines.join("\n"), "utf-8");
  }
}

// =========================================================================
// Capture
// =========================================================================

/**
 * Capture a tool result to the scratch pad.
 * Called from the tool execution end handler (fire-and-forget).
 * Only captures tools in CAPTURE_TOOLS set.
 */
export async function captureToScratch(params: {
  sessionKey: string;
  toolName: string;
  meta?: string;
  resultText: string;
  isError: boolean;
  workspaceDir?: string;
}): Promise<void> {
  if (!CAPTURE_TOOLS.has(params.toolName)) return;
  if (params.isError) return; // Don't capture errors (tool failure store handles those)
  if (!params.resultText || params.resultText.length < 20) return;

  try {
    const pad = await readPad(params.sessionKey, params.workspaceDir);

    const entry: ScratchEntry = {
      tool: params.toolName,
      context: params.meta ?? params.toolName,
      output: params.resultText.slice(0, MAX_ENTRY_CHARS),
      timestamp: Date.now(),
    };

    pad.entries.push(entry);

    // Trim to max entries (keep most recent)
    if (pad.entries.length > MAX_ENTRIES) {
      pad.entries = pad.entries.slice(-MAX_ENTRIES);
    }

    await writePad(params.sessionKey, pad, params.workspaceDir);
  } catch (err) {
    log.warn(`scratch capture failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// =========================================================================
// Injection (after compaction)
// =========================================================================

/**
 * Build injection text from the scratch pad.
 * Returns null if pad is empty or no compaction has occurred.
 *
 * Only injects AFTER at least one compaction — before that, the tool
 * results are still in the conversation context.
 */
export async function readScratchForInjection(
  sessionKey: string,
  compactionCount: number,
): Promise<string | null> {
  if (compactionCount === 0) return null; // No compaction yet — results still in context

  try {
    const pad = await readPad(sessionKey);
    if (pad.entries.length === 0) return null;

    // Only inject entries that were captured before the latest compaction
    const lines: string[] = [
      "## 📋 Working Memory (preserved across compaction)",
      "These are tool outputs from earlier in this session that survived compaction.",
      "",
    ];

    let totalChars = 0;
    // Show most recent entries first
    const reversed = [...pad.entries].reverse();
    for (const entry of reversed) {
      if (totalChars >= MAX_INJECTION_CHARS) break;
      lines.push(`### ${entry.tool}: ${entry.context}`);
      lines.push("```");
      const remaining = MAX_INJECTION_CHARS - totalChars;
      lines.push(entry.output.slice(0, remaining));
      lines.push("```");
      lines.push("");
      totalChars += entry.output.length + entry.context.length + 20;
    }

    return lines.join("\n");
  } catch (err) {
    log.warn(`scratch read failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Clear the scratch pad for a session (call at session end).
 */
export async function clearScratch(sessionKey: string): Promise<void> {
  try {
    await fs.unlink(resolveScratchFile(sessionKey));
  } catch { /* file doesn't exist — fine */ }
}
