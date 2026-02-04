import { describe, expect, it } from "vitest";

import { runSession } from "../src/session/runSession";

describe("runSession option validation", () => {
  it("rejects invalid numeric options before starting", async () => {
    await expect(
      runSession({
        command: ["/usr/bin/true"],
        cwd: process.cwd(),
        burstIdleMs: Number.NaN,
        interactionTimeoutMs: 2000,
        sampleIntervalMs: 100,
        turnHotkey: "alt+t",
        disableMcps: false,
        correlateJsonl: false,
        unsafeStorePaths: false,
        unsafeStoreCommand: false,
        unsafeStoreErrors: false,
      }),
    ).rejects.toThrow(/burstIdleMs/i);

    await expect(
      runSession({
        command: ["/usr/bin/true"],
        cwd: process.cwd(),
        burstIdleMs: 30,
        interactionTimeoutMs: 2000,
        sampleIntervalMs: 0,
        turnHotkey: "alt+t",
        disableMcps: false,
        correlateJsonl: false,
        unsafeStorePaths: false,
        unsafeStoreCommand: false,
        unsafeStoreErrors: false,
      }),
    ).rejects.toThrow(/sampleIntervalMs/i);
  });
});

