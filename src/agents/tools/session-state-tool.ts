import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { readStringParam } from "./common.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import type { OpenClawConfig } from "../../config/config.js";
import { getState, setState, deleteState, listState } from "../../state/session-state-store.js";

const SessionStateToolSchema = Type.Object({
  action: Type.Union(
    [
      Type.Literal("get"),
      Type.Literal("set"),
      Type.Literal("delete"),
      Type.Literal("list"),
    ],
    { description: "Action to perform: get, set, delete, or list." },
  ),
  key: Type.Optional(Type.String({ description: "Key name (required for get/set/delete)." })),
  value: Type.Optional(Type.String({ description: "Value to store (required for set). Max 500 chars." })),
});

export function createSessionStateTool(opts?: {
  agentSessionKey?: string;
  config?: OpenClawConfig;
}): AnyAgentTool {
  return {
    label: "Session State",
    name: "session_state",
    description:
      "Read or write persistent session state (survives across sessions). " +
      "Use for tracking active projects, pending tasks, and working context.",
    parameters: SessionStateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });
      const agentId = resolveSessionAgentId({
        sessionKey: opts?.agentSessionKey,
        config: opts?.config,
      });

      switch (action) {
        case "get": {
          const key = readStringParam(params, "key", { required: true });
          const value = await getState(agentId, key);
          if (value === undefined) {
            return { content: [{ type: "text", text: `Key "${key}" not found.` }] };
          }
          return {
            content: [
              { type: "text", text: typeof value === "string" ? value : JSON.stringify(value) },
            ],
          };
        }
        case "set": {
          const key = readStringParam(params, "key", { required: true });
          const value = readStringParam(params, "value", { required: true });
          await setState(agentId, key, value);
          return { content: [{ type: "text", text: `Set "${key}" successfully.` }] };
        }
        case "delete": {
          const key = readStringParam(params, "key", { required: true });
          const deleted = await deleteState(agentId, key);
          return {
            content: [
              {
                type: "text",
                text: deleted ? `Deleted "${key}".` : `Key "${key}" not found.`,
              },
            ],
          };
        }
        case "list": {
          const data = await listState(agentId);
          const entries = Object.entries(data);
          if (entries.length === 0) {
            return { content: [{ type: "text", text: "No session state stored." }] };
          }
          const lines = entries.map(
            ([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`,
          );
          return { content: [{ type: "text", text: lines.join("\n") }] };
        }
        default:
          return {
            content: [{ type: "text", text: `Unknown action "${action}". Use get, set, delete, or list.` }],
          };
      }
    },
  };
}
