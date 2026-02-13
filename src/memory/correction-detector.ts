export type CorrectionCategory = "factual" | "behavioral" | "preference" | "procedural";

export type CorrectionSignal = {
  detected: boolean;
  confidence: number; // 0-1
  userMessage: string;
  agentMessage?: string;
  category?: CorrectionCategory;
};

type SignalMatch = {
  weight: number;
  category: CorrectionCategory;
};

// Strong correction signals — high confidence
const STRONG_PATTERNS: Array<{ pattern: RegExp; category: CorrectionCategory }> = [
  // Explicit negation of agent output
  { pattern: /\b(that'?s\s+(wrong|incorrect|not\s+right|not\s+correct))\b/i, category: "factual" },
  { pattern: /\bno[,.]?\s+(it'?s|that'?s|the\s+\w+\s+is)\b/i, category: "factual" },
  { pattern: /\bnot\s+\w+[,]\s*(it'?s|use|the)\b/i, category: "factual" },

  // Correction with replacement
  { pattern: /\bactually[,]?\s+(it'?s|the|you|we|I)\b/i, category: "factual" },
  { pattern: /\bI\s+meant\b/i, category: "factual" },
  { pattern: /\buse\s+\w+\s+instead\b/i, category: "procedural" },
  { pattern: /\bthe\s+correct\s+(way|answer|one|value|IP|path|url)\b/i, category: "factual" },
  { pattern: /\bnot\s+\w+[,]\s*\w+/i, category: "factual" }, // "not X, Y"

  // Behavioral corrections
  { pattern: /\bdon'?t\s+ask\s+(me\s+)?(for\s+)?permission\b/i, category: "behavioral" },
  { pattern: /\bstop\s+(asking|doing|saying|sending)\b/i, category: "behavioral" },
  { pattern: /\bjust\s+do\s+it\b/i, category: "behavioral" },
  { pattern: /\bdon'?t\s+(ask|wait|check)\s*(,|\b)/i, category: "behavioral" },

  // Preference declarations
  { pattern: /\bfrom\s+now\s+on\b/i, category: "preference" },
  { pattern: /\bI\s+prefer\b/i, category: "preference" },
  { pattern: /\balways\s+(do|use|send|check|make)\b/i, category: "preference" },
  { pattern: /\bnever\s+(do|use|send|ask|make)\b/i, category: "preference" },
  { pattern: /\bremember\s+(to\s+)?(always|never)\b/i, category: "preference" },

  // Frustration (implies repeated correction)
  { pattern: /\bI\s+(already|just)\s+told\s+you\b/i, category: "behavioral" },
  { pattern: /\bhow\s+many\s+times\b/i, category: "behavioral" },
  { pattern: /\bagain\s*\?/i, category: "behavioral" },
];

// Weak signals — only count if combined with others
const WEAK_PATTERNS: Array<{ pattern: RegExp; category: CorrectionCategory }> = [
  { pattern: /^no[,.\s]/i, category: "factual" },
  { pattern: /\bwrong\b/i, category: "factual" },
  { pattern: /\bincorrect\b/i, category: "factual" },
  { pattern: /\bshould\s+(be|have|use)\b/i, category: "procedural" },
  { pattern: /\bdon'?t\s+\w+\s+that\b/i, category: "behavioral" },
  { pattern: /\binstead\b/i, category: "procedural" },
];

export function detectCorrection(params: {
  userMessage: string;
  previousAgentMessage?: string;
  previousUserMessage?: string;
}): CorrectionSignal {
  const msg = params.userMessage?.trim() ?? "";
  if (!msg || msg.length < 3) {
    return { detected: false, confidence: 0, userMessage: msg };
  }

  const strongMatches: SignalMatch[] = [];
  const weakMatches: SignalMatch[] = [];

  for (const { pattern, category } of STRONG_PATTERNS) {
    if (pattern.test(msg)) {
      strongMatches.push({ weight: 0.4, category });
    }
  }

  for (const { pattern, category } of WEAK_PATTERNS) {
    if (pattern.test(msg)) {
      weakMatches.push({ weight: 0.15, category });
    }
  }

  const totalWeight =
    strongMatches.reduce((sum, m) => sum + m.weight, 0) +
    weakMatches.reduce((sum, m) => sum + m.weight, 0);

  // Need at least one strong signal, or 2+ weak signals
  const detected =
    strongMatches.length >= 1 || weakMatches.length >= 2;

  const confidence = Math.min(1, totalWeight);

  // Determine dominant category
  const allMatches = [...strongMatches, ...weakMatches];
  const categoryCounts = new Map<CorrectionCategory, number>();
  for (const m of allMatches) {
    categoryCounts.set(m.category, (categoryCounts.get(m.category) ?? 0) + m.weight);
  }
  let category: CorrectionCategory | undefined;
  let maxWeight = 0;
  for (const [cat, weight] of categoryCounts) {
    if (weight > maxWeight) {
      maxWeight = weight;
      category = cat;
    }
  }

  return {
    detected,
    confidence: Math.round(confidence * 100) / 100,
    userMessage: msg,
    agentMessage: params.previousAgentMessage,
    category: detected ? category : undefined,
  };
}

/**
 * Extract a concise rule from a correction message.
 * Strips meta-language and keeps the instructive content.
 */
export function extractCorrectionRule(correctionText: string): string {
  let rule = correctionText.trim();

  // Strip leading meta-language
  rule = rule.replace(
    /^(no[,.\s]+|wrong[,.\s]+|incorrect[,.\s]+|actually[,.\s]+|that'?s\s+(wrong|incorrect|not\s+right)[,.\s]+)/i,
    "",
  );

  // Strip trailing punctuation emphasis
  rule = rule.replace(/[!]{2,}$/, "!").trim();

  // Capitalize first letter
  if (rule.length > 0) {
    rule = rule[0].toUpperCase() + rule.slice(1);
  }

  // Truncate if too long
  if (rule.length > 300) {
    rule = rule.slice(0, 297) + "...";
  }

  return rule;
}
