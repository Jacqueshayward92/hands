import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers HANDS_OAUTH_DIR over HANDS_STATE_DIR", () => {
    const env = {
      HANDS_OAUTH_DIR: "/custom/oauth",
      HANDS_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from HANDS_STATE_DIR when unset", () => {
    const env = {
      HANDS_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses HANDS_STATE_DIR when set", () => {
    const env = {
      HANDS_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses HANDS_HOME for default state/config locations", () => {
    const env = {
      HANDS_HOME: "/srv/hands-home",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/hands-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".hands"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".hands", "hands.json"));
  });

  it("prefers HANDS_HOME over HOME for default state/config locations", () => {
    const env = {
      HANDS_HOME: "/srv/hands-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/hands-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".hands"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".hands", "hands.json"));
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(resolvedHome, ".hands", "hands.json"),
      path.join(resolvedHome, ".hands", "clawdbot.json"),
      path.join(resolvedHome, ".hands", "moltbot.json"),
      path.join(resolvedHome, ".hands", "moldbot.json"),
      path.join(resolvedHome, ".clawdbot", "hands.json"),
      path.join(resolvedHome, ".clawdbot", "clawdbot.json"),
      path.join(resolvedHome, ".clawdbot", "moltbot.json"),
      path.join(resolvedHome, ".clawdbot", "moldbot.json"),
      path.join(resolvedHome, ".moltbot", "hands.json"),
      path.join(resolvedHome, ".moltbot", "clawdbot.json"),
      path.join(resolvedHome, ".moltbot", "moltbot.json"),
      path.join(resolvedHome, ".moltbot", "moldbot.json"),
      path.join(resolvedHome, ".moldbot", "hands.json"),
      path.join(resolvedHome, ".moldbot", "clawdbot.json"),
      path.join(resolvedHome, ".moldbot", "moltbot.json"),
      path.join(resolvedHome, ".moldbot", "moldbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.hands when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hands-state-"));
    try {
      const newDir = path.join(root, ".hands");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hands-config-"));
    try {
      const legacyDir = path.join(root, ".hands");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "hands.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hands-config-override-"));
    try {
      const legacyDir = path.join(root, ".hands");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "hands.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { HANDS_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "hands.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
