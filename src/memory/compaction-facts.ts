/**
 * Compaction Fact Extraction
 *
 * Before compaction destroys conversation messages, this module extracts
 * structured facts (decisions, tasks, corrections, key information) and
 * persists them to the memory directory where they get auto-indexed by
 * the memory search system.
 *
 * This is the #1 fix for the "compaction destroys knowledge" problem.
 * LLM summaries are lossy — they drop specific facts, numbers, names,
 * decisions. This module preserves them permanently.
 *
 * Design: Pure heuristic extraction (no LLM calls) for speed and reliability.
 * Runs synchronously with compaction — must be fast.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("compaction-facts");

// =========================================================================
// Types
// =========================================================================

export type ExtractedFact = {
  category: "decision" | "task" | "fact" | "correction" | "preference" | "url" | "error_pattern";
  content: string;
  /** Which message role originated this fact */
  source: "user" | "assistant" | "tool";
  /** Approximate position in the conversation (0-1) */
  position: number;
};

export type ExtractionResult = {
  facts: ExtractedFact[];
  messageCount: number;
  extractedAt: string;
  sessionKey?: string;
};

// =========================================================================
// Extraction patterns
// =========================================================================

/** Patterns that indicate a decision was made */
const DECISION_PATTERNS = [
  /(?:let'?s|we(?:'ll| will| should)|I(?:'ll| will)|going to|decided to|decision:?)\s+(.{10,200})/gi,
  /(?:the plan is|approach:?|strategy:?)\s+(.{10,200})/gi,
  /(?:agreed|confirmed|approved|settled on)\s+(.{10,200})/gi,
];

/** Patterns that indicate a task was created, completed, or assigned */
const TASK_PATTERNS = [
  /(?:TODO|TASK|ACTION):?\s+(.{10,200})/gi,
  /(?:need to|must|should|have to|going to)\s+(.{10,200})/gi,
  /(?:done|completed|finished|shipped|deployed|fixed|resolved):?\s+(.{10,200})/gi,
  /(?:created|set up|configured|installed|built|implemented)\s+(.{10,200})/gi,
];

/** Patterns that indicate a factual statement worth preserving */
const FACT_PATTERNS = [
  /(?:the (?:password|key|token|secret|api.?key|credential) (?:is|for))\s+(.{5,200})/gi,
  /(?:IP|address|port|host|endpoint|URL|path):?\s*(\S{5,200})/gi,
  /(?:version|v)\s*(\d+\.\d+(?:\.\d+)?(?:[-+].+)?)/gi,
  /(?:account|email|username|login):?\s*(\S{5,200})/gi,
  /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?)/g, // IP addresses
];

/** Patterns that indicate user corrections */
const CORRECTION_PATTERNS = [
  /(?:no,? (?:that'?s|it'?s)|actually|wrong|incorrect|not right|don'?t)\s+(.{10,200})/gi,
  /(?:I (?:meant|mean)|what I (?:said|want)|correct(?:ion)?:?)\s+(.{10,200})/gi,
  /(?:stop|never|always|remember to|don'?t forget)\s+(.{10,200})/gi,
];

/** Patterns that indicate user preferences */
const PREFERENCE_PATTERNS = [
  /(?:I (?:prefer|like|want|need)|(?:please|always) (?:use|do|keep))\s+(.{10,200})/gi,
  /(?:from now on|going forward|in (?:the )?future)\s+(.{10,200})/gi,
];

/** URL pattern */
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`\[\]]{10,500}/g;

/** Error/failure patterns worth remembering */
const ERROR_PATTERNS = [
  /(?:error|failed|failure|exception|crashed|broke|broken):?\s+(.{10,300})/gi,
  /(?:429|rate.?limit|quota|exceeded|timeout|timed? out)\s*(.{0,200})/gi,
  /(?:fixed by|solution was|workaround:?|resolved by)\s+(.{10,200})/gi,
];

// =========================================================================
// Content extraction from AgentMessage
// =========================================================================

function getMessageText(msg: AgentMessage): string {
  if (!msg || typeof msg !== "object") return "";
  const m = msg as Record<string, unknown>;

  // String content
  if (typeof m.content === "string") return m.content;

  // Array content (multimodal)
  if (Array.isArray(m.content)) {
    return m.content
      .filter((c): c is { type: "text"; text: string } =>
        c != null && typeof c === "object" && c.type === "text" && typeof c.text === "string"
      )
      .map((c) => c.text)
      .join("\n");
  }

  // Tool result
  if (typeof m.text === "string") return m.text;
  if (typeof m.output === "string") return m.output;

  return "";
}

function getMessageRole(msg: AgentMessage): "user" | "assistant" | "tool" {
  const m = msg as Record<string, unknown>;
  if (m.role === "user") return "user";
  if (m.role === "assistant") return "assistant";
  return "tool"; // toolResult, toolUse, etc.
}

// =========================================================================
// Core extraction
// =========================================================================

function extractWithPatterns(
  text: string,
  patterns: RegExp[],
  category: ExtractedFact["category"],
  source: ExtractedFact["source"],
  position: number,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const content = (match[1] ?? match[0]).trim();
      // Skip very short or very long matches
      if (content.length < 8 || content.length > 500) continue;
      // Deduplicate
      const key = content.toLowerCase().slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);

      facts.push({ category, content, source, position });
    }
  }

  return facts;
}

function extractUrls(
  text: string,
  source: ExtractedFact["source"],
  position: number,
): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    const url = match[0];
    // Skip common noise URLs
    if (url.includes("github.com/openclaw/openclaw/issues/")) continue;
    if (url.includes("docs.openclaw.ai")) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    facts.push({ category: "url", content: url, source, position });
  }

  return facts;
}

/**
 * Extract structured facts from conversation messages.
 * Uses heuristic pattern matching — no LLM calls.
 */
export function extractFacts(messages: AgentMessage[]): ExtractedFact[] {
  const allFacts: ExtractedFact[] = [];
  const totalMessages = messages.length || 1;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const text = getMessageText(msg);
    if (!text || text.length < 15) continue;

    const source = getMessageRole(msg);
    const position = i / totalMessages;

    // Only extract decisions/corrections/preferences from user and assistant
    if (source === "user" || source === "assistant") {
      allFacts.push(...extractWithPatterns(text, DECISION_PATTERNS, "decision", source, position));
      allFacts.push(...extractWithPatterns(text, CORRECTION_PATTERNS, "correction", source, position));
      allFacts.push(...extractWithPatterns(text, PREFERENCE_PATTERNS, "preference", source, position));
    }

    // Tasks from any source
    allFacts.push(...extractWithPatterns(text, TASK_PATTERNS, "task", source, position));

    // Facts and URLs from any source
    allFacts.push(...extractWithPatterns(text, FACT_PATTERNS, "fact", source, position));
    allFacts.push(...extractUrls(text, source, position));

    // Error patterns from tool results and assistant messages
    if (source === "tool" || source === "assistant") {
      allFacts.push(...extractWithPatterns(text, ERROR_PATTERNS, "error_pattern", source, position));
    }
  }

  // Deduplicate across all messages (same content, same category)
  const deduped = new Map<string, ExtractedFact>();
  for (const fact of allFacts) {
    const key = `${fact.category}:${fact.content.toLowerCase().slice(0, 100)}`;
    if (!deduped.has(key)) {
      deduped.set(key, fact);
    }
  }

  return [...deduped.values()];
}

// =========================================================================
// Persistence
// =========================================================================

/**
 * Format extracted facts as markdown for memory indexing.
 */
function formatFactsAsMarkdown(result: ExtractionResult): string {
  const lines: string[] = [];
  const date = result.extractedAt.split("T")[0];
  lines.push(`# Compaction Facts — ${date}`);
  lines.push("");
  lines.push(`Extracted at: ${result.extractedAt}`);
  if (result.sessionKey) {
    lines.push(`Session: ${result.sessionKey}`);
  }
  lines.push(`Messages processed: ${result.messageCount}`);
  lines.push(`Facts extracted: ${result.facts.length}`);
  lines.push("");

  // Group by category
  const groups = new Map<string, ExtractedFact[]>();
  for (const fact of result.facts) {
    const existing = groups.get(fact.category) ?? [];
    existing.push(fact);
    groups.set(fact.category, existing);
  }

  const categoryLabels: Record<string, string> = {
    decision: "## Decisions",
    task: "## Tasks & Actions",
    fact: "## Key Facts",
    correction: "## Corrections & Rules",
    preference: "## Preferences",
    url: "## URLs Referenced",
    error_pattern: "## Error Patterns",
  };

  const categoryOrder = ["decision", "correction", "preference", "task", "fact", "error_pattern", "url"];
  for (const cat of categoryOrder) {
    const facts = groups.get(cat);
    if (!facts || facts.length === 0) continue;

    lines.push(categoryLabels[cat] ?? `## ${cat}`);
    lines.push("");
    for (const fact of facts) {
      lines.push(`- ${fact.content}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Extract facts from messages about to be compacted and persist them
 * to the memory directory for auto-indexing.
 *
 * This is the main entry point — called from the compaction pipeline.
 *
 * @param messages - The messages about to be compacted (will be destroyed)
 * @param workspaceDir - Workspace directory (memory/ will be created inside)
 * @param sessionKey - Optional session identifier for context
 * @returns Number of facts extracted and persisted
 */
export async function extractAndPersistCompactionFacts(params: {
  messages: AgentMessage[];
  workspaceDir: string;
  sessionKey?: string;
}): Promise<{ factsCount: number; filePath: string | null }> {
  try {
    const facts = extractFacts(params.messages);

    // Skip writing if no meaningful facts found
    if (facts.length === 0) {
      log.debug("compaction-facts: no facts extracted, skipping write");
      return { factsCount: 0, filePath: null };
    }

    const now = new Date();
    const result: ExtractionResult = {
      facts,
      messageCount: params.messages.length,
      extractedAt: now.toISOString(),
      sessionKey: params.sessionKey,
    };

    const markdown = formatFactsAsMarkdown(result);

    // Write to memory/compaction-facts/ directory
    const factsDir = path.join(params.workspaceDir, "memory", "compaction-facts");
    await fs.mkdir(factsDir, { recursive: true });

    // Filename: timestamp-based to avoid collisions
    const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const sessionSuffix = params.sessionKey
      ? `-${params.sessionKey.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 30)}`
      : "";
    const fileName = `${timestamp}${sessionSuffix}.md`;
    const filePath = path.join(factsDir, fileName);

    await fs.writeFile(filePath, markdown, "utf-8");

    log.info(`compaction-facts: extracted ${facts.length} facts from ${params.messages.length} messages → ${fileName}`);

    return { factsCount: facts.length, filePath };
  } catch (err) {
    // Best-effort: never block compaction if fact extraction fails
    log.warn(`compaction-facts: extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return { factsCount: 0, filePath: null };
  }
}
