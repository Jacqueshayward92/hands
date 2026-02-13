import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { CorrectionCategory } from "./correction-detector.js";

export type CorrectionEntry = {
  id: string;
  timestamp: number;
  context: string; // what the user originally asked
  agentSaid: string; // what the agent responded (truncated)
  correctionText: string; // the user's correction message
  rule: string; // extracted rule: "Always X" or "Never Y"
  category: CorrectionCategory;
  confidence: number;
  accessCount: number;
  lastAccessed?: number;
};

function resolveCorrectionsDir(): string {
  const home = os.homedir();
  return path.join(home, ".hands", "corrections");
}

async function getStorePath(agentId: string): Promise<string> {
  const dir = resolveCorrectionsDir();
  await fs.mkdir(dir, { recursive: true });
  const safeId = agentId.replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
  return path.join(dir, `${safeId}.json`);
}

async function readStore(agentId: string): Promise<CorrectionEntry[]> {
  try {
    const p = await getStorePath(agentId);
    const raw = await fs.readFile(p, "utf-8");
    return JSON.parse(raw) as CorrectionEntry[];
  } catch {
    return [];
  }
}

async function writeStore(agentId: string, entries: CorrectionEntry[]): Promise<void> {
  const p = await getStorePath(agentId);
  await fs.writeFile(p, JSON.stringify(entries, null, 2), "utf-8");
}

export async function addCorrection(
  agentId: string,
  entry: Omit<CorrectionEntry, "id" | "accessCount">,
): Promise<CorrectionEntry> {
  const list = await readStore(agentId);
  const newEntry: CorrectionEntry = {
    ...entry,
    id: randomUUID(),
    accessCount: 0,
  };
  list.unshift(newEntry);

  // Prune if over limit — remove oldest low-access entries
  if (list.length > 500) {
    list.sort((a, b) => {
      // Keep high-access corrections, prune old unused ones
      if (a.accessCount !== b.accessCount) return b.accessCount - a.accessCount;
      return b.timestamp - a.timestamp;
    });
    list.length = 500;
  }

  await writeStore(agentId, list);
  return newEntry;
}

export async function getCorrections(agentId: string): Promise<CorrectionEntry[]> {
  return readStore(agentId);
}

export async function pruneCorrections(
  agentId: string,
  maxEntries = 500,
): Promise<number> {
  const list = await readStore(agentId);
  if (list.length <= maxEntries) return 0;
  const pruned = list.length - maxEntries;
  list.length = maxEntries;
  await writeStore(agentId, list);
  return pruned;
}

/**
 * Search corrections by keyword overlap with the incoming message.
 * Returns top matches sorted by relevance.
 */
export async function searchCorrections(
  agentId: string,
  terms: string[],
): Promise<CorrectionEntry[]> {
  if (!terms || terms.length === 0) return [];
  const all = await readStore(agentId);
  if (all.length === 0) return [];

  const lowerTerms = terms.map((t) => t.toLowerCase());

  const scored = all.map((c) => {
    const text = `${c.context} ${c.rule} ${c.correctionText} ${c.category}`.toLowerCase();
    let score = 0;
    for (const term of lowerTerms) {
      if (text.includes(term)) score++;
    }
    return { entry: c, score };
  });

  const matches = scored
    .filter((s) => s.score >= 2) // require 2+ term overlaps
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => {
      // Increment access count
      s.entry.accessCount++;
      s.entry.lastAccessed = Date.now();
      return s.entry;
    });

  // Persist access count updates
  if (matches.length > 0) {
    await writeStore(agentId, all);
  }

  return matches;
}
