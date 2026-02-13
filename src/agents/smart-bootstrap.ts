/**
 * Smart Bootstrap — Reduce context bloat from large workspace files
 *
 * Problem: TOOLS.md (~26K chars), MEMORY.md (~25K chars), AGENTS.md (~15K)
 * are loaded in full every session. For a simple "what's the weather?" query,
 * that's 60K+ chars of irrelevant context — wasting tokens and diluting focus.
 *
 * Solution: For files above a threshold, inject only a condensed version
 * (headers + first lines of each section) and rely on auto-recall to surface
 * relevant chunks on demand. The agent can still read the full file via tools.
 *
 * Files that are ALWAYS loaded in full:
 * - SOUL.md (personality — short, always needed)
 * - IDENTITY.md (who the agent is — short)
 * - USER.md (who the user is — short)
 * - BOOTSTRAP.md (first-run only — usually missing)
 *
 * Files that get smart-trimmed when large:
 * - AGENTS.md (instructions — keep first 3K chars + section headers)
 * - TOOLS.md (tool config — keep first 2K chars + section headers)
 * - MEMORY.md (long-term memory — replace with note that auto-recall handles it)
 * - HEARTBEAT.md (already handled separately for heartbeats)
 */

import type { WorkspaceBootstrapFile } from "./workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
} from "./workspace.js";

// =========================================================================
// Configuration
// =========================================================================

/** Files above this char count get smart-trimmed */
const TRIM_THRESHOLD = 6_000;

/** How many chars to keep from the beginning of a trimmed file */
const AGENTS_KEEP_CHARS = 4_000;
const TOOLS_KEEP_CHARS = 3_000;

/** Maximum chars for extracted section headers */
const HEADERS_MAX_CHARS = 2_000;

// =========================================================================
// Header extraction
// =========================================================================

/**
 * Extract markdown section headers from content.
 * Returns a compact TOC-like string: "## Section 1\n## Section 2\n..."
 */
function extractHeaders(content: string): string {
  const lines = content.split("\n");
  const headers: string[] = [];
  let chars = 0;

  for (const line of lines) {
    if (/^#{1,4}\s/.test(line) && chars < HEADERS_MAX_CHARS) {
      headers.push(line.trim());
      chars += line.length + 1;
    }
  }

  return headers.join("\n");
}

/**
 * Smart-trim a large file: keep the first N chars + section headers.
 * Adds a note that the full file is available via read tool / auto-recall.
 */
function smartTrim(content: string, keepChars: number, fileName: string): string {
  if (content.length <= TRIM_THRESHOLD) return content;

  const prefix = content.slice(0, keepChars);
  const headers = extractHeaders(content.slice(keepChars));

  const lines = [prefix.trimEnd()];

  if (headers) {
    lines.push("");
    lines.push(`\n…(truncated ${fileName}: kept ${keepChars}+${headers.length} chars of ${content.length})…`);
    lines.push("");
    lines.push("### Remaining sections (headers only — use read tool or auto-recall for details):");
    lines.push(headers);
  } else {
    lines.push("");
    lines.push(`\n…(truncated ${fileName}: kept ${keepChars} of ${content.length} chars)…`);
  }

  return lines.join("\n");
}

// =========================================================================
// Main filter
// =========================================================================

/**
 * Apply smart trimming to bootstrap files.
 * Called after loading but before building context files.
 *
 * Only trims files that are above the threshold.
 * Auto-recall is expected to surface relevant chunks from the trimmed portions.
 *
 * @param files - Loaded bootstrap files
 * @param opts.autoRecallEnabled - If true, MEMORY.md is replaced with a short note
 * @param opts.isHeartbeat - If true, skip trimming (heartbeat already filtered)
 */
export function applySmartBootstrapTrimming(
  files: WorkspaceBootstrapFile[],
  opts?: { autoRecallEnabled?: boolean; isHeartbeat?: boolean },
): WorkspaceBootstrapFile[] {
  if (opts?.isHeartbeat) return files; // Already handled

  return files.map((file) => {
    if (file.missing || !file.content) return file;

    // MEMORY.md: if auto-recall is enabled, replace with a short note
    if (
      opts?.autoRecallEnabled &&
      (file.name === DEFAULT_MEMORY_FILENAME || file.name === DEFAULT_MEMORY_ALT_FILENAME) &&
      file.content.length > TRIM_THRESHOLD
    ) {
      return {
        ...file,
        content:
          "# MEMORY.md\n\n" +
          "Long-term memory is managed by auto-recall. Relevant memories are pre-injected above.\n" +
          "To browse or update MEMORY.md, use the read/write tools directly.\n\n" +
          extractHeaders(file.content),
      };
    }

    // AGENTS.md: keep instructions header + section TOC
    if (file.name === DEFAULT_AGENTS_FILENAME && file.content.length > TRIM_THRESHOLD) {
      return {
        ...file,
        content: smartTrim(file.content, AGENTS_KEEP_CHARS, file.name),
      };
    }

    // TOOLS.md: keep key config + section TOC
    if (file.name === DEFAULT_TOOLS_FILENAME && file.content.length > TRIM_THRESHOLD) {
      return {
        ...file,
        content: smartTrim(file.content, TOOLS_KEEP_CHARS, file.name),
      };
    }

    return file;
  });
}
