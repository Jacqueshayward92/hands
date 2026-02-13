export type HybridSource = string;

export type HybridVectorResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  vectorScore: number;
  updatedAt?: number;
};

export type HybridKeywordResult = {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  source: HybridSource;
  snippet: string;
  textScore: number;
  updatedAt?: number;
};

export function buildFtsQuery(raw: string): string | null {
  const tokens =
    raw
      .match(/[A-Za-z0-9_]+/g)
      ?.map((t) => t.trim())
      .filter(Boolean) ?? [];
  if (tokens.length === 0) {
    return null;
  }
  const quoted = tokens.map((t) => `"${t.replaceAll('"', "")}"`);
  return quoted.join(" AND ");
}

export function bm25RankToScore(rank: number): number {
  const normalized = Number.isFinite(rank) ? Math.max(0, rank) : 999;
  return 1 / (1 + normalized);
}

/**
 * Compute a recency boost factor based on how recently a chunk was indexed.
 * Returns a value between 0 and 1:
 * - Last 24 hours: 1.0
 * - Last 7 days: ~0.85-1.0 (linear decay)
 * - Last 30 days: ~0.6-0.85
 * - Last 90 days: ~0.3-0.6
 * - Older: ~0.1-0.3 (floor at 0.1 — old memories still matter)
 *
 * This mirrors how human memory naturally prioritizes recent events.
 */
export function computeRecencyBoost(updatedAt: number | undefined, now?: number): number {
  if (!updatedAt || updatedAt <= 0) return 0.5; // Unknown age → neutral
  const currentMs = now ?? Date.now();
  const ageMs = Math.max(0, currentMs - updatedAt);
  const ageHours = ageMs / (1000 * 60 * 60);

  if (ageHours <= 24) return 1.0;
  if (ageHours <= 24 * 7) return 0.85 + 0.15 * (1 - (ageHours - 24) / (24 * 6));
  if (ageHours <= 24 * 30) return 0.6 + 0.25 * (1 - (ageHours - 24 * 7) / (24 * 23));
  if (ageHours <= 24 * 90) return 0.3 + 0.3 * (1 - (ageHours - 24 * 30) / (24 * 60));
  return Math.max(0.1, 0.3 * Math.exp(-(ageHours - 24 * 90) / (24 * 180)));
}

/** Default recency weight in the scoring formula */
export const DEFAULT_RECENCY_WEIGHT = 0.15;

export function mergeHybridResults(params: {
  vector: HybridVectorResult[];
  keyword: HybridKeywordResult[];
  vectorWeight: number;
  textWeight: number;
  /** Weight for recency boost (0 = disabled). Default: 0.15 */
  recencyWeight?: number;
}): Array<{
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: HybridSource;
  updatedAt?: number;
}> {
  const recencyWeight = params.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const now = Date.now();

  const byId = new Map<
    string,
    {
      id: string;
      path: string;
      startLine: number;
      endLine: number;
      source: HybridSource;
      snippet: string;
      vectorScore: number;
      textScore: number;
      updatedAt?: number;
    }
  >();

  for (const r of params.vector) {
    byId.set(r.id, {
      id: r.id,
      path: r.path,
      startLine: r.startLine,
      endLine: r.endLine,
      source: r.source,
      snippet: r.snippet,
      vectorScore: r.vectorScore,
      textScore: 0,
      updatedAt: r.updatedAt,
    });
  }

  for (const r of params.keyword) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.textScore = r.textScore;
      if (r.snippet && r.snippet.length > 0) {
        existing.snippet = r.snippet;
      }
      // Prefer the most recent updatedAt
      if (r.updatedAt && (!existing.updatedAt || r.updatedAt > existing.updatedAt)) {
        existing.updatedAt = r.updatedAt;
      }
    } else {
      byId.set(r.id, {
        id: r.id,
        path: r.path,
        startLine: r.startLine,
        endLine: r.endLine,
        source: r.source,
        snippet: r.snippet,
        vectorScore: 0,
        textScore: r.textScore,
        updatedAt: r.updatedAt,
      });
    }
  }

  // Normalize weights so they sum to 1
  const totalWeight = params.vectorWeight + params.textWeight + recencyWeight;
  const normVector = totalWeight > 0 ? params.vectorWeight / totalWeight : 0;
  const normText = totalWeight > 0 ? params.textWeight / totalWeight : 0;
  const normRecency = totalWeight > 0 ? recencyWeight / totalWeight : 0;

  const merged = Array.from(byId.values()).map((entry) => {
    const relevanceScore = normVector * entry.vectorScore + normText * entry.textScore;
    const recencyBoost = normRecency * computeRecencyBoost(entry.updatedAt, now);
    const score = relevanceScore + recencyBoost;
    return {
      path: entry.path,
      startLine: entry.startLine,
      endLine: entry.endLine,
      score,
      snippet: entry.snippet,
      source: entry.source,
      updatedAt: entry.updatedAt,
    };
  });

  return merged.toSorted((a, b) => b.score - a.score);
}
