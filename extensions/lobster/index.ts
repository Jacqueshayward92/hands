import type {
  AnyAgentTool,
  HandsPluginApi,
  HandsPluginToolFactory,
} from "../../src/plugins/types.js";
import { createLobsterTool } from "./src/lobster-tool.js";

export default function register(api: HandsPluginApi) {
  api.registerTool(
    ((ctx) => {
      if (ctx.sandboxed) {
        return null;
      }
      return createLobsterTool(api) as AnyAgentTool;
    }) as HandsPluginToolFactory,
    { optional: true },
  );
}
