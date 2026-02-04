import { open, readdir, stat } from "node:fs/promises";
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
  cwd?: string;
  allowReadForSelection?: boolean;
  projectsDirOverride?: string;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const st = await stat(p);
    return st.isDirectory();
  } catch {
    return false;
  }
}

function encodeClaudeProjectDirName(cwd: string): string {
  // Observed Claude Code project dir names resemble a sanitized absolute path, e.g.
  // /Users/me/foo_bar -> -Users-me-foo-bar
  return path.resolve(cwd).replaceAll(/[^A-Za-z0-9]/g, "-");
}

interface JsonlCandidate {
  p: string;
  mtimeMs: number;
  sizeBytes: number;
}

async function findRecentJsonlCandidates(rootDir: string, sinceMsEpoch: number, maxDepth: number): Promise<JsonlCandidate[]> {
  const maxEntries = 15_000;
  let seen = 0;

  const candidates: JsonlCandidate[] = [];
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
        const sizeBytes = Number(st.size);
        candidates.push({
          p: full,
          mtimeMs,
          sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        });
      } catch {
        // ignore
      }
    }
  }

  return candidates;
}

function pickLargestCandidate(candidates: JsonlCandidate[]): JsonlCandidate | undefined {
  let best: JsonlCandidate | undefined;
  for (const c of candidates) {
    if (!best) {
      best = c;
      continue;
    }
    if (c.sizeBytes > best.sizeBytes) best = c;
    else if (c.sizeBytes === best.sizeBytes && c.mtimeMs > best.mtimeMs) best = c;
  }
  return best;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractEpochMs(rec: unknown): number | undefined {
  if (!isObject(rec)) return undefined;

  const candidates = [
    rec["timestamp"],
    rec["time"],
    rec["created_at"],
    rec["createdAt"],
    rec["ts"],
    (isObject(rec["meta"]) ? rec["meta"]["timestamp"] : undefined),
  ];

  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) {
      if (c > 1e12) return c; // ms
      if (c > 1e9) return c * 1000; // seconds
      continue;
    }
    if (typeof c === "string") {
      const ms = Date.parse(c);
      if (Number.isFinite(ms)) return ms;
    }
  }

  return undefined;
}

function extractRole(rec: unknown): "user" | "assistant" | undefined {
  if (!isObject(rec)) return undefined;

  // Claude Code uses "type" field for role
  const typeField = rec["type"];
  if (typeof typeField === "string") {
    const r = typeField.toLowerCase();
    if (r === "user" || r === "assistant") return r as "user" | "assistant";
  }

  const roleField = rec["role"];
  if (typeof roleField === "string") {
    const r = roleField.toLowerCase();
    if (r === "user" || r === "assistant") return r as "user" | "assistant";
  }

  const msg = rec["message"];
  if (isObject(msg) && typeof msg["role"] === "string") {
    const r = String(msg["role"]).toLowerCase();
    if (r === "user" || r === "assistant") return r as "user" | "assistant";
  }

  return undefined;
}

async function scoreJsonlCandidateForConversation(c: JsonlCandidate, startedAtMsEpoch: number): Promise<number> {
  if (!Number.isFinite(c.sizeBytes) || c.sizeBytes <= 0) return 0;

  // Read a tail chunk, since JSONL is append-only and the tail is most likely to contain the active session.
  const maxBytes = 512 * 1024;
  const offset = Math.max(0, c.sizeBytes - maxBytes);
  const readLen = c.sizeBytes - offset;
  if (readLen <= 0) return 0;

  let text = "";
  try {
    const fh = await open(c.p, "r");
    try {
      const buf = Buffer.allocUnsafe(readLen);
      const { bytesRead } = await fh.read(buf, 0, readLen, offset);
      text = buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return 0;
  }

  if (offset > 0) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
  }

  let parsedCount = 0;
  let userCount = 0;
  let assistantCount = 0;
  let timestampCount = 0;
  let timestampInWindowCount = 0;

  const windowStartMs = startedAtMsEpoch - 10_000;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }

    parsedCount += 1;

    const role = extractRole(rec);
    if (role === "user") userCount += 1;
    if (role === "assistant") assistantCount += 1;

    const ts = extractEpochMs(rec);
    if (ts != null) {
      timestampCount += 1;
      if (ts >= windowStartMs) timestampInWindowCount += 1;
    }

    // Stop early once we have strong evidence.
    if (parsedCount >= 2_000) break;
  }

  let score = 0;
  if (userCount > 0) score += 1_000_000;
  if (assistantCount > 0) score += 500_000;
  if (timestampCount > 0) score += 100_000;
  if (timestampInWindowCount > 0) score += 200_000;

  score += Math.min(userCount, 500) * 10_000;
  score += Math.min(assistantCount, 500) * 5_000;
  score += Math.min(timestampCount, 5_000) * 10;
  score += Math.min(parsedCount, 2_000);

  // Small tie-breaker for larger files.
  score += Math.min(Math.floor(c.sizeBytes / 1024), 50_000);

  return score;
}

async function pickBestCandidateForConversation(
  candidates: JsonlCandidate[],
  startedAtMsEpoch: number,
): Promise<JsonlCandidate | undefined> {
  // Only score a small set of recently-modified candidates to keep overhead bounded.
  const sorted = [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const toScore = sorted.slice(0, 25);

  let best: { c: JsonlCandidate; score: number } | undefined;
  for (const c of toScore) {
    const score = await scoreJsonlCandidateForConversation(c, startedAtMsEpoch);
    if (!best || score > best.score || (score === best.score && c.sizeBytes > best.c.sizeBytes)) {
      best = { c, score };
    }
  }

  return best?.c ?? pickLargestCandidate(candidates);
}

export class JsonlTracker {
  private readonly startedAtMsEpoch: number;
  private readonly overridePath?: string;
  private readonly cwd?: string;
  private readonly allowReadForSelection: boolean;
  private readonly projectsDirOverride?: string;
  private activePath?: string;
  private activePathSha256?: string;
  private samples: JsonlSizeSample[] = [];

  constructor(opts: JsonlTrackerOptions) {
    this.startedAtMsEpoch = opts.startedAtMsEpoch;
    this.overridePath = opts.overridePath;
    this.cwd = opts.cwd;
    this.allowReadForSelection = Boolean(opts.allowReadForSelection);
    this.projectsDirOverride = opts.projectsDirOverride;
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

    const projectsDir = this.projectsDirOverride ?? path.join(os.homedir(), ".claude", "projects");
    if (!(await pathExists(projectsDir))) return undefined;

    const sinceMsEpoch = this.startedAtMsEpoch - 10_000;

    // Prefer the current project directory if we can infer it from cwd, to avoid picking up other active projects.
    const roots: Array<{ dir: string; maxDepth: number }> = [];
    if (this.cwd) {
      const projectDir = path.join(projectsDir, encodeClaudeProjectDirName(this.cwd));
      if (await isDirectory(projectDir)) roots.push({ dir: projectDir, maxDepth: 2 });
    }
    roots.push({ dir: projectsDir, maxDepth: 6 });

    let candidates: JsonlCandidate[] = [];
    for (const root of roots) {
      candidates = await findRecentJsonlCandidates(root.dir, sinceMsEpoch, root.maxDepth);
      if (candidates.length > 0) break;
    }
    if (!candidates.length) return undefined;

    const best = this.allowReadForSelection
      ? await pickBestCandidateForConversation(candidates, this.startedAtMsEpoch)
      : pickLargestCandidate(candidates);
    if (!best) return undefined;

    this.activePath = best.p;
    this.activePathSha256 = sha256Hex(best.p);
    return best.p;
  }
}
