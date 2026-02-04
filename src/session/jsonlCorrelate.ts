import fs from "node:fs";
import readline from "node:readline";

import type { JsonlCorrelation, TurnEvent } from "./schema";

export interface CorrelateJsonlOptions {
  jsonlPath: string;
  startedAtMsEpoch: number;
  endedAtMsEpoch?: number;
  turns: TurnEvent[];
}

export async function correlateJsonlToTurns(opts: CorrelateJsonlOptions): Promise<JsonlCorrelation> {
  const notes: string[] = [];
  if (opts.turns.length === 0) {
    return {
      enabled: true,
      mode: "none",
      parsedLines: 0,
      parsedBytes: 0,
      parseErrors: 0,
      perTurn: [],
      notes: ["No turns recorded; cannot correlate JSONL."],
    };
  }

  const perTurn = opts.turns.map((t) => ({
    turnIndex: t.index,
    recordCount: 0,
    recordBytes: 0,
    toolUseCount: 0,
    toolUseNames: new Set<string>(),
    inputTokenCount: 0,
    outputTokenCount: 0,
  }));

  const perTurnByIndex = new Map<number, (typeof perTurn)[number]>();
  for (const pt of perTurn) perTurnByIndex.set(pt.turnIndex, pt);

  const startWindowMs = opts.startedAtMsEpoch - 10_000;
  const endWindowMs = typeof opts.endedAtMsEpoch === "number" ? opts.endedAtMsEpoch + 60_000 : undefined;

  let parsedLines = 0;
  let parsedBytes = 0;
  let parseErrors = 0;

  let usedTimestamps = 0;
  let seenAnyTimestamp = 0;
  let usedSequential = false;

  // Timestamp-based turn mapping.
  const turnEpochMs = opts.turns.map((t) => opts.startedAtMsEpoch + t.tMs);
  let turnPtr = 0; // points to current turn index in opts.turns array
  const advanceTurnPtr = (epochMs: number) => {
    while (turnPtr + 1 < turnEpochMs.length && epochMs >= turnEpochMs[turnPtr + 1]) turnPtr += 1;
  };

  // Sequential mapping: advance on user messages.
  let seqTurnPtr = -1; // will advance to 0 on first detected user message

  const stream = fs.createReadStream(opts.jsonlPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      parsedLines += 1;
      parsedBytes += Buffer.byteLength(line, "utf8");

      let rec: unknown;
      try {
        rec = JSON.parse(trimmed) as unknown;
      } catch {
        parseErrors += 1;
        continue;
      }

      const epochMs = extractEpochMs(rec);
      if (epochMs != null) {
        seenAnyTimestamp += 1;
        if (epochMs < startWindowMs) continue;
        if (endWindowMs != null && epochMs > endWindowMs && usedTimestamps > 0) break;
        usedTimestamps += 1;
        advanceTurnPtr(epochMs);
        const t = opts.turns[turnPtr];
        if (t) applyRecord(perTurnByIndex.get(t.index), line, rec);
        continue;
      }

      // If no timestamp is present, attempt sequential assignment.
      const role = extractRole(rec);
      if (role === "user") {
        usedSequential = true;
        seqTurnPtr += 1;
        if (seqTurnPtr >= opts.turns.length) continue;
      }

      if (seqTurnPtr >= 0 && seqTurnPtr < opts.turns.length) {
        const t = opts.turns[seqTurnPtr];
        if (t) applyRecord(perTurnByIndex.get(t.index), line, rec);
      }
    }
  } finally {
    rl.close();
    stream.close();
  }

  const mode: JsonlCorrelation["mode"] =
    usedTimestamps > 0 ? "timestamps" : usedSequential ? "sequential" : "none";

  if (mode === "none") {
    notes.push("No usable timestamps or user-message markers found in JSONL; correlation may be incomplete.");
  }

  if (seenAnyTimestamp > 0 && usedTimestamps === 0) {
    notes.push("JSONL timestamps were present but all fell outside the session time window.");
  }

  const result: JsonlCorrelation = {
    enabled: true,
    mode,
    parsedLines,
    parsedBytes,
    parseErrors,
    perTurn: perTurn.map((pt) => ({
      turnIndex: pt.turnIndex,
      recordCount: pt.recordCount,
      recordBytes: pt.recordBytes,
      toolUseCount: pt.toolUseCount,
      toolUseNames: [...pt.toolUseNames].sort(),
      inputTokenCount: pt.inputTokenCount || undefined,
      outputTokenCount: pt.outputTokenCount || undefined,
    })),
    notes,
  };

  return result;
}

function applyRecord(
  bucket: {
    recordCount: number;
    recordBytes: number;
    toolUseCount: number;
    toolUseNames: Set<string>;
    inputTokenCount: number;
    outputTokenCount: number;
  } | undefined,
  line: string,
  rec: unknown,
): void {
  if (!bucket) return;
  bucket.recordCount += 1;
  bucket.recordBytes += Buffer.byteLength(line, "utf8");

  const toolNames = extractToolNames(rec);
  bucket.toolUseCount += toolNames.length;
  for (const name of toolNames) bucket.toolUseNames.add(name);

  const usage = extractTokenUsage(rec);
  if (usage?.inputTokens != null) bucket.inputTokenCount += usage.inputTokens;
  if (usage?.outputTokens != null) bucket.outputTokenCount += usage.outputTokens;
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

  const direct = rec["role"];
  if (typeof direct === "string") {
    const r = direct.toLowerCase();
    if (r === "user" || r === "assistant") return r as any;
  }

  const msg = rec["message"];
  if (isObject(msg) && typeof msg["role"] === "string") {
    const r = (msg["role"] as string).toLowerCase();
    if (r === "user" || r === "assistant") return r as any;
  }

  return undefined;
}

function extractToolNames(rec: unknown): string[] {
  const names: string[] = [];
  if (!isObject(rec)) return names;

  // Common top-level fields.
  if (typeof rec["tool_name"] === "string") names.push(rec["tool_name"]);
  if (typeof rec["toolName"] === "string") names.push(rec["toolName"]);

  // Structured tool fields.
  const tool = rec["tool"];
  if (isObject(tool) && typeof tool["name"] === "string") names.push(tool["name"]);

  // Anthropic-style content arrays: [{type:"tool_use", name:"..."}]
  const content = rec["content"];
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!isObject(item)) continue;
      const type = typeof item["type"] === "string" ? item["type"].toLowerCase() : "";
      if (!type.includes("tool")) continue;
      if (typeof item["name"] === "string") names.push(item["name"]);
    }
  }

  // Nested message content.
  const message = rec["message"];
  if (isObject(message) && Array.isArray(message["content"])) {
    for (const item of message["content"] as unknown[]) {
      if (!isObject(item)) continue;
      const type = typeof item["type"] === "string" ? item["type"].toLowerCase() : "";
      if (!type.includes("tool")) continue;
      if (typeof item["name"] === "string") names.push(item["name"]);
    }
  }

  // Sanitize/normalize.
  return names
    .map((n) => String(n).trim())
    .filter((n) => n.length > 0)
    .map((n) => (n.length > 120 ? n.slice(0, 120) : n));
}

function extractTokenUsage(rec: unknown): { inputTokens?: number; outputTokens?: number } | undefined {
  if (!isObject(rec)) return undefined;

  const usage = rec["usage"] ?? rec["token_usage"] ?? rec["tokenUsage"];
  if (!isObject(usage)) return undefined;

  const input = usage["input_tokens"] ?? usage["inputTokens"] ?? usage["prompt_tokens"];
  const output = usage["output_tokens"] ?? usage["outputTokens"] ?? usage["completion_tokens"];

  const inputTokens = typeof input === "number" && Number.isFinite(input) ? input : undefined;
  const outputTokens = typeof output === "number" && Number.isFinite(output) ? output : undefined;

  if (inputTokens == null && outputTokens == null) return undefined;
  return { inputTokens, outputTokens };
}

