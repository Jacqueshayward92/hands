/**
 * Episode Logger — Automatic work history for every agent run
 *
 * After each agent run, extracts a structured episode summary:
 * - What was requested (user's message)
 * - What tools were used
 * - What was the outcome (files created, commands run, decisions made)
 * - Whether it succeeded or failed
 *
 * Episodes are persisted to memory/episodes/ as markdown files,
 * auto-indexed by the memory search system, and surfaced by auto-recall
 * when relevant context is needed.
 *
 * This gives the agent a "work history" — it remembers WHAT IT DID,
 * not just what was discussed. A human assistant naturally has this.
 * Without it, every session starts without knowing past actions.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("episode-logger");

// =========================================================================
// Types
// =========================================================================

export type Episode = {
  timestamp: string;
  sessionKey?: string;
  agentId?: string;
  /** The user's original request */
  request: string;
  /** Tools that were called during this run */
  toolsUsed: string[];
  /** Files that were read or written */
  filesAccessed: string[];
  /** Key actions/outcomes extracted from assistant messages */
  outcomes: string[];
  /** Whether the run was successful */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs?: number;
};

// =========================================================================
// Extraction
// =========================================================================

/** Extract the user's original request from messages */
function extractRequest(messages: AgentMessage[]): string {
  // Find the last user message (the one that triggered this run)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as Record<string, unknown>;
    if (msg?.role === "user") {
      const content = msg.content;
      if (typeof content === "string") return content.slice(0, 500);
      if (Array.isArray(content)) {
        const text = content
          .filter((c): c is { type: "text"; text: string } =>
            c?.type === "text" && typeof c.text === "string"
          )
          .map((c) => c.text)
          .join(" ");
        return text.slice(0, 500);
      }
    }
  }
  return "(no request found)";
}

/** Extract tool names from messages */
function extractToolsUsed(messages: AgentMessage[]): string[] {
  const tools = new Set<string>();
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    // toolUse messages have a name field
    if (m?.role === "toolUse" && typeof m.name === "string") {
      tools.add(m.name);
    }
    // Also check for tool_use in content arrays (Anthropic format)
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type === "tool_use" && typeof block.name === "string") {
          tools.add(block.name);
        }
      }
    }
  }
  return [...tools];
}

/** Extract file paths from tool calls (read, write, edit, exec) */
function extractFilesAccessed(messages: AgentMessage[]): string[] {
  const files = new Set<string>();
  const filePatterns = [
    /(?:file_path|path|file)\s*[:=]\s*["']?([^\s"',\]}{]+)/gi,
    /(?:Read|Write|Edit)\s+(?:file\s+)?["']?([^\s"',\]}{]+\.[\w]+)/gi,
  ];

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    // Check toolUse params
    if (m?.role === "toolUse") {
      const params = m.params ?? m.input;
      if (params && typeof params === "object") {
        const p = params as Record<string, unknown>;
        for (const key of ["file_path", "path", "filePath"]) {
          if (typeof p[key] === "string") {
            files.add(p[key] as string);
          }
        }
      }
    }
    // Check assistant content for tool_use blocks
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type === "tool_use" && block.input && typeof block.input === "object") {
          const input = block.input as Record<string, unknown>;
          for (const key of ["file_path", "path", "filePath"]) {
            if (typeof input[key] === "string") {
              files.add(input[key] as string);
            }
          }
        }
      }
    }
    // Fallback: scan text content for file paths
    const text = typeof m?.content === "string" ? m.content : "";
    if (text) {
      for (const pattern of filePatterns) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
          if (match[1] && match[1].length > 3 && match[1].length < 200) {
            files.add(match[1]);
          }
        }
      }
    }
  }
  return [...files].slice(0, 20); // Cap at 20 files
}

/** Extract key outcomes from the last assistant message */
function extractOutcomes(messages: AgentMessage[]): string[] {
  const outcomes: string[] = [];

  // Get the last assistant message(s)
  const assistantMsgs: string[] = [];
  for (let i = messages.length - 1; i >= 0 && assistantMsgs.length < 3; i--) {
    const m = messages[i] as Record<string, unknown>;
    if (m?.role === "assistant") {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) assistantMsgs.push(text);
    }
  }

  const combined = assistantMsgs.join("\n");

  // Extract action statements
  const outcomePatterns = [
    /(?:I(?:'ve| have)?|successfully|done|completed|created|updated|fixed|built|installed|configured|deployed|pushed|committed|sent|wrote|saved)\s+(.{10,200})/gi,
    /(?:✅|✓|done:?|ready:?|complete:?)\s+(.{5,200})/gi,
    /(?:error|failed|couldn'?t|unable to|blocked by)\s+(.{10,200})/gi,
  ];

  const seen = new Set<string>();
  for (const pattern of outcomePatterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(combined)) !== null) {
      const outcome = (match[1] ?? match[0]).trim().slice(0, 200);
      const key = outcome.toLowerCase().slice(0, 60);
      if (!seen.has(key) && outcome.length > 8) {
        seen.add(key);
        outcomes.push(outcome);
      }
      if (outcomes.length >= 10) break;
    }
    if (outcomes.length >= 10) break;
  }

  return outcomes;
}

// =========================================================================
// Formatting
// =========================================================================

function formatEpisode(episode: Episode): string {
  const lines: string[] = [];
  const date = episode.timestamp.split("T")[0];
  const time = episode.timestamp.split("T")[1]?.slice(0, 5) ?? "";

  lines.push(`# Episode — ${date} ${time}`);
  lines.push("");
  if (episode.sessionKey) lines.push(`Session: ${episode.sessionKey}`);
  lines.push(`Status: ${episode.success ? "✅ Success" : "❌ Failed"}`);
  if (episode.durationMs) lines.push(`Duration: ${Math.round(episode.durationMs / 1000)}s`);
  lines.push("");

  lines.push("## Request");
  lines.push(episode.request);
  lines.push("");

  if (episode.toolsUsed.length > 0) {
    lines.push("## Tools Used");
    for (const tool of episode.toolsUsed) {
      lines.push(`- ${tool}`);
    }
    lines.push("");
  }

  if (episode.filesAccessed.length > 0) {
    lines.push("## Files Accessed");
    for (const file of episode.filesAccessed) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  if (episode.outcomes.length > 0) {
    lines.push("## Outcomes");
    for (const outcome of episode.outcomes) {
      lines.push(`- ${outcome}`);
    }
    lines.push("");
  }

  if (episode.error) {
    lines.push("## Error");
    lines.push(episode.error);
    lines.push("");
  }

  return lines.join("\n");
}

// =========================================================================
// Persistence
// =========================================================================

/** Minimum number of tools used to be worth logging as an episode */
const MIN_TOOLS_FOR_EPISODE = 1;

/**
 * Extract and persist an episode from a completed agent run.
 * Called fire-and-forget after agent_end — must never block.
 *
 * Only logs episodes where real work was done (at least 1 tool call).
 * Pure chat (no tools) is not logged — it's not "work."
 */
export async function logEpisode(params: {
  messages: AgentMessage[];
  success: boolean;
  error?: string;
  durationMs?: number;
  workspaceDir: string;
  sessionKey?: string;
  agentId?: string;
}): Promise<{ logged: boolean; filePath?: string }> {
  try {
    const toolsUsed = extractToolsUsed(params.messages);

    // Only log episodes where real work happened
    if (toolsUsed.length < MIN_TOOLS_FOR_EPISODE) {
      return { logged: false };
    }

    const now = new Date();
    const episode: Episode = {
      timestamp: now.toISOString(),
      sessionKey: params.sessionKey,
      agentId: params.agentId,
      request: extractRequest(params.messages),
      toolsUsed,
      filesAccessed: extractFilesAccessed(params.messages),
      outcomes: extractOutcomes(params.messages),
      success: params.success,
      error: params.error,
      durationMs: params.durationMs,
    };

    const markdown = formatEpisode(episode);

    // Write to memory/episodes/ — one file per day, append
    const episodesDir = path.join(params.workspaceDir, "memory", "episodes");
    await fs.mkdir(episodesDir, { recursive: true });

    const dateStr = now.toISOString().slice(0, 10);
    const filePath = path.join(episodesDir, `${dateStr}.md`);

    // Append to daily file (creates if doesn't exist)
    const separator = "\n\n---\n\n";
    try {
      await fs.access(filePath);
      await fs.appendFile(filePath, separator + markdown, "utf-8");
    } catch {
      // File doesn't exist yet — create with header
      const header = `# Episodes — ${dateStr}\n\nAutomatic work log. Each entry records what was requested, what tools were used, and what the outcome was.\n`;
      await fs.writeFile(filePath, header + separator + markdown, "utf-8");
    }

    log.info(
      `episode logged: ${toolsUsed.length} tools, ${episode.outcomes.length} outcomes → ${dateStr}.md`,
    );
    return { logged: true, filePath };
  } catch (err) {
    // Best-effort — never block anything
    log.warn(`episode logging failed: ${err instanceof Error ? err.message : String(err)}`);
    return { logged: false };
  }
}
