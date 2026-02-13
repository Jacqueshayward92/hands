/**
 * Tool Failure Store — Learn from tool errors across sessions
 *
 * When tools fail (429 errors, wrong params, timeouts, encoding issues),
 * the failure pattern is persisted. Before each run, known failures for
 * tools the agent commonly uses are injected into context.
 *
 * The agent learns from its own mistakes without user intervention.
 * A human assistant who burned their hand doesn't touch the stove again.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("tool-failures");

// =========================================================================
// Types
// =========================================================================

export type ToolFailure = {
  toolName: string;
  /** Normalized error pattern (not the full error — just the pattern) */
  pattern: string;
  /** Category of failure */
  category: "rate_limit" | "auth" | "timeout" | "invalid_params" | "not_found" | "encoding" | "other";
  /** How many times this pattern has occurred */
  count: number;
  /** Human-readable lesson learned */
  lesson: string;
  firstSeen: string;
  lastSeen: string;
};

type FailureStore = {
  version: 1;
  failures: ToolFailure[];
};

// =========================================================================
// Constants
// =========================================================================

const MAX_FAILURES = 100;
const MAX_PATTERN_LENGTH = 200;
const MAX_INJECTION_FAILURES = 15;

// =========================================================================
// Error Pattern Detection
// =========================================================================

type PatternMatch = {
  category: ToolFailure["category"];
  pattern: string;
  lesson: string;
};

const ERROR_CLASSIFIERS: Array<{
  test: RegExp;
  category: ToolFailure["category"];
  lesson: (match: RegExpMatchArray, toolName: string) => string;
}> = [
  {
    test: /429|rate.?limit|too many requests|quota exceeded|throttl/i,
    category: "rate_limit",
    lesson: (_m, tool) => `${tool} hits rate limits — add delays between calls or reduce batch size.`,
  },
  {
    test: /401|403|unauthorized|forbidden|invalid.*(?:key|token|credential)|auth/i,
    category: "auth",
    lesson: (_m, tool) => `${tool} auth failure — check API key/token is valid and has required permissions.`,
  },
  {
    test: /timeout|timed?\s*out|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i,
    category: "timeout",
    lesson: (_m, tool) => `${tool} times out — consider retry with backoff or check if the service is available.`,
  },
  {
    test: /not found|404|ENOENT|no such file|does not exist|cannot find/i,
    category: "not_found",
    lesson: (_m, tool) => `${tool} target not found — verify path/URL exists before calling.`,
  },
  {
    test: /encoding|unicode|utf|charmap|codec|UnicodeDecodeError|is not recognized/i,
    category: "encoding",
    lesson: (_m, tool) => `${tool} encoding issue — use explicit encoding or wrap in cmd /c on Windows.`,
  },
  {
    test: /invalid.*param|missing.*required|unexpected.*argument|TypeError|ValidationError/i,
    category: "invalid_params",
    lesson: (_m, tool) => `${tool} parameter error — check required params and types.`,
  },
];

function classifyError(errorText: string, toolName: string): PatternMatch | null {
  if (!errorText || errorText.length < 5) return null;

  for (const classifier of ERROR_CLASSIFIERS) {
    const match = errorText.match(classifier.test);
    if (match) {
      // Extract a short, normalized pattern from the error
      const pattern = errorText
        .slice(0, MAX_PATTERN_LENGTH)
        .replace(/[0-9a-f]{8,}/gi, "<id>") // Replace long hex IDs
        .replace(/\d{10,}/g, "<timestamp>") // Replace timestamps
        .replace(/https?:\/\/\S+/g, "<url>") // Replace URLs
        .replace(/["'][^"']{50,}["']/g, '"<long_string>"') // Replace long strings
        .trim();

      return {
        category: classifier.category,
        pattern,
        lesson: classifier.lesson(match, toolName),
      };
    }
  }

  // Generic "other" failure if error is substantial
  if (errorText.length > 20) {
    return {
      category: "other",
      pattern: errorText.slice(0, MAX_PATTERN_LENGTH).trim(),
      lesson: `${toolName} failed — review the error and adjust approach.`,
    };
  }

  return null;
}

// =========================================================================
// File I/O
// =========================================================================

function resolveFailureFile(agentId: string): string {
  const dir = path.join(resolveStateDir(), "tool-failures");
  return path.join(dir, `${agentId}.json`);
}

async function readStore(agentId: string): Promise<FailureStore> {
  try {
    const raw = await fs.readFile(resolveFailureFile(agentId), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.failures)) {
      return parsed as FailureStore;
    }
    return { version: 1, failures: [] };
  } catch {
    return { version: 1, failures: [] };
  }
}

async function writeStore(agentId: string, store: FailureStore): Promise<void> {
  const filePath = resolveFailureFile(agentId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), "utf-8");
}

// =========================================================================
// CRUD
// =========================================================================

/**
 * Record a tool failure. If the same pattern exists, increment count.
 * Called from the tool execution end handler (fire-and-forget).
 */
export async function recordToolFailure(
  agentId: string,
  toolName: string,
  errorText: string,
): Promise<void> {
  const classified = classifyError(errorText, toolName);
  if (!classified) return;

  const store = await readStore(agentId);
  const now = new Date().toISOString();

  // Find existing pattern match (same tool + same category + similar pattern)
  const existing = store.failures.find(
    (f) =>
      f.toolName === toolName &&
      f.category === classified.category &&
      (f.pattern === classified.pattern ||
        // Fuzzy match: same first 50 chars of pattern
        f.pattern.slice(0, 50) === classified.pattern.slice(0, 50)),
  );

  if (existing) {
    existing.count += 1;
    existing.lastSeen = now;
    // Update lesson if we have a better one (longer)
    if (classified.lesson.length > existing.lesson.length) {
      existing.lesson = classified.lesson;
    }
  } else {
    // Prune if at limit
    if (store.failures.length >= MAX_FAILURES) {
      // Remove oldest, lowest-count failures
      store.failures.sort((a, b) => a.count - b.count || a.lastSeen.localeCompare(b.lastSeen));
      store.failures.splice(0, 10);
    }
    store.failures.push({
      toolName,
      pattern: classified.pattern,
      category: classified.category,
      count: 1,
      lesson: classified.lesson,
      firstSeen: now,
      lastSeen: now,
    });
  }

  await writeStore(agentId, store);
  log.debug(`recorded tool failure: ${toolName} [${classified.category}] count=${existing?.count ?? 1}`);
}

// =========================================================================
// Context Injection
// =========================================================================

/**
 * Build context injection string for known tool failures.
 * Returns null if no failures recorded.
 *
 * Prioritizes by: count (most frequent first), then recency.
 * Groups by tool name for readability.
 */
export async function readToolFailuresForInjection(agentId: string): Promise<string | null> {
  const store = await readStore(agentId);
  if (store.failures.length === 0) return null;

  // Sort by count (most frequent) then recency
  const sorted = [...store.failures].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen.localeCompare(a.lastSeen);
  });

  const top = sorted.slice(0, MAX_INJECTION_FAILURES);
  if (top.length === 0) return null;

  // Group by tool
  const byTool = new Map<string, ToolFailure[]>();
  for (const f of top) {
    const list = byTool.get(f.toolName) ?? [];
    list.push(f);
    byTool.set(f.toolName, list);
  }

  const lines: string[] = [
    "## ⚠️ Known Tool Issues (learned from past failures)",
    "These are tool failure patterns observed in past sessions. Avoid repeating them.",
    "",
  ];

  for (const [tool, failures] of byTool) {
    lines.push(`### ${tool}`);
    for (const f of failures) {
      const freq = f.count > 1 ? ` (${f.count}× since ${f.firstSeen.slice(0, 10)})` : "";
      lines.push(`- **${f.category}**${freq}: ${f.lesson}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
