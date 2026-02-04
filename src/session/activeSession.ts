import fs from "node:fs/promises";
import path from "node:path";

import { getActiveSessionPath, getStateDir } from "../util/paths";

export interface ActiveSessionInfo {
  schemaVersion: "1";
  outputDir: string;
  markersPath: string;
  startedAtIso: string;
  startedAtMsEpoch: number;
}

export async function writeActiveSession(info: ActiveSessionInfo): Promise<void> {
  await fs.mkdir(getStateDir(), { recursive: true });
  await fs.writeFile(getActiveSessionPath(), JSON.stringify(info, null, 2), "utf8");
}

export async function readActiveSession(): Promise<ActiveSessionInfo> {
  const raw = await fs.readFile(getActiveSessionPath(), "utf8");
  const parsed = JSON.parse(raw) as ActiveSessionInfo;
  if (!parsed || parsed.schemaVersion !== "1") throw new Error("Invalid active session file");
  if (!parsed.outputDir || !path.isAbsolute(parsed.outputDir)) throw new Error("Invalid active session outputDir");
  return parsed;
}

export async function clearActiveSession(): Promise<void> {
  try {
    await fs.rm(getActiveSessionPath(), { force: true });
  } catch {
    // ignore
  }
}

