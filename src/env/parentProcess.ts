import { execFile } from "node:child_process";

function execFileText(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs }, (err, stdout) => {
      if (err) return reject(err);
      resolve(String(stdout).trim());
    });
  });
}

export async function getParentProcessName(ppid: number): Promise<string | undefined> {
  if (!Number.isFinite(ppid) || ppid <= 0) return undefined;

  try {
    if (process.platform === "win32") {
      const text = await execFileText(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `(Get-Process -Id ${ppid} -ErrorAction Stop).ProcessName`,
        ],
        750,
      );
      return text || undefined;
    }

    const text = await execFileText("ps", ["-o", "comm=", "-p", String(ppid)], 750);
    return text || undefined;
  } catch {
    return undefined;
  }
}

