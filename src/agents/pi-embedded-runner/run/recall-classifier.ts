/**
 * Adaptive auto-recall depth classifier.
 *
 * Pure function — no async, no side effects.  Classifies an incoming prompt
 * so the auto-recall system can tune retrieval parameters (result count,
 * minimum similarity score, max context chars).
 */

export type RecallDepth = 'none' | 'shallow' | 'normal' | 'deep';

export interface RecallParams {
  maxResults: number;
  minScore: number;
  maxChars: number;
}

export const RECALL_PARAMS: Record<RecallDepth, RecallParams> = {
  none:    { maxResults: 0,  minScore: 0,   maxChars: 0 },
  shallow: { maxResults: 3,  minScore: 0.4, maxChars: 2000 },
  normal:  { maxResults: 5,  minScore: 0.3, maxChars: 4000 },
  deep:    { maxResults: 10, minScore: 0.2, maxChars: 8000 },
};

const GREETINGS =
  /^(hi|hello|hey|sup|yo|gm|good\s*(morning|afternoon|evening|night)|thanks|thank you|ok|okay|yes|no|sure|cool|nice|👍|❤️|😊)\s*[!.?]*$/i;

const MEMORY_TRIGGERS =
  /\b(remember|recall|last\s+time|previously|earlier|before|history|what\s+happened|when\s+did|did\s+(i|we|you)|how\s+did|what\s+was)\b/i;

const CONTEXT_TRIGGERS =
  /\b(who\s+is|tell\s+me\s+about|update\s+on|status\s+of|progress|what('s| is)\s+the\s+(plan|status|update))\b/i;

const TASK_TRIGGERS =
  /^(do|run|check|fix|update|create|delete|send|write|read|open|close|start|stop|restart|install|build)\b/i;

export function classifyRecallDepth(prompt: string): RecallDepth {
  const trimmed = prompt.trim().toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;

  // Skip: greetings, single words, emojis
  if (GREETINGS.test(trimmed) || wordCount <= 2) {
    return 'none';
  }

  // Deep: explicit memory/recall questions
  if (MEMORY_TRIGGERS.test(trimmed)) {
    return 'deep';
  }

  // Deep: questions about people, projects, decisions
  if (CONTEXT_TRIGGERS.test(trimmed)) {
    return 'deep';
  }

  // Shallow: simple task instructions (<10 words starting with action verbs)
  if (TASK_TRIGGERS.test(trimmed) && wordCount < 10) {
    return 'shallow';
  }

  return 'normal';
}
