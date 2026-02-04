import pidusage from "pidusage";

import type { ProcessSample } from "../session/schema";
import { collectLinuxExtras } from "./linux";

function pidusageAsync(pid: number): Promise<{ cpu: number; memory: number }> {
  return new Promise((resolve, reject) => {
    pidusage(pid, (err, stats) => {
      if (err) return reject(err);
      resolve({ cpu: Number(stats?.cpu), memory: Number(stats?.memory) });
    });
  });
}

export interface ProcessMonitorOptions {
  pid: number;
  sampleIntervalMs: number;
  nowMs: () => number;
  onSample: (sample: ProcessSample) => void;
  onExit?: () => void;
}

export function startProcessMonitor(opts: ProcessMonitorOptions): { stop: () => void } {
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;

    const tMs = opts.nowMs();
    const sample: ProcessSample = { tMs, pid: opts.pid };

    try {
      const basic = await pidusageAsync(opts.pid);
      if (Number.isFinite(basic.memory)) sample.rssBytes = basic.memory;
      if (Number.isFinite(basic.cpu)) sample.cpuPercent = basic.cpu;

      if (process.platform === "linux") {
        const extras = await collectLinuxExtras(opts.pid);
        sample.pageFaultsMinor = extras.pageFaultsMinor;
        sample.pageFaultsMajor = extras.pageFaultsMajor;
        sample.ctxSwitchesVoluntary = extras.ctxSwitchesVoluntary;
        sample.ctxSwitchesInvoluntary = extras.ctxSwitchesInvoluntary;
        sample.fdCount = extras.fdCount;
        sample.threadCount = extras.threadCount;
      }
    } catch (err) {
      sample.error = String(err);
      // Process likely exited; stop monitoring.
      stopped = true;
      opts.onExit?.();
    } finally {
      opts.onSample(sample);
      inFlight = false;
    }
  };

  const timer = setInterval(tick, opts.sampleIntervalMs);
  // Take an initial sample immediately.
  void tick();

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
      (pidusage as any).clear?.();
    },
  };
}
