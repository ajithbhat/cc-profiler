import fs from "node:fs/promises";
import path from "node:path";

export interface LinuxExtras {
  pageFaultsMinor?: number;
  pageFaultsMajor?: number;
  ctxSwitchesVoluntary?: number;
  ctxSwitchesInvoluntary?: number;
  fdCount?: number;
  threadCount?: number;
}

function toNumber(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function collectLinuxExtras(pid: number): Promise<LinuxExtras> {
  const procDir = path.join("/proc", String(pid));
  const statPath = path.join(procDir, "stat");
  const statusPath = path.join(procDir, "status");
  const fdDir = path.join(procDir, "fd");

  const extras: LinuxExtras = {};

  try {
    const statRaw = await fs.readFile(statPath, "utf8");
    const rParen = statRaw.lastIndexOf(")");
    if (rParen > 0) {
      const after = statRaw.slice(rParen + 1).trim();
      const parts = after.split(/\s+/);
      // Field mapping: parts[0] is state (field 3).
      extras.pageFaultsMinor = toNumber(parts[7]);
      extras.pageFaultsMajor = toNumber(parts[9]);
      extras.threadCount = toNumber(parts[17]);
    }
  } catch {
    // ignore
  }

  try {
    const statusRaw = await fs.readFile(statusPath, "utf8");
    for (const line of statusRaw.split("\n")) {
      if (line.startsWith("voluntary_ctxt_switches:")) {
        extras.ctxSwitchesVoluntary = toNumber(line.split(":")[1]?.trim());
      } else if (line.startsWith("nonvoluntary_ctxt_switches:")) {
        extras.ctxSwitchesInvoluntary = toNumber(line.split(":")[1]?.trim());
      }
    }
  } catch {
    // ignore
  }

  try {
    const fds = await fs.readdir(fdDir);
    extras.fdCount = fds.length;
  } catch {
    // ignore
  }

  return extras;
}

