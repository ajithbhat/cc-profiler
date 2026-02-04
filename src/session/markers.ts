import fs from "node:fs/promises";

import { sha256Hex } from "../util/hash";
import type { MarkerEvent } from "./schema";

export interface AppendMarkerOptions {
  markersPath: string;
  tMs?: number;
  label?: string;
  storePlaintextLabel?: boolean;
}

export async function appendMarker(opts: AppendMarkerOptions): Promise<void> {
  const tIso = new Date().toISOString();
  const label = opts.label?.trim();

  const record: any = { tIso };
  if (typeof opts.tMs === "number" && Number.isFinite(opts.tMs)) record.tMs = opts.tMs;
  if (label) {
    record.labelSha256 = sha256Hex(label);
    if (opts.storePlaintextLabel) record.label = label;
  }

  await fs.appendFile(opts.markersPath, `${JSON.stringify(record)}\n`, "utf8");
}

export interface MarkerLine {
  tIso: string;
  tMs?: number;
  label?: string;
  labelSha256?: string;
}

export function markerLineToEvent(line: MarkerLine, tMs: number): MarkerEvent {
  return {
    tMs,
    label: line.label,
    labelSha256: line.labelSha256,
  };
}
