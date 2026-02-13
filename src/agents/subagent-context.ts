/**
 * Sub-Agent Context Injection — Parallel awareness for the main agent
 *
 * Reads the subagent registry and builds a context summary of:
 * - Currently running sub-agents (task, duration, label)
 * - Recently completed sub-agents (task, outcome, duration)
 *
 * Injected as SUBAGENT_STATUS context file so the main agent
 * always knows what's running in parallel.
 */

import type { SubagentRunRecord } from "./subagent-registry.js";

/**
 * Build a human-readable status summary from subagent run records.
 * Returns null if nothing worth showing.
 */
export function buildSubagentStatusContext(
  runs: SubagentRunRecord[],
): string | null {
  if (!runs || runs.length === 0) return null;

  const now = Date.now();
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  // Split into running and completed
  const running: SubagentRunRecord[] = [];
  const recentlyCompleted: SubagentRunRecord[] = [];

  for (const run of runs) {
    if (!run.endedAt) {
      running.push(run);
    } else if (now - run.endedAt < ONE_DAY) {
      // Show completed runs from the last 24 hours
      recentlyCompleted.push(run);
    }
  }

  if (running.length === 0 && recentlyCompleted.length === 0) return null;

  const lines: string[] = [];
  lines.push("## 🔄 Sub-Agent Status");
  lines.push("");

  if (running.length > 0) {
    lines.push("### Running Now");
    for (const run of running) {
      const duration = run.startedAt ? formatDuration(now - run.startedAt) : "just started";
      const label = run.label ? ` (${run.label})` : "";
      lines.push(`- **${truncate(run.task, 120)}**${label} — running for ${duration}`);
    }
    lines.push("");
  }

  if (recentlyCompleted.length > 0) {
    // Sort by most recent first, show last 5
    const sorted = recentlyCompleted
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, 5);

    lines.push("### Recently Completed");
    for (const run of sorted) {
      const status = run.outcome?.status === "ok" ? "✅" :
        run.outcome?.status === "error" ? "❌" :
          run.outcome?.status === "timeout" ? "⏰ timeout" : "❓";
      const ago = run.endedAt ? formatDuration(now - run.endedAt) + " ago" : "";
      const duration = run.startedAt && run.endedAt
        ? ` (took ${formatDuration(run.endedAt - run.startedAt)})`
        : "";
      const label = run.label ? ` [${run.label}]` : "";
      lines.push(`- ${status} ${truncate(run.task, 100)}${label}${duration} — ${ago}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return remainMinutes > 0 ? `${hours}h ${remainMinutes}m` : `${hours}h`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}
