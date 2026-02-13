/**
 * Task Ledger — Persistent Task/Goal Tracking
 *
 * Platform-level task persistence that survives across sessions and compactions.
 * Active tasks are auto-injected into every context window so the agent always
 * knows what it's working on, what's blocked, and what's next.
 *
 * This is the system-level fix for "agent forgets what it was doing."
 * A human assistant has a to-do list. Now the agent does too.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { resolveStateDir } from "../config/paths.js";

// =========================================================================
// Types
// =========================================================================

export type TaskStatus = "active" | "blocked" | "waiting" | "done" | "cancelled";

export type TaskPriority = "critical" | "high" | "normal" | "low";

export type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** What this task is about — the full context */
  context: string;
  /** The next concrete action to take */
  nextAction?: string;
  /** Why this task is blocked (if status=blocked) */
  blocker?: string;
  /** What we're waiting for (if status=waiting) */
  waitingFor?: string;
  /** Parent task ID for subtasks */
  parentId?: string;
  /** Tags for categorization */
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
};

export type TaskLedgerData = {
  version: 1;
  tasks: Task[];
};

// =========================================================================
// Constants
// =========================================================================

const MAX_TASKS = 100;
const MAX_ACTIVE_TASKS = 25;
const MAX_CONTEXT_CHARS = 2000;
const MAX_TITLE_CHARS = 200;

// =========================================================================
// File I/O
// =========================================================================

function resolveLedgerFile(agentId: string): string {
  const dir = path.join(resolveStateDir(), "task-ledger");
  return path.join(dir, `${agentId}.json`);
}

async function readLedger(agentId: string): Promise<TaskLedgerData> {
  try {
    const raw = await fs.readFile(resolveLedgerFile(agentId), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1 && Array.isArray(parsed.tasks)) {
      return parsed as TaskLedgerData;
    }
    return { version: 1, tasks: [] };
  } catch {
    return { version: 1, tasks: [] };
  }
}

async function writeLedger(agentId: string, data: TaskLedgerData): Promise<void> {
  const filePath = resolveLedgerFile(agentId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
}

// =========================================================================
// CRUD Operations
// =========================================================================

export async function createTask(
  agentId: string,
  params: {
    title: string;
    context?: string;
    priority?: TaskPriority;
    nextAction?: string;
    parentId?: string;
    tags?: string[];
  },
): Promise<Task> {
  const ledger = await readLedger(agentId);

  // Enforce limits
  const activeTasks = ledger.tasks.filter(
    (t) => t.status === "active" || t.status === "blocked" || t.status === "waiting",
  );
  if (activeTasks.length >= MAX_ACTIVE_TASKS) {
    throw new Error(
      `Maximum ${MAX_ACTIVE_TASKS} active tasks reached. Complete or cancel existing tasks first.`,
    );
  }
  if (ledger.tasks.length >= MAX_TASKS) {
    // Auto-prune oldest completed/cancelled tasks
    const pruneable = ledger.tasks
      .filter((t) => t.status === "done" || t.status === "cancelled")
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    if (pruneable.length > 0) {
      const toRemove = new Set(pruneable.slice(0, 10).map((t) => t.id));
      ledger.tasks = ledger.tasks.filter((t) => !toRemove.has(t.id));
    }
  }

  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID().slice(0, 8),
    title: (params.title ?? "").slice(0, MAX_TITLE_CHARS),
    status: "active",
    priority: params.priority ?? "normal",
    context: (params.context ?? "").slice(0, MAX_CONTEXT_CHARS),
    nextAction: params.nextAction,
    parentId: params.parentId,
    tags: params.tags,
    createdAt: now,
    updatedAt: now,
  };

  ledger.tasks.push(task);
  await writeLedger(agentId, ledger);
  return task;
}

export async function updateTask(
  agentId: string,
  taskId: string,
  updates: Partial<Pick<Task, "title" | "status" | "priority" | "context" | "nextAction" | "blocker" | "waitingFor" | "tags">>,
): Promise<Task | null> {
  const ledger = await readLedger(agentId);
  const task = ledger.tasks.find((t) => t.id === taskId);
  if (!task) return null;

  const now = new Date().toISOString();

  if (updates.title !== undefined) task.title = updates.title.slice(0, MAX_TITLE_CHARS);
  if (updates.status !== undefined) {
    task.status = updates.status;
    if (updates.status === "done" || updates.status === "cancelled") {
      task.completedAt = now;
    }
  }
  if (updates.priority !== undefined) task.priority = updates.priority;
  if (updates.context !== undefined) task.context = updates.context.slice(0, MAX_CONTEXT_CHARS);
  if (updates.nextAction !== undefined) task.nextAction = updates.nextAction;
  if (updates.blocker !== undefined) task.blocker = updates.blocker;
  if (updates.waitingFor !== undefined) task.waitingFor = updates.waitingFor;
  if (updates.tags !== undefined) task.tags = updates.tags;
  task.updatedAt = now;

  await writeLedger(agentId, ledger);
  return task;
}

export async function getTask(agentId: string, taskId: string): Promise<Task | null> {
  const ledger = await readLedger(agentId);
  return ledger.tasks.find((t) => t.id === taskId) ?? null;
}

export async function listTasks(
  agentId: string,
  filter?: { status?: TaskStatus; tag?: string },
): Promise<Task[]> {
  const ledger = await readLedger(agentId);
  let tasks = ledger.tasks;
  if (filter?.status) {
    tasks = tasks.filter((t) => t.status === filter.status);
  }
  if (filter?.tag) {
    tasks = tasks.filter((t) => t.tags?.includes(filter.tag!));
  }
  return tasks;
}

export async function deleteTask(agentId: string, taskId: string): Promise<boolean> {
  const ledger = await readLedger(agentId);
  const before = ledger.tasks.length;
  ledger.tasks = ledger.tasks.filter((t) => t.id !== taskId);
  if (ledger.tasks.length === before) return false;
  await writeLedger(agentId, ledger);
  return true;
}

// =========================================================================
// Context Injection
// =========================================================================

const PRIORITY_ORDER: Record<TaskPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const STATUS_EMOJI: Record<TaskStatus, string> = {
  active: "🔵",
  blocked: "🔴",
  waiting: "⏳",
  done: "✅",
  cancelled: "❌",
};

/**
 * Build a context injection string for active tasks.
 * Returns null if no active tasks exist.
 *
 * This gets auto-injected into the system prompt so the agent
 * ALWAYS knows what it's working on.
 */
export async function readTasksForInjection(agentId: string): Promise<string | null> {
  const ledger = await readLedger(agentId);

  // Only inject non-terminal tasks
  const activeTasks = ledger.tasks
    .filter((t) => t.status === "active" || t.status === "blocked" || t.status === "waiting")
    .sort((a, b) => {
      // Sort by priority first, then by update time (most recent first)
      const pDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pDiff !== 0) return pDiff;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  if (activeTasks.length === 0) return null;

  const lines: string[] = [
    "## 📋 Active Tasks (Task Ledger)",
    "These are your current tasks. Update them as you make progress. Complete them when done.",
    "",
  ];

  for (const task of activeTasks) {
    const emoji = STATUS_EMOJI[task.status];
    const priority = task.priority !== "normal" ? ` [${task.priority.toUpperCase()}]` : "";
    lines.push(`### ${emoji} ${task.title}${priority}`);
    lines.push(`ID: \`${task.id}\` | Status: ${task.status} | Updated: ${task.updatedAt.slice(0, 10)}`);
    if (task.context) lines.push(`Context: ${task.context}`);
    if (task.nextAction) lines.push(`**Next action:** ${task.nextAction}`);
    if (task.blocker) lines.push(`**Blocked by:** ${task.blocker}`);
    if (task.waitingFor) lines.push(`**Waiting for:** ${task.waitingFor}`);
    if (task.tags?.length) lines.push(`Tags: ${task.tags.join(", ")}`);
    lines.push("");
  }

  // Show recent completions (last 5, from past 7 days) for continuity
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentDone = ledger.tasks
    .filter(
      (t) =>
        t.status === "done" &&
        t.completedAt &&
        t.completedAt > sevenDaysAgo,
    )
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 5);

  if (recentDone.length > 0) {
    lines.push("### Recently Completed");
    for (const task of recentDone) {
      lines.push(`- ✅ ${task.title} (${task.completedAt?.slice(0, 10)})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
