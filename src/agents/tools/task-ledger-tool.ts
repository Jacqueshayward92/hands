/**
 * Task Ledger Tool — Agent-facing interface for persistent task tracking.
 *
 * Actions: create, update, complete, list, get, delete
 *
 * The task ledger persists across sessions and compactions. Active tasks
 * are auto-injected into context, so the agent always knows what it's working on.
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import type { HandsConfig } from "../../config/config.js";
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  deleteTask,
  type TaskStatus,
  type TaskPriority,
} from "../../state/task-ledger.js";

const TaskLedgerToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("create"),
      Type.Literal("update"),
      Type.Literal("complete"),
      Type.Literal("list"),
      Type.Literal("get"),
      Type.Literal("delete"),
    ],
    {
      description:
        "Action: create (new task), update (modify task), complete (mark done), list (show tasks), get (task detail), delete (remove task).",
    },
  ),
  id: Type.Optional(
    Type.String({ description: "Task ID (required for update/complete/get/delete)." }),
  ),
  title: Type.Optional(Type.String({ description: "Task title (required for create)." })),
  context: Type.Optional(
    Type.String({ description: "Task context/description. Max 2000 chars." }),
  ),
  nextAction: Type.Optional(
    Type.String({ description: "The next concrete action to take on this task." }),
  ),
  status: Type.Optional(
    Type.String({
      description: "Task status: active, blocked, waiting, done, cancelled.",
    }),
  ),
  priority: Type.Optional(
    Type.String({ description: "Priority: critical, high, normal, low." }),
  ),
  blocker: Type.Optional(Type.String({ description: "What is blocking this task." })),
  waitingFor: Type.Optional(Type.String({ description: "What we are waiting for." })),
  tags: Type.Optional(Type.String({ description: "Comma-separated tags." })),
  filter: Type.Optional(
    Type.String({
      description: "Filter for list: status name (active/blocked/waiting/done) or tag name.",
    }),
  ),
});

function formatTask(task: {
  id: string;
  title: string;
  status: string;
  priority: string;
  context?: string;
  nextAction?: string;
  blocker?: string;
  waitingFor?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}): string {
  const lines = [
    `ID: ${task.id}`,
    `Title: ${task.title}`,
    `Status: ${task.status}`,
    `Priority: ${task.priority}`,
  ];
  if (task.context) lines.push(`Context: ${task.context}`);
  if (task.nextAction) lines.push(`Next action: ${task.nextAction}`);
  if (task.blocker) lines.push(`Blocked by: ${task.blocker}`);
  if (task.waitingFor) lines.push(`Waiting for: ${task.waitingFor}`);
  if (task.tags?.length) lines.push(`Tags: ${task.tags.join(", ")}`);
  lines.push(`Created: ${task.createdAt.slice(0, 16)}`);
  lines.push(`Updated: ${task.updatedAt.slice(0, 16)}`);
  if (task.completedAt) lines.push(`Completed: ${task.completedAt.slice(0, 16)}`);
  return lines.join("\n");
}

const VALID_STATUSES = new Set(["active", "blocked", "waiting", "done", "cancelled"]);
const VALID_PRIORITIES = new Set(["critical", "high", "normal", "low"]);

export function createTaskLedgerTool(opts?: {
  agentSessionKey?: string;
  config?: HandsConfig;
}): AnyAgentTool {
  return {
    label: "Task Ledger",
    name: "task_ledger",
    description:
      "Persistent task/goal tracker that survives across sessions. " +
      "Use to track what you're working on, what's blocked, what's next. " +
      "Active tasks are auto-injected into your context every session.",
    parameters: TaskLedgerToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const agentId = resolveSessionAgentId({
        sessionKey: opts?.agentSessionKey,
        config: opts?.config,
      });

      try {
        switch (action) {
          case "create": {
            const title = readStringParam(params, "title", { required: true });
            const context = readStringParam(params, "context");
            const nextAction = readStringParam(params, "nextAction");
            const priorityRaw = readStringParam(params, "priority");
            const tagsRaw = readStringParam(params, "tags");
            const priority = (
              priorityRaw && VALID_PRIORITIES.has(priorityRaw) ? priorityRaw : "normal"
            ) as TaskPriority;
            const tags = tagsRaw
              ? tagsRaw
                  .split(",")
                  .map((t) => t.trim())
                  .filter(Boolean)
              : undefined;
            const task = await createTask(agentId, {
              title,
              context: context ?? undefined,
              priority,
              nextAction: nextAction ?? undefined,
              tags,
            });
            return {
              content: [{ type: "text", text: `Task created:\n${formatTask(task)}` }],
            };
          }

          case "update": {
            const id = readStringParam(params, "id", { required: true });
            const updates: Record<string, unknown> = {};
            const title = readStringParam(params, "title");
            const context = readStringParam(params, "context");
            const nextAction = readStringParam(params, "nextAction");
            const statusRaw = readStringParam(params, "status");
            const priorityRaw = readStringParam(params, "priority");
            const blocker = readStringParam(params, "blocker");
            const waitingFor = readStringParam(params, "waitingFor");
            const tagsRaw = readStringParam(params, "tags");

            if (title) updates.title = title;
            if (context) updates.context = context;
            if (nextAction) updates.nextAction = nextAction;
            if (statusRaw && VALID_STATUSES.has(statusRaw))
              updates.status = statusRaw as TaskStatus;
            if (priorityRaw && VALID_PRIORITIES.has(priorityRaw))
              updates.priority = priorityRaw as TaskPriority;
            if (blocker) updates.blocker = blocker;
            if (waitingFor) updates.waitingFor = waitingFor;
            if (tagsRaw)
              updates.tags = tagsRaw
                .split(",")
                .map((t) => t.trim())
                .filter(Boolean);

            const task = await updateTask(agentId, id, updates);
            if (!task) {
              return { content: [{ type: "text", text: `Task "${id}" not found.` }] };
            }
            return {
              content: [{ type: "text", text: `Task updated:\n${formatTask(task)}` }],
            };
          }

          case "complete": {
            const id = readStringParam(params, "id", { required: true });
            const task = await updateTask(agentId, id, { status: "done" });
            if (!task) {
              return { content: [{ type: "text", text: `Task "${id}" not found.` }] };
            }
            return {
              content: [{ type: "text", text: `Task completed:\n${formatTask(task)}` }],
            };
          }

          case "list": {
            const filterRaw = readStringParam(params, "filter");
            let filter: { status?: TaskStatus; tag?: string } | undefined;
            if (filterRaw) {
              if (VALID_STATUSES.has(filterRaw)) {
                filter = { status: filterRaw as TaskStatus };
              } else {
                filter = { tag: filterRaw };
              }
            }
            const tasks = await listTasks(agentId, filter);
            if (tasks.length === 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: filter
                      ? `No tasks matching filter "${filterRaw}".`
                      : "No tasks in ledger.",
                  },
                ],
              };
            }
            const summary = tasks
              .map(
                (t) =>
                  `[${t.id}] ${t.status === "done" ? "✅" : t.status === "blocked" ? "🔴" : t.status === "waiting" ? "⏳" : "🔵"} ${t.title} (${t.priority}, ${t.status})`,
              )
              .join("\n");
            return {
              content: [{ type: "text", text: `Tasks (${tasks.length}):\n${summary}` }],
            };
          }

          case "get": {
            const id = readStringParam(params, "id", { required: true });
            const task = await getTask(agentId, id);
            if (!task) {
              return { content: [{ type: "text", text: `Task "${id}" not found.` }] };
            }
            return { content: [{ type: "text", text: formatTask(task) }] };
          }

          case "delete": {
            const id = readStringParam(params, "id", { required: true });
            const deleted = await deleteTask(agentId, id);
            return {
              content: [
                {
                  type: "text",
                  text: deleted ? `Task "${id}" deleted.` : `Task "${id}" not found.`,
                },
              ],
            };
          }

          default:
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown action "${action}". Use: create, update, complete, list, get, delete.`,
                },
              ],
            };
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Task ledger error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    },
  };
}
