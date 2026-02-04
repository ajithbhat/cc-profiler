import { readdir, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { TurnEvent } from "./schema";
import { sha256Hex } from "../util/hash";

export interface JsonlSizeSample {
  turnIndex: number;
  tMs: number;
  sizeBytes: number;
}

export interface JsonlTrackerOptions {
  startedAtMsEpoch: number;
  overridePath?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function findMostRecentlyModifiedJsonl(rootDir: string, sinceMsEpoch: number): Promise<string | undefined> {
  const maxDepth = 6;
  const maxEntries = 15_000;
  let seen = 0;

  let best: { p: string; mtimeMs: number } | undefined;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    if (depth > maxDepth) continue;
    if (seen > maxEntries) break;

    let entries: Array<Dirent>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      seen += 1;
      if (seen > maxEntries) break;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".jsonl")) continue;

      try {
        const st = await stat(full);
        const mtimeMs = Number(st.mtimeMs);
        if (!Number.isFinite(mtimeMs)) continue;
        if (mtimeMs < sinceMsEpoch) continue;
        if (!best || mtimeMs > best.mtimeMs) best = { p: full, mtimeMs };
      } catch {
        // ignore
      }
    }
  }

  return best?.p;
}

export class JsonlTracker {
  private readonly startedAtMsEpoch: number;
  private readonly overridePath?: string;
  private activePath?: string;
  private activePathSha256?: string;
  private samples: JsonlSizeSample[] = [];

  constructor(opts: JsonlTrackerOptions) {
    this.startedAtMsEpoch = opts.startedAtMsEpoch;
    this.overridePath = opts.overridePath;
  }

  getActivePathSha256(): string | undefined {
    return this.activePathSha256;
  }

  getSamples(): JsonlSizeSample[] {
    return this.samples;
  }

  async getActivePathUnsafe(): Promise<string | undefined> {
    return await this.ensureActivePath();
  }

  async recordOnTurn(turn: TurnEvent): Promise<void> {
    const p = await this.ensureActivePath();
    if (!p) return;

    try {
      const st = await stat(p);
      this.samples.push({
        turnIndex: turn.index,
        tMs: turn.tMs,
        sizeBytes: Number(st.size),
      });
    } catch {
      // ignore
    }
  }

  private async ensureActivePath(): Promise<string | undefined> {
    if (this.activePath && (await pathExists(this.activePath))) return this.activePath;

    if (this.overridePath) {
      const resolved = path.resolve(this.overridePath);
      if (await pathExists(resolved)) {
        this.activePath = resolved;
        this.activePathSha256 = sha256Hex(resolved);
        return resolved;
      }
      return undefined;
    }

    const projectsDir = path.join(os.homedir(), ".claude", "projects");
    if (!(await pathExists(projectsDir))) return undefined;

    const candidate = await findMostRecentlyModifiedJsonl(projectsDir, this.startedAtMsEpoch - 10_000);
    if (!candidate) return undefined;

    this.activePath = candidate;
    this.activePathSha256 = sha256Hex(candidate);
    return candidate;
  }
}
