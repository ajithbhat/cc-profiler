import os from "node:os";
import path from "node:path";

export function getStateDir(): string {
  return path.join(os.homedir(), ".cc-profiler");
}

export function getActiveSessionPath(): string {
  return path.join(getStateDir(), "active-session.json");
}

export function defaultSessionDirName(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `cc-profiler-session-${yyyy}-${mm}-${dd}-${hh}${mi}${ss}`;
}

