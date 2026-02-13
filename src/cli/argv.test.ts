import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it("detects help/version flags", () => {
    expect(hasHelpOrVersion(["node", "hands", "--help"])).toBe(true);
    expect(hasHelpOrVersion(["node", "hands", "-V"])).toBe(true);
    expect(hasHelpOrVersion(["node", "hands", "status"])).toBe(false);
  });

  it("extracts command path ignoring flags and terminator", () => {
    expect(getCommandPath(["node", "hands", "status", "--json"], 2)).toEqual(["status"]);
    expect(getCommandPath(["node", "hands", "agents", "list"], 2)).toEqual(["agents", "list"]);
    expect(getCommandPath(["node", "hands", "status", "--", "ignored"], 2)).toEqual(["status"]);
  });

  it("returns primary command", () => {
    expect(getPrimaryCommand(["node", "hands", "agents", "list"])).toBe("agents");
    expect(getPrimaryCommand(["node", "hands"])).toBeNull();
  });

  it("parses boolean flags and ignores terminator", () => {
    expect(hasFlag(["node", "hands", "status", "--json"], "--json")).toBe(true);
    expect(hasFlag(["node", "hands", "--", "--json"], "--json")).toBe(false);
  });

  it("extracts flag values with equals and missing values", () => {
    expect(getFlagValue(["node", "hands", "status", "--timeout", "5000"], "--timeout")).toBe(
      "5000",
    );
    expect(getFlagValue(["node", "hands", "status", "--timeout=2500"], "--timeout")).toBe(
      "2500",
    );
    expect(getFlagValue(["node", "hands", "status", "--timeout"], "--timeout")).toBeNull();
    expect(getFlagValue(["node", "hands", "status", "--timeout", "--json"], "--timeout")).toBe(
      null,
    );
    expect(getFlagValue(["node", "hands", "--", "--timeout=99"], "--timeout")).toBeUndefined();
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "hands", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "hands", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "hands", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it("parses positive integer flag values", () => {
    expect(getPositiveIntFlagValue(["node", "hands", "status"], "--timeout")).toBeUndefined();
    expect(
      getPositiveIntFlagValue(["node", "hands", "status", "--timeout"], "--timeout"),
    ).toBeNull();
    expect(
      getPositiveIntFlagValue(["node", "hands", "status", "--timeout", "5000"], "--timeout"),
    ).toBe(5000);
    expect(
      getPositiveIntFlagValue(["node", "hands", "status", "--timeout", "nope"], "--timeout"),
    ).toBeUndefined();
  });

  it("builds parse argv from raw args", () => {
    const nodeArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["node", "hands", "status"],
    });
    expect(nodeArgv).toEqual(["node", "hands", "status"]);

    const versionedNodeArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["node-22", "hands", "status"],
    });
    expect(versionedNodeArgv).toEqual(["node-22", "hands", "status"]);

    const versionedNodeWindowsArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["node-22.2.0.exe", "hands", "status"],
    });
    expect(versionedNodeWindowsArgv).toEqual(["node-22.2.0.exe", "hands", "status"]);

    const versionedNodePatchlessArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["node-22.2", "hands", "status"],
    });
    expect(versionedNodePatchlessArgv).toEqual(["node-22.2", "hands", "status"]);

    const versionedNodeWindowsPatchlessArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["node-22.2.exe", "hands", "status"],
    });
    expect(versionedNodeWindowsPatchlessArgv).toEqual(["node-22.2.exe", "hands", "status"]);

    const versionedNodeWithPathArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["/usr/bin/node-22.2.0", "hands", "status"],
    });
    expect(versionedNodeWithPathArgv).toEqual(["/usr/bin/node-22.2.0", "hands", "status"]);

    const nodejsArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["nodejs", "hands", "status"],
    });
    expect(nodejsArgv).toEqual(["nodejs", "hands", "status"]);

    const nonVersionedNodeArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["node-dev", "hands", "status"],
    });
    expect(nonVersionedNodeArgv).toEqual(["node", "hands", "node-dev", "hands", "status"]);

    const directArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["hands", "status"],
    });
    expect(directArgv).toEqual(["node", "hands", "status"]);

    const bunArgv = buildParseArgv({
      programName: "hands",
      rawArgs: ["bun", "src/entry.ts", "status"],
    });
    expect(bunArgv).toEqual(["bun", "src/entry.ts", "status"]);
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "hands",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "hands", "status"]);
  });

  it("decides when to migrate state", () => {
    expect(shouldMigrateState(["node", "hands", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "hands", "health"])).toBe(false);
    expect(shouldMigrateState(["node", "hands", "sessions"])).toBe(false);
    expect(shouldMigrateState(["node", "hands", "memory", "status"])).toBe(false);
    expect(shouldMigrateState(["node", "hands", "agent", "--message", "hi"])).toBe(false);
    expect(shouldMigrateState(["node", "hands", "agents", "list"])).toBe(true);
    expect(shouldMigrateState(["node", "hands", "message", "send"])).toBe(true);
  });

  it("reuses command path for migrate state decisions", () => {
    expect(shouldMigrateStateFromPath(["status"])).toBe(false);
    expect(shouldMigrateStateFromPath(["agents", "list"])).toBe(true);
  });
});
