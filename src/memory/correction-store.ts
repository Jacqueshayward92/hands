import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

export type CorrectionEntry = {
  id: string;
  timestamp: number;
  context: string;
  agentSaid: string;
  correctionText: string;
  rule: string;
  category: 'factual' | 'behavioral' | 'preference' | 'procedural';
  confidence: number;
  embedding?: number[];
  accessCount: number;
  lastAccessed?: number;
};

function getStorePath(agentId: string): string {
  const base = require('../config/paths.js').resolveStateDir();
  const dir = path.join(base, 'corrections');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, agentId + '.json');
}

function readStore(agentId: string): CorrectionEntry[] {
  const p = getStorePath(agentId);
  if (!fs.existsSync(p)) return [];
  try {
    const data = fs.readFileSync(p, 'utf8');
    const json = JSON.parse(data);
    if (Array.isArray(json)) return json;
    return [];
  } catch {
    return [];
  }
}

function writeStore(agentId: string, entries: CorrectionEntry[]) {
  const p = getStorePath(agentId);
  fs.writeFileSync(p, JSON.stringify(entries, null, 2), 'utf8');
}

export async function addCorrection(agentId: string, entry: Omit<CorrectionEntry, 'id' | 'timestamp' | 'accessCount'>): Promise<void> {
  const now = Date.now();
  const all = readStore(agentId);
  const newEntry: CorrectionEntry = {
    id: randomUUID(),
    timestamp: now,
    accessCount: 0,
    ...entry,
  };
  all.push(newEntry);
  // prune if needed
  await pruneCorrections(agentId);
  writeStore(agentId, all);
}

export async function getCorrections(agentId: string): Promise<CorrectionEntry[]> {
  return readStore(agentId);
}

export async function pruneCorrections(agentId: string, maxEntries: number = 500): Promise<number> {
  const entries = readStore(agentId);
  if (entries.length <= maxEntries) return 0;
  // sort by lastAccessed or timestamp to prune oldest
  entries.sort((a, b) => {
    const ta = a.lastAccessed ?? a.timestamp;
    const tb = b.lastAccessed ?? b.timestamp;
    return ta - tb;
  });
  const trimmed = entries.slice(entries.length - maxEntries);
  writeStore(agentId, trimmed);
  return entries.length - trimmed.length;
}

export async function readCorrectionsForInjection(agentId: string): Promise<string> {
  const entries = await getCorrections(agentId);
  if (!entries.length) return '';
  const parts = entries.map(e => `[${e.category}] ${e.rule} (confidence:${e.confidence.toFixed(2)}) - ${e.context.substring(0, 120)}`);
  return 'Learned Corrections:\n' + parts.join('\n');
}
