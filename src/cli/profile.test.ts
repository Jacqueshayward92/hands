import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "hands",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "hands", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "hands", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "hands", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "hands", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "hands", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "hands", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (dev first)", () => {
    const res = parseCliProfileArgs(["node", "hands", "--dev", "--profile", "work", "status"]);
    expect(res.ok).toBe(false);
  });

  it("rejects combining --dev with --profile (profile first)", () => {
    const res = parseCliProfileArgs(["node", "hands", "--profile", "work", "--dev", "status"]);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".hands-dev");
    expect(env.HANDS_PROFILE).toBe("dev");
    expect(env.HANDS_STATE_DIR).toBe(expectedStateDir);
    expect(env.HANDS_CONFIG_PATH).toBe(path.join(expectedStateDir, "hands.json"));
    expect(env.HANDS_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      HANDS_STATE_DIR: "/custom",
      HANDS_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.HANDS_STATE_DIR).toBe("/custom");
    expect(env.HANDS_GATEWAY_PORT).toBe("19099");
    expect(env.HANDS_CONFIG_PATH).toBe(path.join("/custom", "hands.json"));
  });

  it("uses HANDS_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      HANDS_HOME: "/srv/hands-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/hands-home");
    expect(env.HANDS_STATE_DIR).toBe(path.join(resolvedHome, ".hands-work"));
    expect(env.HANDS_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".hands-work", "hands.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it("returns command unchanged when no profile is set", () => {
    expect(formatCliCommand("hands doctor --fix", {})).toBe("hands doctor --fix");
  });

  it("returns command unchanged when profile is default", () => {
    expect(formatCliCommand("hands doctor --fix", { HANDS_PROFILE: "default" })).toBe(
      "hands doctor --fix",
    );
  });

  it("returns command unchanged when profile is Default (case-insensitive)", () => {
    expect(formatCliCommand("hands doctor --fix", { HANDS_PROFILE: "Default" })).toBe(
      "hands doctor --fix",
    );
  });

  it("returns command unchanged when profile is invalid", () => {
    expect(formatCliCommand("hands doctor --fix", { HANDS_PROFILE: "bad profile" })).toBe(
      "hands doctor --fix",
    );
  });

  it("returns command unchanged when --profile is already present", () => {
    expect(
      formatCliCommand("hands --profile work doctor --fix", { HANDS_PROFILE: "work" }),
    ).toBe("hands --profile work doctor --fix");
  });

  it("returns command unchanged when --dev is already present", () => {
    expect(formatCliCommand("hands --dev doctor", { HANDS_PROFILE: "dev" })).toBe(
      "hands --dev doctor",
    );
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("hands doctor --fix", { HANDS_PROFILE: "work" })).toBe(
      "hands --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("hands doctor --fix", { HANDS_PROFILE: "  jbhands  " })).toBe(
      "hands --profile jbhands doctor --fix",
    );
  });

  it("handles command with no args after hands", () => {
    expect(formatCliCommand("hands", { HANDS_PROFILE: "test" })).toBe(
      "hands --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm hands doctor", { HANDS_PROFILE: "work" })).toBe(
      "pnpm hands --profile work doctor",
    );
  });
});
