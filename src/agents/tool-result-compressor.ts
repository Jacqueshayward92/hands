/**
 * Tool Result Compressor — Reduce tool output context overhead
 *
 * Problem: Tool results enter context at full fidelity. A web_search
 * returns ~5K chars of results. A web_fetch returns ~8K of page content.
 * An exec command dumps full stdout. Most of this is noise.
 *
 * Fix: Apply content-aware heuristic compression per tool type.
 * NOT an LLM call — pure regex/heuristic for speed.
 * Reduces tool result size by 50-80% while preserving useful content.
 *
 * The full result is captured by the scratch pad for later recall.
 * Only the compressed version enters the agent's context window.
 */

// =========================================================================
// Configuration
// =========================================================================

/** Maximum compressed result size per tool type */
const COMPRESSED_LIMITS: Record<string, number> = {
  web_search: 3000,
  web_fetch: 4000,
  exec: 3000,
  Read: 5000, // File reads are usually intentional — keep more
  memory_search: 2000,
  memory_get: 3000,
  sessions_list: 2000,
  sessions_history: 3000,
};

/** Default limit for tools not in the map */
const DEFAULT_LIMIT = 6000;

// =========================================================================
// Compression strategies per tool
// =========================================================================

/** Compress web search results: keep titles + URLs + first line of snippets */
function compressWebSearch(text: string): string {
  const lines = text.split("\n");
  const compressed: string[] = [];
  let inResult = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Keep result headers (numbered results, titles)
    if (/^\d+\./.test(trimmed) || /^#+\s/.test(trimmed) || /^Title:/i.test(trimmed)) {
      compressed.push(trimmed);
      inResult = true;
      continue;
    }

    // Keep URLs
    if (/^https?:\/\//.test(trimmed) || /^URL:/i.test(trimmed) || /^Link:/i.test(trimmed)) {
      compressed.push(trimmed);
      continue;
    }

    // Keep first line of snippet, skip rest
    if (inResult && trimmed.length > 10 && !trimmed.startsWith("---")) {
      compressed.push(trimmed.slice(0, 200));
      inResult = false;
      continue;
    }

    // Skip empty lines and separators
    if (!trimmed || trimmed === "---") {
      inResult = false;
    }
  }

  return compressed.join("\n");
}

/** Compress web fetch results: strip boilerplate, keep main content */
function compressWebFetch(text: string): string {
  const lines = text.split("\n");
  const compressed: string[] = [];

  // Skip common boilerplate patterns
  const skipPatterns = [
    /^(?:cookie|privacy|terms|copyright|©|\|.*\|.*\|)/i,
    /^(?:sign (?:in|up)|log (?:in|out)|subscribe|newsletter)/i,
    /^(?:share|tweet|pin|follow us|social media)/i,
    /^(?:advertisement|sponsored|related articles)/i,
    /^\s*(?:\[.*\]\(.*\)\s*){3,}/, // Navigation link clusters
    /^(?:menu|nav|sidebar|footer|header)\s*$/i,
    /^\s*(?:•\s*){3,}/, // Bullet point navigation
  ];

  let consecutiveEmpty = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines (max 1 consecutive)
    if (!trimmed) {
      consecutiveEmpty++;
      if (consecutiveEmpty <= 1) compressed.push("");
      continue;
    }
    consecutiveEmpty = 0;

    // Skip boilerplate
    if (skipPatterns.some(p => p.test(trimmed))) continue;

    // Skip very short lines (likely navigation)
    if (trimmed.length < 5 && !trimmed.startsWith("#")) continue;

    compressed.push(trimmed);
  }

  return compressed.join("\n");
}

/** Compress exec output: keep first/last sections, skip middle noise */
function compressExec(text: string): string {
  const lines = text.split("\n");

  if (lines.length <= 50) return text; // Short output — keep all

  // Keep first 20 lines + last 20 lines + any error/warning lines
  const important: string[] = [];
  const KEEP_HEAD = 20;
  const KEEP_TAIL = 20;

  for (let i = 0; i < Math.min(KEEP_HEAD, lines.length); i++) {
    important.push(lines[i]);
  }

  if (lines.length > KEEP_HEAD + KEEP_TAIL) {
    important.push(`\n... (${lines.length - KEEP_HEAD - KEEP_TAIL} lines omitted) ...\n`);

    // Scan middle for errors/warnings
    for (let i = KEEP_HEAD; i < lines.length - KEEP_TAIL; i++) {
      if (/(?:error|warn|fail|exception|fatal)/i.test(lines[i])) {
        important.push(lines[i]);
      }
    }
  }

  for (let i = Math.max(KEEP_HEAD, lines.length - KEEP_TAIL); i < lines.length; i++) {
    important.push(lines[i]);
  }

  return important.join("\n");
}

/** Compress memory search results: keep top results, trim snippets */
function compressMemorySearch(text: string): string {
  const lines = text.split("\n");
  const compressed: string[] = [];
  let resultCount = 0;

  for (const line of lines) {
    // Keep result headers and scores
    if (/^(?:#|\d+\.|Score:|Path:|Source:)/i.test(line.trim())) {
      resultCount++;
      if (resultCount <= 5) compressed.push(line); // Keep top 5
      continue;
    }
    // Keep snippet content for top results
    if (resultCount <= 5 && line.trim()) {
      compressed.push(line.trim().slice(0, 300));
    }
  }

  return compressed.join("\n");
}

// =========================================================================
// Main entry point
// =========================================================================

/**
 * Compress a tool result before it enters the agent's context.
 *
 * Returns the compressed text. If the text is already small enough
 * or no compression strategy exists for the tool, returns as-is.
 *
 * The full result should be separately captured to the scratch pad
 * for later recall if needed.
 */
export function compressToolResult(toolName: string, text: string): string {
  if (!text) return text;

  const limit = COMPRESSED_LIMITS[toolName] ?? DEFAULT_LIMIT;

  // Already under limit — no compression needed
  if (text.length <= limit) return text;

  // Apply tool-specific compression
  let compressed = text;

  switch (toolName) {
    case "web_search":
      compressed = compressWebSearch(text);
      break;
    case "web_fetch":
      compressed = compressWebFetch(text);
      break;
    case "exec":
    case "bash":
      compressed = compressExec(text);
      break;
    case "memory_search":
      compressed = compressMemorySearch(text);
      break;
    default:
      // Generic compression: keep first part + tail
      if (text.length > limit) {
        const headSize = Math.floor(limit * 0.75);
        const tailSize = Math.floor(limit * 0.2);
        compressed = text.slice(0, headSize) +
          `\n\n... (${text.length - headSize - tailSize} chars omitted) ...\n\n` +
          text.slice(-tailSize);
      }
      break;
  }

  // Final truncation if still over limit
  if (compressed.length > limit) {
    compressed = compressed.slice(0, limit) + "\n…(compressed)…";
  }

  return compressed;
}
