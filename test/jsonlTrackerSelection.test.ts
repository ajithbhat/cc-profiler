import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { JsonlTracker } from "../src/session/jsonlTracker";

function encodeProjectDirName(cwd: string): string {
  return path.resolve(cwd).replaceAll(/[^A-Za-z0-9]/g, "-");
}

async function touchFile(p: string, mtimeMs: number): Promise<void> {
  const d = new Date(mtimeMs);
  await fs.utimes(p, d, d);
}

describe("JsonlTracker selection", () => {
  it("prefers the largest recently-modified JSONL by default", async () => {
    const startedAtMsEpoch = Date.now();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cc-profiler-jsonl-select-"));
    try {
      const projectsDir = path.join(tmp, "projects");
      await fs.mkdir(projectsDir, { recursive: true });

      const cwd = path.join(tmp, "workspace_cc_profiler");
      const projectDir = path.join(projectsDir, encodeProjectDirName(cwd));
      await fs.mkdir(projectDir, { recursive: true });

      const small = path.join(projectDir, "snapshot.jsonl");
      const large = path.join(projectDir, "conversation.jsonl");

      await fs.writeFile(small, `${JSON.stringify({ type: "file-history-snapshot" })}\n`, "utf8");
      await fs.writeFile(
        large,
        `${JSON.stringify({ type: "file-history-snapshot" })}\n${JSON.stringify({ type: "user", timestamp: new Date().toISOString() })}\n`.repeat(
          50,
        ),
        "utf8",
      );

      // Make the snapshot look "more recent" than the conversation, to reproduce the bug.
      await touchFile(large, startedAtMsEpoch + 1_000);
      await touchFile(small, startedAtMsEpoch + 5_000);

      const tracker = new JsonlTracker({
        startedAtMsEpoch,
        cwd,
        projectsDirOverride: projectsDir,
      });

      expect(await tracker.getActivePathUnsafe()).toBe(large);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it("prefers conversation-like JSONL when selection reads are allowed", async () => {
    const startedAtMsEpoch = Date.now();
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cc-profiler-jsonl-select-"));
    try {
      const projectsDir = path.join(tmp, "projects");
      await fs.mkdir(projectsDir, { recursive: true });

      const cwd = path.join(tmp, "workspace_cc_profiler");
      const projectDir = path.join(projectsDir, encodeProjectDirName(cwd));
      await fs.mkdir(projectDir, { recursive: true });

      const snapshotOnly = path.join(projectDir, "snapshot.jsonl");
      const conversation = path.join(projectDir, "conversation.jsonl");

      // Snapshot-only file is much larger and more recently modified.
      await fs.writeFile(snapshotOnly, `${JSON.stringify({ type: "file-history-snapshot" })}\n`.repeat(2_000), "utf8");
      await fs.writeFile(
        conversation,
        `${JSON.stringify({ type: "file-history-snapshot" })}\n${JSON.stringify({ type: "user", timestamp: new Date().toISOString() })}\n`,
        "utf8",
      );

      await touchFile(conversation, startedAtMsEpoch + 1_000);
      await touchFile(snapshotOnly, startedAtMsEpoch + 5_000);

      const tracker = new JsonlTracker({
        startedAtMsEpoch,
        cwd,
        allowReadForSelection: true,
        projectsDirOverride: projectsDir,
      });

      expect(await tracker.getActivePathUnsafe()).toBe(conversation);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

