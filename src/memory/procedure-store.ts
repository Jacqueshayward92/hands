/**
 * Procedure Store — Learn HOW to do tasks from successful runs
 *
 * After successful agent runs with multiple tool calls, extracts the
 * ordered sequence of actions as a reusable "procedure." When similar
 * tasks come up later, auto-recall surfaces the relevant procedure.
 *
 * This is procedural memory — the "muscle memory" of an assistant.
 * A human who has done a task 5 times doesn't think about the steps.
 * The agent should similarly get faster at repeated task types.
 *
 * Stored as searchable markdown files in memory/procedures/.
 * Auto-indexed by the memory file watcher.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("procedure-store");

// =========================================================================
// Types
// =========================================================================

type ProcedureStep = {
  order: number;
  tool: string;
  /** Brief description of what this step did */
  action: string;
  /** Key params that made it work */
  keyParams?: Record<string, string>;
  /** Whether this step succeeded */
  success: boolean;
};

type Procedure = {
  /** Descriptive name derived from the request */
  name: string;
  /** The original user request */
  request: string;
  /** Ordered steps */
  steps: ProcedureStep[];
  /** Tags for searchability */
  tags: string[];
  /** Timestamp */
  timestamp: string;
  /** Whether the overall task succeeded */
  success: boolean;
};

// =========================================================================
// Extraction
// =========================================================================

/** Minimum tool calls to consider it a "procedure" worth saving */
const MIN_STEPS = 3;

/** Extract a short name from the user's request */
function deriveProcedureName(request: string): string {
  // Take the first sentence/line, cleaned up
  const first = request.split(/[.\n!?]/)[0]?.trim() ?? request;
  return first.slice(0, 100);
}

/** Extract tags from the request and tool names for searchability */
function deriveTags(request: string, toolNames: string[]): string[] {
  const tags = new Set<string>();

  // Add tool names as tags
  for (const tool of toolNames) {
    tags.add(tool.toLowerCase());
  }

  // Extract key action words from the request
  const actionWords = request.match(
    /\b(install|create|build|deploy|fix|update|delete|send|email|search|research|write|read|configure|setup|push|commit|test|debug|monitor|check|analyze|scrape|crawl|filter)\b/gi,
  );
  if (actionWords) {
    for (const word of actionWords) {
      tags.add(word.toLowerCase());
    }
  }

  // Extract key noun phrases
  const nouns = request.match(
    /\b(file|script|cron|api|database|server|website|email|git|github|pipeline|report|template|config|memory|brain)\b/gi,
  );
  if (nouns) {
    for (const noun of nouns) {
      tags.add(noun.toLowerCase());
    }
  }

  return [...tags];
}

/** Extract tool call steps from messages */
function extractSteps(messages: AgentMessage[]): ProcedureStep[] {
  const steps: ProcedureStep[] = [];
  let order = 0;

  // Track tool_use → tool_result pairs
  const pendingTools = new Map<string, { name: string; params: Record<string, unknown> }>();

  for (const msg of messages) {
    const m = msg as Record<string, unknown>;

    // Check for tool_use blocks in assistant messages
    if (m?.role === "assistant" && Array.isArray(m.content)) {
      for (const block of m.content as Array<Record<string, unknown>>) {
        if (block?.type === "tool_use" && typeof block.name === "string") {
          const toolId = typeof block.id === "string" ? block.id : `tool-${order}`;
          const input = (block.input && typeof block.input === "object" ? block.input : {}) as Record<string, unknown>;
          pendingTools.set(toolId, { name: block.name, params: input });
        }
      }
    }

    // Check for toolResult messages
    if (m?.role === "toolResult" || m?.role === "tool") {
      const toolId = typeof m.toolCallId === "string" ? m.toolCallId :
        typeof m.tool_use_id === "string" ? m.tool_use_id : null;
      const isError = Boolean(m.isError || m.is_error);

      let toolName = typeof m.toolName === "string" ? m.toolName : "unknown";
      let keyParams: Record<string, string> = {};

      if (toolId && pendingTools.has(toolId)) {
        const pending = pendingTools.get(toolId)!;
        toolName = pending.name;
        // Extract key params (just names and short values)
        for (const [key, val] of Object.entries(pending.params)) {
          if (typeof val === "string" && val.length < 200) {
            keyParams[key] = val;
          } else if (typeof val === "number" || typeof val === "boolean") {
            keyParams[key] = String(val);
          }
        }
        pendingTools.delete(toolId);
      }

      // Build action description from params
      let action = toolName;
      if (keyParams.command) action = `${toolName}: ${keyParams.command.slice(0, 100)}`;
      else if (keyParams.file_path || keyParams.path) action = `${toolName}: ${(keyParams.file_path || keyParams.path)!.slice(0, 100)}`;
      else if (keyParams.query) action = `${toolName}: "${keyParams.query.slice(0, 80)}"`;
      else if (keyParams.url) action = `${toolName}: ${keyParams.url.slice(0, 100)}`;

      order++;
      steps.push({
        order,
        tool: toolName,
        action,
        keyParams: Object.keys(keyParams).length > 0 ? keyParams : undefined,
        success: !isError,
      });
    }
  }

  return steps;
}

/** Extract the user's request from messages */
function extractRequest(messages: AgentMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown>;
    if (m?.role === "user") {
      const content = m.content;
      if (typeof content === "string") return content.slice(0, 500);
      if (Array.isArray(content)) {
        return content
          .filter((c): c is { type: "text"; text: string } =>
            c?.type === "text" && typeof c.text === "string")
          .map(c => c.text)
          .join(" ")
          .slice(0, 500);
      }
    }
  }
  return "(unknown request)";
}

// =========================================================================
// Formatting
// =========================================================================

function formatProcedure(proc: Procedure): string {
  const lines: string[] = [];
  lines.push(`# Procedure: ${proc.name}`);
  lines.push("");
  lines.push(`**Status:** ${proc.success ? "✅ Successful" : "❌ Failed"}`);
  lines.push(`**Date:** ${proc.timestamp.slice(0, 10)}`);
  lines.push(`**Tags:** ${proc.tags.join(", ")}`);
  lines.push("");
  lines.push("## Request");
  lines.push(proc.request);
  lines.push("");
  lines.push("## Steps");
  lines.push("");

  for (const step of proc.steps) {
    const status = step.success ? "✅" : "❌";
    lines.push(`${step.order}. ${status} **${step.action}**`);
  }

  lines.push("");
  return lines.join("\n");
}

// =========================================================================
// Persistence
// =========================================================================

/**
 * Extract and persist a procedure from a completed, successful run.
 * Only saves procedures with 3+ tool calls (non-trivial multi-step work).
 * Called fire-and-forget after agent_end.
 */
export async function logProcedure(params: {
  messages: AgentMessage[];
  success: boolean;
  workspaceDir: string;
}): Promise<{ logged: boolean }> {
  try {
    // Only log successful runs
    if (!params.success) return { logged: false };

    const steps = extractSteps(params.messages);
    if (steps.length < MIN_STEPS) return { logged: false };

    const request = extractRequest(params.messages);
    const toolNames = [...new Set(steps.map(s => s.tool))];

    const proc: Procedure = {
      name: deriveProcedureName(request),
      request,
      steps,
      tags: deriveTags(request, toolNames),
      timestamp: new Date().toISOString(),
      success: true,
    };

    const markdown = formatProcedure(proc);

    // Write to memory/procedures/ — daily file, appended
    const procDir = path.join(params.workspaceDir, "memory", "procedures");
    await fs.mkdir(procDir, { recursive: true });

    const dateStr = new Date().toISOString().slice(0, 10);
    const filePath = path.join(procDir, `${dateStr}.md`);

    const separator = "\n\n---\n\n";
    try {
      await fs.access(filePath);
      await fs.appendFile(filePath, separator + markdown, "utf-8");
    } catch {
      const header = `# Procedures — ${dateStr}\n\nLearned task procedures. Each entry records the step-by-step approach that worked.\n`;
      await fs.writeFile(filePath, header + separator + markdown, "utf-8");
    }

    log.info(`procedure logged: "${proc.name}" — ${steps.length} steps, tags: [${proc.tags.join(", ")}]`);
    return { logged: true };
  } catch (err) {
    log.warn(`procedure logging failed: ${err instanceof Error ? err.message : String(err)}`);
    return { logged: false };
  }
}
