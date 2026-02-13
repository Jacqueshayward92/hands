/**
 * Context Classifier — Determine what context the agent needs per-message
 *
 * Instead of loading ALL context for every message, classify the incoming
 * message and return which context blocks are relevant.
 *
 * Uses fast heuristics (regex + keyword matching), NOT an LLM call.
 * Runs in <1ms. False positives are fine (extra context = safe).
 * False negatives are bad (missing context = broken), so err on inclusion.
 *
 * Returns a set of context tags. The system uses these to decide which
 * injections to include/exclude.
 */

// =========================================================================
// Types
// =========================================================================

export type ContextTag =
  | "tools"         // TOOLS.md content needed (specific tool config, credentials)
  | "memory"        // MEMORY.md / auto-recall important
  | "tasks"         // Task ledger relevant
  | "corrections"   // Correction store relevant
  | "tool_failures" // Tool failure store relevant
  | "subagents"     // Sub-agent status relevant
  | "proactive"     // Proactive triggers relevant
  | "episodes"      // Past work history relevant
  | "procedures"    // How-to procedures relevant
  | "chat"          // Pure conversation (minimal context needed)
  | "technical"     // Technical/coding work
  | "research"      // Research/search tasks
  | "communication" // Email/messaging tasks
  | "files"         // File operations
  | "scheduling"    // Calendar/reminders/cron
  | "system"        // System management (gateway, config, services)
  ;

export type ClassificationResult = {
  tags: Set<ContextTag>;
  /** Confidence that this is a simple chat (0-1) */
  chatProbability: number;
  /** Whether context can be minimized */
  minimalContext: boolean;
};

// =========================================================================
// Patterns
// =========================================================================

const PATTERN_MAP: Array<{ pattern: RegExp; tags: ContextTag[] }> = [
  // Tool-specific patterns
  { pattern: /\b(?:camera|vigi|snapshot|alert|motion|ptz)\b/i, tags: ["tools", "technical"] },
  { pattern: /\b(?:tts|voice|speak|audio|qwen|kayla.*voice)\b/i, tags: ["tools", "technical"] },
  { pattern: /\b(?:browser|hands.*profile|playwright)\b/i, tags: ["tools", "technical"] },
  { pattern: /\b(?:google.*drive|drive.*letter|mount)\b/i, tags: ["tools", "files"] },
  { pattern: /\b(?:excel|xlsx|csv|spreadsheet|pandas|openpyxl)\b/i, tags: ["tools", "files"] },
  { pattern: /\b(?:pdf|docx?|word|powerpoint|pptx)\b/i, tags: ["tools", "files"] },
  { pattern: /\b(?:conda|miniconda|pip install|python.*env)\b/i, tags: ["tools", "technical"] },
  { pattern: /\b(?:pm2|service|daemon|process.*manager)\b/i, tags: ["tools", "system"] },

  // Task/work patterns
  { pattern: /\b(?:task|todo|backlog|priority|deadline|goal)\b/i, tags: ["tasks"] },
  { pattern: /\b(?:what.*(?:working|doing)|status|progress|update)\b/i, tags: ["tasks", "subagents", "episodes"] },
  { pattern: /\b(?:remember|recall|last.*time|yesterday|earlier|before)\b/i, tags: ["memory", "episodes"] },
  { pattern: /\b(?:how.*(?:did|do)|procedure|steps|workflow)\b/i, tags: ["procedures", "episodes"] },

  // Research/search
  { pattern: /\b(?:search|research|find|look.*up|google|browse)\b/i, tags: ["research", "tool_failures"] },
  { pattern: /\b(?:lead|prospect|brand|amazon|seller|asin)\b/i, tags: ["research", "memory"] },
  { pattern: /\b(?:web_search|web_fetch|scrape|crawl)\b/i, tags: ["research", "tools", "tool_failures"] },

  // Communication
  { pattern: /\b(?:email|gmail|draft|send|outreach|message)\b/i, tags: ["communication", "tools"] },
  { pattern: /\b(?:whatsapp|telegram|discord|signal|slack)\b/i, tags: ["communication"] },

  // File operations
  { pattern: /\b(?:file|folder|directory|read|write|edit|create|delete|rename)\b/i, tags: ["files"] },
  { pattern: /\b(?:git|commit|push|pull|branch|merge)\b/i, tags: ["files", "technical"] },

  // Scheduling
  { pattern: /\b(?:cron|schedule|reminder|alarm|timer|heartbeat)\b/i, tags: ["scheduling", "system"] },
  { pattern: /\b(?:calendar|event|meeting|appointment)\b/i, tags: ["scheduling", "tools"] },

  // System
  { pattern: /\b(?:gateway|config|restart|update|install|npm)\b/i, tags: ["system", "tools"] },
  { pattern: /\b(?:model|claude|opus|haiku|sonnet|openrouter|ollama)\b/i, tags: ["system"] },
  { pattern: /\b(?:sub.*agent|spawn|worker|parallel)\b/i, tags: ["subagents"] },

  // Technical
  { pattern: /\b(?:code|script|function|debug|error|fix|build|compile)\b/i, tags: ["technical", "tool_failures"] },
  { pattern: /\b(?:api|endpoint|request|response|json|http)\b/i, tags: ["technical", "tools"] },

  // Corrections/learning
  { pattern: /\b(?:wrong|incorrect|no,?\s*(?:that|it)|actually|don'?t)\b/i, tags: ["corrections"] },
  { pattern: /\b(?:always|never|remember|from now on|going forward)\b/i, tags: ["corrections", "memory"] },
];

// Simple chat patterns (greetings, acknowledgements, short messages)
const CHAT_PATTERNS = [
  /^(?:hi|hey|hello|yo|sup|morning|evening|night|gm|gn)\b/i,
  /^(?:ok|okay|sure|yeah|yep|nope|no|yes|thanks|thank you|cool|nice|great|good|perfect|awesome)\b/i,
  /^(?:how are you|what'?s up|how'?s it going)\b/i,
  /^(?:lol|haha|😂|👍|❤️|🙌)/,
];

// =========================================================================
// Classification
// =========================================================================

/**
 * Classify an incoming message and return relevant context tags.
 *
 * Fast heuristic — runs in <1ms. Errs on inclusion (false positives safe).
 */
export function classifyMessage(message: string): ClassificationResult {
  const tags = new Set<ContextTag>();
  const trimmed = message.trim();

  // Very short messages — likely simple chat
  if (trimmed.length < 10) {
    const isChat = CHAT_PATTERNS.some(p => p.test(trimmed));
    if (isChat) {
      tags.add("chat");
      return { tags, chatProbability: 0.9, minimalContext: true };
    }
  }

  // Check all patterns
  for (const { pattern, tags: matchTags } of PATTERN_MAP) {
    if (pattern.test(trimmed)) {
      for (const tag of matchTags) tags.add(tag);
    }
  }

  // If no specific patterns matched, check for chat
  if (tags.size === 0) {
    const isChat = CHAT_PATTERNS.some(p => p.test(trimmed));
    if (isChat) {
      tags.add("chat");
      return { tags, chatProbability: 0.8, minimalContext: true };
    }
    // Unknown intent — include everything to be safe
    return { tags: new Set(["memory", "tasks", "corrections", "tool_failures"] as ContextTag[]), chatProbability: 0.2, minimalContext: false };
  }

  // Always include corrections for non-chat messages (safety net)
  if (!tags.has("chat")) {
    tags.add("corrections");
  }

  // Research/technical tasks likely benefit from memory + procedures
  if (tags.has("research") || tags.has("technical")) {
    tags.add("memory");
    tags.add("procedures");
  }

  const chatProb = tags.has("chat") ? 0.7 : 0.1;
  return { tags, chatProbability: chatProb, minimalContext: tags.has("chat") };
}

/**
 * Given classification result, determine which context injections to skip.
 * Returns a set of context file paths that should be EXCLUDED.
 *
 * Conservative: only excludes when confident the context isn't needed.
 */
export function resolveContextExclusions(result: ClassificationResult): Set<string> {
  const exclude = new Set<string>();

  if (result.minimalContext) {
    // Pure chat — skip heavy injections
    exclude.add("TASK_LEDGER");
    exclude.add("TOOL_FAILURES");
    exclude.add("SUBAGENT_STATUS");
    exclude.add("PROACTIVE_ALERTS");
    // Keep: corrections (always), auto-recall memories (might reference chat topics)
  }

  // Specific exclusions based on what's NOT in the tags
  if (!result.tags.has("tasks") && !result.tags.has("chat")) {
    // Don't exclude task ledger for unknown messages — could be task-related
  }

  if (!result.tags.has("subagents") && result.chatProbability < 0.5) {
    // Only exclude sub-agent status for definite non-subagent messages
    // Actually, be conservative — keep it. It's small.
  }

  return exclude;
}
