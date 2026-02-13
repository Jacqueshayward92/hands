import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

const MAX_KEYS = 20;
const MAX_VALUE_CHARS = 500;
const MAX_FILE_BYTES = 10_240;

type StateData = Record<string, unknown>;

function resolveStateFile(agentId: string): string {
  const dir = path.join(resolveStateDir(), "session-state");
  return path.join(dir, `${agentId}.json`);
}

async function readStateFile(agentId: string): Promise<StateData> {
  try {
    const raw = await fs.readFile(resolveStateFile(agentId), "utf-8");
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as StateData)
      : {};
  } catch {
    return {};
  }
}

async function writeStateFile(agentId: string, data: StateData): Promise<void> {
  const filePath = resolveStateFile(agentId);
  const json = JSON.stringify(data, null, 2);
  if (Buffer.byteLength(json, "utf-8") > MAX_FILE_BYTES) {
    throw new Error(`State file would exceed ${MAX_FILE_BYTES} bytes limit.`);
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, json, "utf-8");
}

export async function getState(agentId: string, key: string): Promise<unknown | undefined> {
  const data = await readStateFile(agentId);
  return data[key];
}

export async function setState(agentId: string, key: string, value: string): Promise<void> {
  if (typeof value === "string" && value.length > MAX_VALUE_CHARS) {
    throw new Error(`Value exceeds ${MAX_VALUE_CHARS} character limit.`);
  }
  const data = await readStateFile(agentId);
  if (!(key in data) && Object.keys(data).length >= MAX_KEYS) {
    throw new Error(`Maximum ${MAX_KEYS} keys reached. Delete a key first.`);
  }
  data[key] = value;
  await writeStateFile(agentId, data);
}

export async function deleteState(agentId: string, key: string): Promise<boolean> {
  const data = await readStateFile(agentId);
  if (!(key in data)) {
    return false;
  }
  delete data[key];
  await writeStateFile(agentId, data);
  return true;
}

export async function listState(agentId: string): Promise<StateData> {
  return readStateFile(agentId);
}

/**
 * Read the raw state file content for context injection.
 * Returns null if no state file exists or it's empty.
 */
export async function readStateForInjection(agentId: string): Promise<string | null> {
  const data = await readStateFile(agentId);
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return null;
  }
  const lines = entries.map(
    ([k, v]) => `- **${k}:** ${typeof v === "string" ? v : JSON.stringify(v)}`,
  );
  return `## Active Session State\n${lines.join("\n")}`;
}
