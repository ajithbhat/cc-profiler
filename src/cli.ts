import { Command } from "commander";
import fs from "node:fs/promises";
import path from "node:path";

import { isClaudeCommand } from "./claude/isClaude";
import { parseDurationToMs } from "./util/duration";
import { runSession } from "./session/runSession";
import { readActiveSession } from "./session/activeSession";
import { appendMarker } from "./session/markers";
import { generateReportHtml } from "./report/generate";
import type { SessionData } from "./session/schema";

const DEFAULT_BURST_IDLE_MS = 30;
const DEFAULT_SAMPLE_INTERVAL_MS = 100;
const DEFAULT_INTERACTION_TIMEOUT_MS = 2000;

function addRunOptions(cmd: Command): Command {
  return cmd
    .option("--output <dir>", "Output directory (default: new session dir)")
    .option("--cwd <dir>", "Working directory", process.cwd())
    .option("--binary <path>", "Path to claude binary (shorthand for replacing the first arg when running claude)")
    .option("--jsonl-path <path>", "Override Claude session JSONL path to track (size only)")
    .option("--turn-hotkey <spec>", "Manual turn hotkey: alt+t|off", "alt+t")
    .option("--duration <duration>", "Auto-stop after duration (e.g. 5m, 30s)")
    .option("--burst-idle-ms <ms>", "Idle gap (ms) to end a burst", String(DEFAULT_BURST_IDLE_MS))
    .option("--sample-interval-ms <ms>", "Process sampling interval (ms)", String(DEFAULT_SAMPLE_INTERVAL_MS))
    .option(
      "--interaction-timeout-ms <ms>",
      "Timeout (ms) for interactions that never produce output",
      String(DEFAULT_INTERACTION_TIMEOUT_MS),
    )
    .option("--disable-mcps", "Run with MCP servers disabled (settings overlay; does not modify your real settings)")
    .option(
      "--correlate-jsonl",
      "Parse Claude session JSONL to extract metadata (no content stored); best-effort correlation to turn index",
    )
    .option("--unsafe-store-paths", "Store plaintext paths (cwd/output/settings) in data.json (NOT shareable)")
    .option("--unsafe-store-command", "Store plaintext command + args in data.json (NOT shareable)")
    .option("--unsafe-store-errors", "Store full error strings in warnings (may include paths)");
}

async function runAction(command: string[], _options: any, cmdObj: Command) {
  const options = cmdObj.optsWithGlobals();
  const cmd = command.length ? command : ["claude"];
  if (options.binary && isClaudeCommand(cmd[0])) {
    cmd[0] = path.resolve(options.binary);
  }
  const cwd = path.resolve(options.cwd);
  const outputDir = options.output ? path.resolve(options.output) : undefined;
  const durationMs = options.duration ? parseDurationToMs(options.duration) : undefined;

  const burstIdleMs = Number(options.burstIdleMs);
  const sampleIntervalMs = Number(options.sampleIntervalMs);
  const interactionTimeoutMs = Number(options.interactionTimeoutMs);

  const result = await runSession({
    command: cmd,
    cwd,
    outputDir,
    jsonlPath: options.jsonlPath ? path.resolve(options.jsonlPath) : undefined,
    durationMs,
    burstIdleMs,
    sampleIntervalMs,
    interactionTimeoutMs,
    turnHotkey: options.turnHotkey === "off" ? "off" : "alt+t",
    disableMcps: Boolean(options.disableMcps),
    correlateJsonl: Boolean(options.correlateJsonl),
    unsafeStorePaths: Boolean(options.unsafeStorePaths),
    unsafeStoreCommand: Boolean(options.unsafeStoreCommand),
    unsafeStoreErrors: Boolean(options.unsafeStoreErrors),
  });

  // eslint-disable-next-line no-console
  console.error(
    `\ncc-profiler session complete\n- Output: ${result.outputDir}\n- Data:   ${result.dataPath}\n- Report: ${result.reportPath}\n`,
  );
}

async function main() {
  const program = new Command();
  program.name("cc-profiler").description("External profiling harness for Claude Code TUI");

  addRunOptions(program)
    .argument("[command...]", "Command to run under PTY (default: claude)")
    .action(runAction);

  addRunOptions(
    program
      .command("run")
      .description("Run a command under the profiler (same as default command)"),
  )
    .argument("[command...]", "Command to run under PTY (default: claude)")
    .action(runAction);

  program
    .command("report")
    .description("Generate report.html from a data.json file")
    .argument("<dataPath>", "Path to data.json")
    .option("--out <path>", "Output HTML path (default: alongside data.json)")
    .action(async (dataPath: string, options) => {
      const abs = path.resolve(dataPath);
      const raw = await fs.readFile(abs, "utf8");
      const session = JSON.parse(raw) as SessionData;
      const html = await generateReportHtml(session);
      const outPath = options.out ? path.resolve(options.out) : path.join(path.dirname(abs), "report.html");
      await fs.writeFile(outPath, html, "utf8");
      // eslint-disable-next-line no-console
      console.error(`Wrote ${outPath}`);
    });

  program
    .command("mark")
    .description("Add a marker to the active profiling session")
    .argument("[label]", "Optional marker label (hashed by default)")
    .option("--unsafe-plaintext-label", "Store label plaintext in data bundle (not recommended)")
    .action(async (label: string | undefined, options) => {
      const active = await readActiveSession();
      const tMs = Date.now() - active.startedAtMsEpoch;
      await appendMarker({
        markersPath: active.markersPath,
        tMs,
        label,
        storePlaintextLabel: Boolean(options.unsafePlaintextLabel),
      });
      // eslint-disable-next-line no-console
      console.error(`Marker recorded at t=${Math.round(tMs)}ms`);
    });

  await program.parseAsync(process.argv);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
