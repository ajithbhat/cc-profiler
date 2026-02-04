import os from "node:os";
import { execFile } from "node:child_process";
import path from "node:path";

import type { EnvironmentInfo } from "../session/schema";
import { isClaudeCommand } from "../claude/isClaude";
import { sha256Hex } from "../util/hash";
import { getParentProcessName } from "./parentProcess";
import { readClaudeSettingsNames } from "./claudeSettings";

function execFileText(cmd: string, args: string[], timeoutMs: number, env?: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, env }, (err, stdout, stderr) => {
      if (err) return reject(err);
      const combined = `${stdout ?? ""}${stderr ?? ""}`.trim();
      resolve(combined);
    });
  });
}

async function tryGetClaudeVersion(binaryPath: string, env?: NodeJS.ProcessEnv): Promise<string | undefined> {
  try {
    const text = await execFileText(binaryPath, ["--version"], 2000, env);
    return text || undefined;
  } catch {
    return undefined;
  }
}

export interface DiscoverEnvironmentOptions {
  command: string[];
  claudeSettingsPath?: string;
  effectiveMcpsDisabled?: boolean;
  envForVersionProbe?: NodeJS.ProcessEnv;
  unsafeStorePaths?: boolean;
}

export async function discoverEnvironment(opts: DiscoverEnvironmentOptions): Promise<EnvironmentInfo> {
  const cpus = os.cpus();
  const cpuModel = cpus?.[0]?.model;
  const cpuCores = cpus?.length;

  const parentProcessNameRaw = await getParentProcessName(process.ppid);
  const parentProcessName =
    opts.unsafeStorePaths || !parentProcessNameRaw ? parentProcessNameRaw : path.basename(parentProcessNameRaw);

  const envInfo: EnvironmentInfo = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    pid: process.pid,
    startedAtIso: new Date().toISOString(),
    os: {
      type: os.type(),
      release: os.release(),
      version: typeof (os as any).version === "function" ? (os as any).version() : undefined,
    },
    terminal: {
      term: process.env.TERM,
      termProgram: process.env.TERM_PROGRAM,
      colorterm: process.env.COLORTERM,
      parentProcessName,
    },
    machine: {
      cpuModel,
      cpuCores,
      totalMemBytes: os.totalmem(),
    },
  };

  const cmd0 = opts.command[0];
  const looksLikeClaude = isClaudeCommand(cmd0);
  if (!looksLikeClaude && !opts.claudeSettingsPath) return envInfo;

  const settingsPath =
    opts.claudeSettingsPath ??
    path.join(os.homedir(), ".claude", "settings.json");

  const names = await readClaudeSettingsNames(settingsPath);

  const versionText = looksLikeClaude ? await tryGetClaudeVersion(cmd0, opts.envForVersionProbe) : undefined;

  envInfo.claude = {
    binaryName: looksLikeClaude && cmd0 ? path.basename(cmd0) : undefined,
    binaryPathSha256: looksLikeClaude && cmd0 ? sha256Hex(cmd0) : undefined,
    binaryPath: opts.unsafeStorePaths && looksLikeClaude ? cmd0 : undefined,
    versionText,
    settingsPathSha256: sha256Hex(settingsPath),
    settingsPath: opts.unsafeStorePaths ? settingsPath : undefined,
    mcpServers: names?.mcpServers,
    plugins: names?.plugins,
    effectiveMcpsDisabled: opts.effectiveMcpsDisabled,
  };

  return envInfo;
}
