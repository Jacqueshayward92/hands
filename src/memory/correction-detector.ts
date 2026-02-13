export type CorrectionSignal = {
  detected: boolean;
  confidence: number;       // 0-1
  userMessage: string;      // the correction
  agentMessage?: string;    // what the agent said that was wrong
  category?: string;        // 'factual' | 'behavioral' | 'preference' | 'procedural'
};

export function detectCorrection(params: {
  userMessage: string;
  previousAgentMessage?: string;
  previousUserMessage?: string;
}): CorrectionSignal {
  // Very lightweight heuristic-based detector (MVP):
  const up = (s: string) => s?.toLowerCase?.() ?? "";
  const m = up(params.userMessage || "");
  const negs = ["no", "not", "wrong", "incorrect", "don’t", "don't", "stop"]; // basic negations
  const detected = negs.some(n => m.includes(n));
  const confidence = detected ? 0.6 : 0.2;
  // crude category guess
  let category: string | undefined;
  if (m.includes("ip") || m.includes("data")) category = "factual";
  else if (m.includes("never") || m.includes("always")) category = "behavioral";
  else if (m.includes("prefer") || m.includes("should")) category = "preference";
  else category = "procedural";
  return {
    detected,
    confidence: Math.max(0, Math.min(1, confidence)),
    userMessage: params.userMessage,
    agentMessage: params?.previousAgentMessage,
    category,
  };
}
