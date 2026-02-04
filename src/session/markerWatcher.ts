import fs from "node:fs/promises";

import type { MarkerEvent } from "./schema";
import type { MarkerLine } from "./markers";
import { markerLineToEvent } from "./markers";

export interface MarkerWatcherOptions {
  markersPath: string;
  startedAtMsEpoch: number;
  pollIntervalMs: number;
  onMarker: (marker: MarkerEvent) => void;
}

export function startMarkerWatcher(opts: MarkerWatcherOptions): { stop: () => void } {
  let stopped = false;
  let lastSize = 0;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const st = await fs.stat(opts.markersPath);
      const size = Number(st.size);
      if (!Number.isFinite(size) || size <= lastSize) return;

      const fd = await fs.open(opts.markersPath, "r");
      try {
        const toRead = size - lastSize;
        const buf = Buffer.allocUnsafe(toRead);
        const { bytesRead } = await fd.read(buf, 0, toRead, lastSize);
        lastSize += bytesRead;

        const text = buf.subarray(0, bytesRead).toString("utf8");
        for (const line of text.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let parsed: MarkerLine | undefined;
          try {
            parsed = JSON.parse(trimmed) as MarkerLine;
          } catch {
            continue;
          }

          const tMs =
            typeof parsed.tMs === "number" && Number.isFinite(parsed.tMs)
              ? parsed.tMs
              : Date.parse(parsed.tIso) - opts.startedAtMsEpoch;
          if (!Number.isFinite(tMs) || tMs < 0) continue;

          opts.onMarker(markerLineToEvent(parsed, tMs));
        }
      } finally {
        await fd.close();
      }
    } catch {
      // ignore
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => void tick(), opts.pollIntervalMs);
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

