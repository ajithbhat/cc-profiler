import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createProgram } from "../src/cli/program";

function getLongOptions(cmd: any): string[] {
  return (cmd.options || [])
    .map((o: any) => o.long as string | undefined)
    .filter((v: any) => typeof v === "string")
    .filter((v: string) => v !== "--help")
    .sort();
}

describe("CLI program", () => {
  it("keeps root and run option sets in sync", () => {
    const program = createProgram();
    const runCmd = program.commands.find((c) => c.name() === "run");
    expect(runCmd).toBeTruthy();

    expect(getLongOptions(runCmd)).toEqual(getLongOptions(program));
  });

  it("fails fast on invalid numeric options", async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    for (const cmd of program.commands) {
      cmd.exitOverride();
      cmd.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    }

    await expect(
      program.parseAsync(["node", "cc-profiler", "run", "--burst-idle-ms", "foo", "--", "/usr/bin/true"]),
    ).rejects.toThrow(/--burst-idle-ms/i);
  });

  it("rejects unknown --turn-hotkey values", async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    for (const cmd of program.commands) {
      cmd.exitOverride();
      cmd.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    }

    await expect(
      program.parseAsync(["node", "cc-profiler", "run", "--turn-hotkey", "ctrl+x", "--", "/usr/bin/true"]),
    ).rejects.toThrow(/--turn-hotkey/i);
  });

  it("fails fast when --binary is missing", async () => {
    const program = createProgram();
    program.exitOverride();
    program.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    for (const cmd of program.commands) {
      cmd.exitOverride();
      cmd.configureOutput({ writeOut: () => undefined, writeErr: () => undefined });
    }

    const missing = path.join(os.tmpdir(), `cc-profiler-missing-binary-${Date.now()}`);
    await expect(program.parseAsync(["node", "cc-profiler", "run", "--binary", missing])).rejects.toThrow(/--binary/i);
  });
});
