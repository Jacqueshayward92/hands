/**
 * Resource State — Give the LLM metacognition about its own execution
 *
 * Injects a compact status line into context so the agent knows:
 * - How many messages are in context
 * - How many compactions have occurred
 * - How many tools were called this session
 * - How long the session has been running
 * - Approximate context usage (message count as proxy)
 *
 * This enables the agent to budget its context, batch work before
 * hitting limits, and warn the user when running low.
 *
 * Injected as RESOURCE_STATE context file, rebuilt each run.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

// =========================================================================
// Types
// =========================================================================

export type ResourceSnapshot = {
  messageCount: number;
  compactionCount: number;
  toolCallCount: number;
  sessionStartedAt: number;
  /** Estimated context usage as a fraction (0-1) based on message count */
  contextPressure: "low" | "medium" | "high" | "critical";
};

// =========================================================================
// Estimation
// =========================================================================

/**
 * Estimate context pressure from message count.
 * These are rough heuristics — actual token count varies by message size.
 *
 * The agent doesn't need exact numbers. It needs to know:
 * "Am I running out of room?" — that's it.
 */
function estimateContextPressure(messageCount: number, compactionCount: number): ResourceSnapshot["contextPressure"] {
  // After compaction, pressure resets but we're more cautious
  const effectiveCount = messageCount + compactionCount * 10;

  if (effectiveCount < 30) return "low";
  if (effectiveCount < 60) return "medium";
  if (effectiveCount < 90) return "high";
  return "critical";
}

/** Count tool-use messages */
function countToolCalls(messages: AgentMessage[]): number {
  let count = 0;
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type === "tool_use") count++;
      }
    }
  }
  return count;
}

// =========================================================================
// Build
// =========================================================================

/**
 * Build a compact resource state string for context injection.
 * Designed to be small (~200 chars) and immediately useful.
 */
export function buildResourceState(params: {
  messages: AgentMessage[];
  compactionCount: number;
  sessionStartedAt: number;
}): string {
  const messageCount = params.messages.length;
  const toolCallCount = countToolCalls(params.messages);
  const pressure = estimateContextPressure(messageCount, params.compactionCount);
  const elapsedMs = Date.now() - params.sessionStartedAt;
  const elapsedMin = Math.floor(elapsedMs / 60000);

  const pressureIcon = {
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    critical: "🔴",
  }[pressure];

  const parts = [
    `${pressureIcon} Context: ${pressure}`,
    `${messageCount} msgs`,
    `${toolCallCount} tool calls`,
  ];

  if (params.compactionCount > 0) {
    parts.push(`${params.compactionCount} compaction${params.compactionCount > 1 ? "s" : ""}`);
  }

  parts.push(`${elapsedMin}m elapsed`);

  const line = parts.join(" | ");

  // Add guidance for high/critical pressure
  if (pressure === "critical") {
    return `## ⚠️ Resource State\n${line}\n\n**Context is nearly full.** Finish current task quickly, avoid large tool outputs, consider summarizing your work and suggesting the user start a new session.`;
  }
  if (pressure === "high") {
    return `## Resource State\n${line}\n\nContext is filling up. Be concise with tool calls. Batch remaining work.`;
  }

  return `## Resource State\n${line}`;
}
