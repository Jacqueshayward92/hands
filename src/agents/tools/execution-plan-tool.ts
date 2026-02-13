/**
 * Execution Plan Tool — Declare multi-step plans that survive compaction
 *
 * When the agent recognizes it needs multiple steps, it can declare a plan.
 * The plan is persisted to the session state and injected into context
 * after compaction, so the agent always knows where it is in the workflow.
 *
 * This enables:
 * 1. Plan persistence across compaction (agent doesn't lose its place)
 * 2. Progress tracking (which steps are done, which remain)
 * 3. Better task anchor quality (explicit plan > heuristic extraction)
 *
 * The tool has two modes:
 * - "create": Declare a new plan with ordered steps
 * - "update": Mark steps as done or update the plan
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";

// =========================================================================
// Types
// =========================================================================

type PlanStep = {
  id: number;
  description: string;
  status: "pending" | "in_progress" | "done" | "skipped";
};

type ExecutionPlan = {
  version: 1;
  goal: string;
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
};

// =========================================================================
// Schema
// =========================================================================

const ExecutionPlanToolSchema = Type.Object({
  action: Type.Union([Type.Literal("create"), Type.Literal("update"), Type.Literal("get"), Type.Literal("clear")]),
  /** Goal description (for create) */
  goal: Type.Optional(Type.String()),
  /** Ordered step descriptions (for create) */
  steps: Type.Optional(Type.Array(Type.String())),
  /** Step ID to update (for update) */
  stepId: Type.Optional(Type.Number()),
  /** New status for a step (for update) */
  status: Type.Optional(Type.Union([
    Type.Literal("pending"),
    Type.Literal("in_progress"),
    Type.Literal("done"),
    Type.Literal("skipped"),
  ])),
});

// =========================================================================
// File I/O
// =========================================================================

function resolvePlanFile(sessionKey: string): string {
  const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  return path.join(resolveStateDir(), "execution-plans", `${safe}.json`);
}

async function readPlan(sessionKey: string): Promise<ExecutionPlan | null> {
  try {
    const raw = await fs.readFile(resolvePlanFile(sessionKey), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1) return parsed as ExecutionPlan;
  } catch { /* no plan */ }
  return null;
}

async function writePlan(sessionKey: string, plan: ExecutionPlan): Promise<void> {
  const filePath = resolvePlanFile(sessionKey);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(plan, null, 2), "utf-8");
}

async function deletePlan(sessionKey: string): Promise<void> {
  try { await fs.unlink(resolvePlanFile(sessionKey)); } catch { /* ok */ }
}

// =========================================================================
// Context injection
// =========================================================================

/**
 * Build injection text for the active execution plan.
 * Returns null if no plan exists.
 */
export async function readPlanForInjection(sessionKey: string): Promise<string | null> {
  const plan = await readPlan(sessionKey);
  if (!plan) return null;

  const done = plan.steps.filter(s => s.status === "done").length;
  const total = plan.steps.length;
  const progress = total > 0 ? Math.round(done / total * 100) : 0;

  const lines = [
    `## 📋 Execution Plan (${progress}% complete)`,
    `**Goal:** ${plan.goal}`,
    "",
  ];

  for (const step of plan.steps) {
    const icon = step.status === "done" ? "✅" :
      step.status === "in_progress" ? "🔄" :
        step.status === "skipped" ? "⏭️" : "⬜";
    lines.push(`${icon} ${step.id}. ${step.description}`);
  }

  return lines.join("\n");
}

// =========================================================================
// Tool implementation
// =========================================================================

export function createExecutionPlanTool(params: {
  sessionKey: string;
}): AnyAgentTool {
  return {
    name: "execution_plan",
    description:
      "Declare and track multi-step execution plans. Plans survive compaction so you never lose your place. " +
      "Use 'create' to declare a plan with ordered steps. Use 'update' to mark steps as done. " +
      "Use 'get' to check current plan status. Use 'clear' when the plan is complete.",
    schema: ExecutionPlanToolSchema,
    async call(args: Record<string, unknown>) {
      const action = String(args.action || "get");

      switch (action) {
        case "create": {
          const goal = String(args.goal || "");
          const stepDescs = Array.isArray(args.steps) ? args.steps.map(String) : [];
          if (!goal || stepDescs.length === 0) {
            return jsonResult({ error: "Goal and steps are required for create" });
          }
          const plan: ExecutionPlan = {
            version: 1,
            goal,
            steps: stepDescs.map((desc, i) => ({
              id: i + 1,
              description: desc,
              status: "pending",
            })),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await writePlan(params.sessionKey, plan);
          return jsonResult({
            status: "created",
            goal,
            totalSteps: plan.steps.length,
          });
        }

        case "update": {
          const plan = await readPlan(params.sessionKey);
          if (!plan) return jsonResult({ error: "No active plan. Create one first." });

          const stepId = Number(args.stepId);
          const newStatus = String(args.status || "done");
          const step = plan.steps.find(s => s.id === stepId);
          if (!step) return jsonResult({ error: `Step ${stepId} not found` });

          step.status = newStatus as PlanStep["status"];
          plan.updatedAt = new Date().toISOString();

          // Auto-advance next pending step to in_progress
          if (newStatus === "done") {
            const nextPending = plan.steps.find(s => s.status === "pending");
            if (nextPending) nextPending.status = "in_progress";
          }

          await writePlan(params.sessionKey, plan);
          const done = plan.steps.filter(s => s.status === "done").length;
          return jsonResult({
            status: "updated",
            stepId,
            newStatus,
            progress: `${done}/${plan.steps.length}`,
          });
        }

        case "get": {
          const plan = await readPlan(params.sessionKey);
          if (!plan) return jsonResult({ status: "no_plan" });
          const done = plan.steps.filter(s => s.status === "done").length;
          return jsonResult({
            goal: plan.goal,
            steps: plan.steps,
            progress: `${done}/${plan.steps.length}`,
          });
        }

        case "clear": {
          await deletePlan(params.sessionKey);
          return jsonResult({ status: "cleared" });
        }

        default:
          return jsonResult({ error: `Unknown action: ${action}` });
      }
    },
  };
}
