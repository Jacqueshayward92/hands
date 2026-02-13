/**
 * Proactive Triggers Engine — Event-driven wake for the agent
 *
 * Instead of being purely reactive (only responding when triggered),
 * this module detects conditions that should prompt the agent to act.
 *
 * Runs as a lightweight check during heartbeats and can also be
 * evaluated independently. Each trigger is a simple condition → message pair.
 *
 * Trigger types:
 * 1. Task deadline approaching — tasks from the ledger nearing their due date
 * 2. Stale tasks — tasks that haven't been updated in a long time
 * 3. Repeated failures — same tool failing repeatedly (from failure store)
 * 4. Sub-agent stuck — sub-agent running for too long
 * 5. File change detection — key workspace files modified externally
 *
 * Returns trigger messages that should be injected into the agent's context
 * so it can decide whether to act on them.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveStateDir } from "../config/paths.js";

const log = createSubsystemLogger("proactive-triggers");

// =========================================================================
// Types
// =========================================================================

export type Trigger = {
  type: "deadline" | "stale_task" | "repeated_failure" | "stuck_subagent" | "file_change";
  priority: "high" | "medium" | "low";
  message: string;
  /** When this trigger was first detected */
  detectedAt: string;
};

type TriggerState = {
  version: 1;
  /** Last time each file was seen (for change detection) */
  fileChecksums: Record<string, { size: number; mtimeMs: number }>;
  /** Triggers that have been fired (to avoid repeating) */
  firedTriggers: Record<string, number>; // triggerKey → timestamp
  lastRun: number;
};

// =========================================================================
// Constants
// =========================================================================

const STALE_TASK_HOURS = 72; // Alert if a task hasn't been updated in 3 days
const STUCK_SUBAGENT_MINUTES = 30; // Alert if a sub-agent runs for 30+ minutes
const REPEATED_FAILURE_THRESHOLD = 3; // Alert after 3+ occurrences of same failure
const TRIGGER_COOLDOWN_MS = 4 * 60 * 60 * 1000; // Don't re-fire same trigger for 4 hours
const MAX_TRIGGERS_PER_CHECK = 5;

// Key files to watch for external changes
const WATCHED_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
  "HEARTBEAT.md",
];

// =========================================================================
// State persistence
// =========================================================================

function resolveStateFile(): string {
  return path.join(resolveStateDir(), "proactive-triggers.json");
}

async function readState(): Promise<TriggerState> {
  try {
    const raw = await fs.readFile(resolveStateFile(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1) return parsed as TriggerState;
  } catch { /* fresh state */ }
  return { version: 1, fileChecksums: {}, firedTriggers: {}, lastRun: 0 };
}

async function writeState(state: TriggerState): Promise<void> {
  const filePath = resolveStateFile();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

function hasFiredRecently(state: TriggerState, key: string): boolean {
  const lastFired = state.firedTriggers[key];
  if (!lastFired) return false;
  return Date.now() - lastFired < TRIGGER_COOLDOWN_MS;
}

function markFired(state: TriggerState, key: string): void {
  state.firedTriggers[key] = Date.now();
  // Prune old entries
  const now = Date.now();
  for (const [k, v] of Object.entries(state.firedTriggers)) {
    if (now - v > TRIGGER_COOLDOWN_MS * 2) {
      delete state.firedTriggers[k];
    }
  }
}

// =========================================================================
// Individual trigger checks
// =========================================================================

/** Check task ledger for stale tasks */
async function checkStaleTasks(agentId: string): Promise<Trigger[]> {
  const triggers: Trigger[] = [];
  try {
    const filePath = path.join(resolveStateDir(), "task-ledger", `${agentId}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (!data?.tasks || !Array.isArray(data.tasks)) return triggers;

    const now = Date.now();
    const staleMs = STALE_TASK_HOURS * 60 * 60 * 1000;

    for (const task of data.tasks) {
      if (task.status === "completed" || task.status === "cancelled") continue;
      const updatedAt = task.updatedAt ? new Date(task.updatedAt).getTime() : 0;
      if (updatedAt > 0 && now - updatedAt > staleMs) {
        const daysStale = Math.floor((now - updatedAt) / (24 * 60 * 60 * 1000));
        triggers.push({
          type: "stale_task",
          priority: task.priority === "high" || task.priority === "critical" ? "high" : "medium",
          message: `Task "${task.title}" hasn't been updated in ${daysStale} days (status: ${task.status}). Should this be completed, updated, or cancelled?`,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  } catch { /* no ledger */ }
  return triggers;
}

/** Check tool failure store for patterns that keep repeating */
async function checkRepeatedFailures(agentId: string): Promise<Trigger[]> {
  const triggers: Trigger[] = [];
  try {
    const filePath = path.join(resolveStateDir(), "tool-failures", `${agentId}.json`);
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (!data?.failures || !Array.isArray(data.failures)) return triggers;

    for (const failure of data.failures) {
      if (failure.count >= REPEATED_FAILURE_THRESHOLD) {
        triggers.push({
          type: "repeated_failure",
          priority: failure.count >= 10 ? "high" : "medium",
          message: `Tool "${failure.toolName}" has failed ${failure.count} times with ${failure.category} errors. Consider a permanent fix: ${failure.lesson}`,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  } catch { /* no failure store */ }
  return triggers;
}

/** Check for key workspace files that changed externally */
async function checkFileChanges(workspaceDir: string, state: TriggerState): Promise<Trigger[]> {
  const triggers: Trigger[] = [];

  for (const file of WATCHED_FILES) {
    const filePath = path.join(workspaceDir, file);
    try {
      const stat = await fs.stat(filePath);
      const prev = state.fileChecksums[file];
      if (prev && (stat.size !== prev.size || Math.abs(stat.mtimeMs - prev.mtimeMs) > 1000)) {
        triggers.push({
          type: "file_change",
          priority: "low",
          message: `${file} was modified externally. You may want to re-read it for updated instructions.`,
          detectedAt: new Date().toISOString(),
        });
      }
      state.fileChecksums[file] = { size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      // File doesn't exist — remove from tracking
      delete state.fileChecksums[file];
    }
  }

  return triggers;
}

// =========================================================================
// Main entry point
// =========================================================================

/**
 * Evaluate all proactive triggers and return messages for the agent.
 * Called during heartbeat processing or on-demand.
 *
 * Returns an array of trigger messages, limited to MAX_TRIGGERS_PER_CHECK.
 * Each trigger is only fired once per cooldown period (4 hours).
 */
export async function evaluateProactiveTriggers(params: {
  agentId: string;
  workspaceDir: string;
  /** Active sub-agent runs (from subagent registry) */
  subagentRuns?: Array<{ runId: string; task: string; startedAt?: number; endedAt?: number }>;
}): Promise<{ triggers: Trigger[]; injectionText: string | null }> {
  try {
    const state = await readState();
    const allTriggers: Trigger[] = [];

    // 1. Check stale tasks
    allTriggers.push(...await checkStaleTasks(params.agentId));

    // 2. Check repeated failures
    allTriggers.push(...await checkRepeatedFailures(params.agentId));

    // 3. Check file changes
    allTriggers.push(...await checkFileChanges(params.workspaceDir, state));

    // 4. Check stuck sub-agents
    if (params.subagentRuns) {
      const now = Date.now();
      const stuckMs = STUCK_SUBAGENT_MINUTES * 60 * 1000;
      for (const run of params.subagentRuns) {
        if (run.endedAt) continue; // Already finished
        if (run.startedAt && now - run.startedAt > stuckMs) {
          const minutes = Math.floor((now - run.startedAt) / 60000);
          allTriggers.push({
            type: "stuck_subagent",
            priority: "high",
            message: `Sub-agent "${run.task.slice(0, 80)}" has been running for ${minutes} minutes. It may be stuck.`,
            detectedAt: new Date().toISOString(),
          });
        }
      }
    }

    // Filter out recently fired triggers
    const newTriggers = allTriggers.filter(t => {
      const key = `${t.type}:${t.message.slice(0, 80)}`;
      return !hasFiredRecently(state, key);
    });

    // Sort by priority (high first) and limit
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    const sorted = newTriggers
      .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
      .slice(0, MAX_TRIGGERS_PER_CHECK);

    // Mark as fired
    for (const trigger of sorted) {
      const key = `${trigger.type}:${trigger.message.slice(0, 80)}`;
      markFired(state, key);
    }

    state.lastRun = Date.now();
    await writeState(state);

    // Build injection text
    if (sorted.length === 0) {
      return { triggers: [], injectionText: null };
    }

    const lines: string[] = [
      "## ⚡ Proactive Alerts",
      "These conditions were detected automatically. Act on them if appropriate.",
      "",
    ];
    for (const t of sorted) {
      const icon = t.priority === "high" ? "🔴" : t.priority === "medium" ? "🟡" : "🟢";
      lines.push(`${icon} **${t.type}**: ${t.message}`);
    }

    return { triggers: sorted, injectionText: lines.join("\n") };
  } catch (err) {
    log.warn(`proactive triggers evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
    return { triggers: [], injectionText: null };
  }
}
