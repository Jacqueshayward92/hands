import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';

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

const baseDir = path.join(process.env["HOME"] || process.env["USERPROFILE"] || "", ".openclaw", "corrections");

async function ensureDir(p:string){
  await fs.promises.mkdir(p,{recursive:true}).catch(()=>{});
}
async function getPath(agentId:string){
  await ensureDir(baseDir);
  return path.join(baseDir, `${agentId}.json`);
}
export async function addCorrection(agentId:string, entry: Omit<CorrectionEntry,'id'>): Promise<void> {
  const p = await getPath(agentId);
  let list: CorrectionEntry[] = [];
  try{ const raw = await fs.promises.readFile(p,'utf8'); list = JSON.parse(raw);}catch{}
  const newEntry: CorrectionEntry = { id: uuid(), accessCount: 0, ...entry } as CorrectionEntry;
  list.unshift(newEntry);
  // prune
  if (list.length>500) list = list.slice(0,500);
  await fs.promises.writeFile(p, JSON.stringify(list,null,2));
}
export async function getCorrections(agentId:string): Promise<CorrectionEntry[]> {
  const p = await getPath(agentId);
  try{
    const raw = await fs.promises.readFile(p,'utf8');
    return JSON.parse(raw) as CorrectionEntry[];
  }catch{ return []; }
}
export async function pruneCorrections(agentId:string, maxEntries=500): Promise<number> {
  const list = await getCorrections(agentId);
  if (list.length<=maxEntries) return 0;
  const trimmed = list.slice(0,maxEntries);
  const p = await getPath(agentId);
  await fs.promises.writeFile(p, JSON.stringify(trimmed,null,2));
  return list.length - maxEntries;
}

export async function searchCorrections(agentId: string, terms: string[]): Promise<CorrectionEntry[]> {
  const all = await getCorrections(agentId);
  if (!terms || terms.length === 0) return [];
  
  // Simple scoring: count term overlaps
  const scored = all.map(c => {
    const text = (c.context + " " + c.rule + " " + c.correctionText).toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (text.includes(term)) score++;
    }
    return { entry: c, score };
  });

  // Filter for ANY match (score > 0) and sort desc
  // Return top 5 relevant corrections
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(s => s.entry);
}
