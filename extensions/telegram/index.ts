import type { ChannelPlugin, HandsPluginApi } from "hands/plugin-sdk";
import { emptyPluginConfigSchema } from "hands/plugin-sdk";
import { telegramPlugin } from "./src/channel.js";
import { setTelegramRuntime } from "./src/runtime.js";

const plugin = {
  id: "telegram",
  name: "Telegram",
  description: "Telegram channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: HandsPluginApi) {
    setTelegramRuntime(api.runtime);
    api.registerChannel({ plugin: telegramPlugin as ChannelPlugin });
  },
};

export default plugin;
