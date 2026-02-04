import fs from "node:fs/promises";
import path from "node:path";
import * as pty from "node-pty";

import { isClaudeCommand } from "../claude/isClaude";
import { createClaudeOverlay } from "../claude/overlay";
import { discoverEnvironment } from "../env/discover";
import { startProcessMonitor } from "../metrics/monitor";
import { calibratePtyOverhead } from "../pty/calibrate";
import { InteractionTracker } from "../pty/interactionTracker";
import { ensureNodePtySpawnHelperExecutable } from "../pty/nodePtyFixes";
import { generateReportHtml } from "../report/generate";
import { createMonotonicClock } from "../util/clock";
import { sha256Hex } from "../util/hash";
import { defaultSessionDirName } from "../util/paths";
import { clearActiveSession, writeActiveSession } from "./activeSession";
import { startMarkerWatcher } from "./markerWatcher";
import { JsonlTracker } from "./jsonlTracker";
import type { SessionConfig, SessionData } from "./schema";

export interface RunSessionOptions {
  command: string[];
  cwd: string;
  outputDir?: string;
  jsonlPath?: string;
  burstIdleMs: number;
  interactionTimeoutMs: number;
  sampleIntervalMs: number;
  turnHotkey: "alt+t" | "off";
  durationMs?: number;
  disableMcps: boolean;
  unsafeStorePaths: boolean;
  unsafeStoreCommand: boolean;
  unsafeStoreErrors: boolean;
}

async function ensureDir(p: string): Promise<void> {
  await fs.mkdir(p, { recursive: true });
}

async function writeJson(p: string, value: unknown): Promise<void> {
  await fs.writeFile(p, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export interface RunSessionResult {
  outputDir: string;
  dataPath: string;
  reportPath: string;
}

export async function runSession(opts: RunSessionOptions): Promise<RunSessionResult> {
  if (!opts.command[0]) throw new Error("No command specified");

  const clock = createMonotonicClock();
  const startedAtIso = new Date(clock.startedAtMsEpoch).toISOString();

  const resolvedCwd = path.resolve(opts.cwd);
  const outputDir = path.resolve(opts.outputDir ?? path.join(resolvedCwd, defaultSessionDirName()));
  await ensureDir(outputDir);

  const markersPath = path.join(outputDir, "markers.jsonl");
  const dataPath = path.join(outputDir, "data.json");
  const reportPath = path.join(outputDir, "report.html");

  await fs.writeFile(markersPath, "", "utf8");

  await writeActiveSession({
    schemaVersion: "1",
    outputDir,
    markersPath,
    startedAtIso,
    startedAtMsEpoch: clock.startedAtMsEpoch,
  });

  const warnings: string[] = [];
  const warn = (message: string, err?: unknown) => {
    if (!err) {
      warnings.push(message);
      return;
    }
    if (opts.unsafeStoreErrors) {
      warnings.push(`${message}: ${String(err)}`);
      return;
    }

    const code = typeof (err as any)?.code === "string" ? String((err as any).code) : undefined;
    const name = typeof (err as any)?.name === "string" ? String((err as any).name) : "Error";
    warnings.push(code ? `${message} (${name}:${code})` : `${message} (${name})`);
  };

  let overlay: Awaited<ReturnType<typeof createClaudeOverlay>> | undefined;
  let spawnEnv = process.env as NodeJS.ProcessEnv;
  let session: SessionData | undefined;
  let jsonlTracker: JsonlTracker | undefined;

  let markerWatcher: { stop: () => void } | undefined;
  let monitor: { stop: () => void } | undefined;
  let tracker: InteractionTracker | undefined;
  let child: pty.IPty | undefined;

  let onStdinData: ((buf: Buffer) => void) | undefined;
  let onSigint: (() => void) | undefined;
  let cleanupTty: (() => void) | undefined;
  let durationTimer: NodeJS.Timeout | undefined;

  let finalized = false;
  const finalize = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;

    try {
      tracker?.endSession();
    } catch {
      // ignore
    }

    try {
      monitor?.stop();
    } catch {
      // ignore
    }

    try {
      markerWatcher?.stop();
    } catch {
      // ignore
    }

    try {
      cleanupTty?.();
    } catch {
      // ignore
    }

    if (onStdinData) process.stdin.off("data", onStdinData);
    if (onSigint) process.off("SIGINT", onSigint);

    try {
      child?.kill();
    } catch {
      // ignore
    }

    await clearActiveSession();
    if (overlay) await overlay.cleanup();

    if (!session) return;
    session.endedAtIso = new Date().toISOString();

    if (jsonlTracker) {
      session.jsonl = {
        activePathSha256: jsonlTracker.getActivePathSha256(),
        samples: jsonlTracker.getSamples(),
      };
    }

    let html: string | undefined;
    try {
      html = await generateReportHtml(session);
    } catch (err) {
      warn("Failed to generate HTML report", err);
    }

    await writeJson(dataPath, session);
    if (html) await fs.writeFile(reportPath, html, "utf8");
  };

  try {
    try {
      await ensureNodePtySpawnHelperExecutable();
    } catch (err) {
      warn("node-pty spawn-helper fix failed", err);
    }

    if (opts.disableMcps) overlay = await createClaudeOverlay({ disableMcps: true });
    spawnEnv = (overlay?.env ?? process.env) as NodeJS.ProcessEnv;

    const envInfo = await discoverEnvironment({
      command: opts.command,
      claudeSettingsPath: overlay?.settingsPath,
      effectiveMcpsDisabled: opts.disableMcps,
      envForVersionProbe: spawnEnv,
      unsafeStorePaths: opts.unsafeStorePaths,
    });

    const commandName = path.basename(opts.command[0] ?? "");
    const argsCount = Math.max(0, opts.command.length - 1);
    const commandSha256 = sha256Hex(JSON.stringify(opts.command));
    const cwdSha256 = sha256Hex(resolvedCwd);
    const outputDirSha256 = sha256Hex(outputDir);

    const sessionConfig: SessionConfig = {
      commandName,
      argsCount,
      commandSha256,
      cwdSha256,
      outputDirSha256,
      burstIdleMs: opts.burstIdleMs,
      interactionTimeoutMs: opts.interactionTimeoutMs,
      sampleIntervalMs: opts.sampleIntervalMs,
      durationMs: opts.durationMs,
      turnDetection: "enter",
      turnHotkey: opts.turnHotkey,
      disableMcps: opts.disableMcps,
    };

    if (opts.unsafeStoreCommand || opts.unsafeStorePaths) {
      sessionConfig.unsafe = {};
      if (opts.unsafeStoreCommand) sessionConfig.unsafe.command = opts.command;
      if (opts.unsafeStorePaths) {
        sessionConfig.unsafe.cwd = resolvedCwd;
        sessionConfig.unsafe.outputDir = outputDir;
      }
    }

    session = {
      schemaVersion: "2",
      createdAtIso: new Date().toISOString(),
      startedAtIso,
      config: sessionConfig,
      environment: envInfo,
      turns: [],
      interactions: [],
      markers: [],
      samples: [],
      warnings,
    };

    jsonlTracker = isClaudeCommand(opts.command[0])
      ? new JsonlTracker({ startedAtMsEpoch: clock.startedAtMsEpoch, overridePath: opts.jsonlPath })
      : undefined;

    try {
      session.calibration = await calibratePtyOverhead(opts.burstIdleMs);
    } catch (err) {
      warn("Calibration failed", err);
    }

    markerWatcher = startMarkerWatcher({
      markersPath,
      startedAtMsEpoch: clock.startedAtMsEpoch,
      pollIntervalMs: 250,
      onMarker: (m) => session?.markers.push(m),
    });

    tracker = new InteractionTracker({
      burstIdleMs: opts.burstIdleMs,
      interactionTimeoutMs: opts.interactionTimeoutMs,
      turnDetection: "enter",
      nowMs: clock.nowMs,
      onTurn: (t) => {
        session?.turns.push(t);
        if (jsonlTracker) void jsonlTracker.recordOnTurn(t);
      },
      onInteraction: (i) => session?.interactions.push(i),
    });

    const termName = process.env.TERM || "xterm-256color";
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;

    child = pty.spawn(opts.command[0], opts.command.slice(1), {
      name: termName,
      cols,
      rows,
      cwd: resolvedCwd,
      env: spawnEnv,
    });

    monitor = startProcessMonitor({
      pid: child.pid,
      sampleIntervalMs: opts.sampleIntervalMs,
      nowMs: clock.nowMs,
      onSample: (s) => session?.samples.push(s),
      onExit: () => warn("Process monitor stopped (process may have exited)"),
    });

    const previousRawMode = process.stdin.isTTY ? process.stdin.isRaw : undefined;
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    const resize = () => {
      try {
        const c = process.stdout.columns || cols;
        const r = process.stdout.rows || rows;
        child?.resize(c, r);
      } catch {
        // ignore
      }
    };

    const onSigwinch = () => resize();
    const onStdoutResize = () => resize();
    if (process.platform !== "win32") process.on("SIGWINCH", onSigwinch);
    if (process.stdout.isTTY) process.stdout.on("resize", onStdoutResize);

    cleanupTty = () => {
      if (process.platform !== "win32") process.off("SIGWINCH", onSigwinch);
      if (process.stdout.isTTY) process.stdout.off("resize", onStdoutResize);
      if (process.stdin.isTTY && previousRawMode !== undefined) {
        try {
          process.stdin.setRawMode(previousRawMode);
        } catch {
          // ignore
        }
      }
      process.stdin.pause();
    };

    durationTimer =
      typeof opts.durationMs === "number" && Number.isFinite(opts.durationMs) && opts.durationMs > 0
        ? setTimeout(() => {
            warn(`Session duration reached (${opts.durationMs}ms); terminating target process.`);
            try {
              child?.kill();
            } catch {
              // ignore
            }
          }, opts.durationMs)
        : undefined;

    return await new Promise<RunSessionResult>((resolve, reject) => {
      let exitHandled = false;
      const p = child!;
      const t = tracker!;

      const onData = (data: string) => {
        process.stdout.write(data);
        t.handleOutput(Buffer.byteLength(data, "utf8"));
      };
      p.onData(onData);

      const onExit = async (code?: number) => {
        if (exitHandled) return;
        exitHandled = true;
        if (durationTimer) clearTimeout(durationTimer);
        if (typeof code === "number" && code !== 0) warn(`Target exited with code ${code}`);
        try {
          await finalize();
          resolve({ outputDir, dataPath, reportPath });
        } catch (err) {
          reject(err);
        }
      };

      // node-pty exit signature differs by platform/version; be defensive.
      (p as any).onExit?.(({ exitCode }: { exitCode: number }) => void onExit(exitCode));
      (p as any).on?.("exit", (code: number) => void onExit(code));

      onStdinData = (buf: Buffer) => {
        const str = buf.toString("utf8");
        if (opts.turnHotkey === "alt+t" && (str === "\u001bt" || str === "\u001bT")) {
          // Manual override: mark a turn boundary without sending input to the child.
          t.markTurn("hotkey");
          return;
        }
        t.handleInput(str, Buffer.byteLength(str, "utf8"));
        try {
          p.write(str);
        } catch {
          // ignore
        }
      };
      process.stdin.on("data", onStdinData);

      onSigint = () => {
        warn("SIGINT received; terminating session.");
        try {
          p.kill();
        } catch {
          // ignore
        }
      };
      process.on("SIGINT", onSigint);
    });
  } catch (err) {
    warn("Session failed", err);
    try {
      await finalize();
    } catch {
      // ignore
    }
    throw err;
  } finally {
    if (durationTimer) clearTimeout(durationTimer);
  }
}
