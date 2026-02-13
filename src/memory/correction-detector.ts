export type CorrectionSignal = {
  detected: boolean;
  confidence: number;
  userMessage: string;
  agentMessage?: string;
  category?: string;
};

export function detectCorrection(params: {
  userMessage: string;
  previousAgentMessage?: string;
  previousUserMessage?: string;
}): CorrectionSignal {
  const { userMessage, previousAgentMessage } = params;
  const text = (userMessage || "").toLowerCase();
  const clusters: string[] = [];
  // pattern sets
  const explicitNegation = /(\bno\b|\bwrong\b|it's not right|that\s+isn't\s+right|incorrect|don't\s+do\s+that|stop\s+doing\s+this)/i;
  const correctionPats = /(\bactually\b|\bi\s+meant\b|\bnot\s+[^,]+,\s*[^,]+|\buse\s+[^\s]+\s+instead\b|\bthe\s+correct\s+way\b)/i;
  const preference = /(\bi\s+prefer\b|\balways\s+do\b|\bnever\s+do\b|\bdon't\s+use\b|\bfrom\s+now\s+on\b)/i;
  const behavioral = /(\bdon't\s+ask\b|\bstop\s+asking\s+permission\b|\bjust\s+do\s+it\b|\bbe\s+more\b|\bbe\s+less\b)/i;
  const frustration = /(\bi\s+already\s+told\s+you\b|\bagain\?\b|how\s+many\s+times\b)/i;

  let category: string | undefined;
  let signals = 0;
  if (explicitNegation.test(text)) { signals++; category = category ?? 'procedural'; }
  if (correctionPats.test(text)) { signals++; category = category ?? 'factual'; }
  if (preference.test(text)) { signals++; category = category ?? 'preference'; }
  if (behavioral.test(text)) { signals++; category = category ?? 'behavioral'; }
  if (frustration.test(text)) { signals++; category = category ?? 'procedural'; }

  const detected = signals > 0;
  // rough confidence: more signals -> higher
  let confidence = 0;
  if (signals > 1) confidence = Math.min(0.95, 0.5 + signals * 0.15);
  else if (signals === 1) confidence = 0.6;
  else confidence = 0.0;
  // clamp
  if (confidence < 0) confidence = 0; if (confidence > 1) confidence = 1;

  return {
    detected,
    confidence,
    userMessage,
    agentMessage: previousAgentMessage,
    category,
  };
}
