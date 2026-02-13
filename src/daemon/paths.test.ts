import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayStateDir } from "./paths.js";

describe("resolveGatewayStateDir", () => {
  it("uses the default state dir when no overrides are set", () => {
    const env = { HOME: "/Users/test" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".hands"));
  });

  it("appends the profile suffix when set", () => {
    const env = { HOME: "/Users/test", HANDS_PROFILE: "rescue" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".hands-rescue"));
  });

  it("treats default profiles as the base state dir", () => {
    const env = { HOME: "/Users/test", HANDS_PROFILE: "Default" };
    expect(resolveGatewayStateDir(env)).toBe(path.join("/Users/test", ".hands"));
  });

  it("uses HANDS_STATE_DIR when provided", () => {
    const env = { HOME: "/Users/test", HANDS_STATE_DIR: "/var/lib/hands" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/var/lib/hands"));
  });

  it("expands ~ in HANDS_STATE_DIR", () => {
    const env = { HOME: "/Users/test", HANDS_STATE_DIR: "~/hands-state" };
    expect(resolveGatewayStateDir(env)).toBe(path.resolve("/Users/test/hands-state"));
  });

  it("preserves Windows absolute paths without HOME", () => {
    const env = { HANDS_STATE_DIR: "C:\\State\\hands" };
    expect(resolveGatewayStateDir(env)).toBe("C:\\State\\hands");
  });
});
