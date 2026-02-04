import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { correlateJsonlToTurns } from "../src/session/jsonlCorrelate";

describe("correlateJsonlToTurns", () => {
  it("extracts metadata without persisting plaintext content", async () => {
    const startedAtMsEpoch = Date.now();
    const jsonlPath = path.join(os.tmpdir(), `cc-profiler-test-${startedAtMsEpoch}.jsonl`);
    const secret = "SUPER_SECRET_PROMPT";

    const lines = [
      JSON.stringify({ timestamp: startedAtMsEpoch + 1000, role: "user", content: secret, usage: { input_tokens: 10 } }),
      JSON.stringify({
        timestamp: startedAtMsEpoch + 1500,
        role: "assistant",
        content: [
          { type: "text", text: "hi" },
          { type: "tool_use", name: "read_file" },
        ],
        usage: { output_tokens: 20 },
      }),
      JSON.stringify({ timestamp: startedAtMsEpoch + 1600, tool_name: "exec_command" }),
    ].join("\n");

    await fs.writeFile(jsonlPath, `${lines}\n`, "utf8");

    const correlation = await correlateJsonlToTurns({
      jsonlPath,
      startedAtMsEpoch,
      endedAtMsEpoch: startedAtMsEpoch + 10_000,
      turns: [{ index: 1, tMs: 900, source: "enter" }],
    });

    expect(correlation.mode).toBe("timestamps");
    expect(correlation.perTurn[0]?.toolUseNames).toEqual(["exec_command", "read_file"]);
    expect(correlation.perTurn[0]?.inputTokenCount).toBe(10);
    expect(correlation.perTurn[0]?.outputTokenCount).toBe(20);

    // Ensure we didn't accidentally persist plaintext from the JSONL.
    expect(JSON.stringify(correlation)).not.toContain(secret);

    await fs.rm(jsonlPath, { force: true });
  });
});

