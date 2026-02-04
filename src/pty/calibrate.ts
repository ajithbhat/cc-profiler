import * as pty from "node-pty";

import type { CalibrationResult } from "../session/schema";
import { createMonotonicClock } from "../util/clock";

export async function calibratePtyOverhead(burstIdleMs: number): Promise<CalibrationResult> {
  const clock = createMonotonicClock();

  return await new Promise<CalibrationResult>((resolve) => {
    const proc = pty.spawn("cat", [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env: process.env as NodeJS.ProcessEnv,
    });

    let firstOutAt: number | undefined;
    let lastOutAt: number | undefined;
    let idleTimer: NodeJS.Timeout | undefined;

    const finish = () => {
      if (idleTimer) clearTimeout(idleTimer);
      try {
        proc.kill();
      } catch {
        // ignore
      }

      const t1 = firstOutAt == null ? burstIdleMs : firstOutAt;
      const t2 = lastOutAt == null ? burstIdleMs : lastOutAt;
      resolve({
        method: "pty-cat",
        t1Ms: t1,
        t2Ms: t2,
        burstIdleMs,
        notes: "Measures proxy + PTY + cat round-trip baseline; used as a rough lower bound.",
      });
    };

    proc.onData(() => {
      const now = clock.nowMs();
      if (firstOutAt == null) firstOutAt = now;
      lastOutAt = now;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, burstIdleMs);
    });

    // Kick it with a tiny payload.
    proc.write("x");
    setTimeout(() => proc.write("y"), 1);

    // Safety timeout.
    setTimeout(finish, Math.max(250, burstIdleMs * 4));
  });
}

