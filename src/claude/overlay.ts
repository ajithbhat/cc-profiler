import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface ClaudeOverlay {
  homeDir: string;
  claudeDir: string;
  settingsPath: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function safeRemoveDir(p: string): Promise<void> {
  try {
    await rm(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function symlinkBestEffort(target: string, dest: string, isDir: boolean): Promise<void> {
  if (process.platform === "win32" && !isDir) {
    await copyFile(target, dest);
    return;
  }
  const type = process.platform === "win32" ? "junction" : isDir ? "dir" : "file";
  await symlink(target, dest, type as any);
}

export interface CreateClaudeOverlayOptions {
  disableMcps: boolean;
}

export async function createClaudeOverlay(opts: CreateClaudeOverlayOptions): Promise<ClaudeOverlay> {
  const realHome = os.homedir();
  const realClaudeDir = path.join(realHome, ".claude");
  if (!(await pathExists(realClaudeDir))) {
    throw new Error(`Claude config directory not found at ${realClaudeDir}`);
  }

  const overlayHome = await mkdtemp(path.join(os.tmpdir(), "cc-profiler-home-"));
  const overlayClaudeDir = path.join(overlayHome, ".claude");
  await mkdir(overlayClaudeDir, { recursive: true });

  const entries = await readdir(realClaudeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "settings.json") continue;
    const src = path.join(realClaudeDir, entry.name);
    const dst = path.join(overlayClaudeDir, entry.name);
    try {
      await symlinkBestEffort(src, dst, entry.isDirectory());
    } catch (err) {
      await safeRemoveDir(overlayHome);
      throw new Error(`Failed to mirror Claude config entry '${entry.name}': ${String(err)}`);
    }
  }

  const realSettingsPath = path.join(realClaudeDir, "settings.json");
  const overlaySettingsPath = path.join(overlayClaudeDir, "settings.json");

  let settingsObj: Record<string, unknown> = {};
  if (await pathExists(realSettingsPath)) {
    const raw = await readFile(realSettingsPath, "utf8");
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        settingsObj = parsed as Record<string, unknown>;
      }
    } catch {
      // ignore parse errors; write minimal file below
    }
  }

  if (opts.disableMcps) settingsObj["mcpServers"] = {};

  await writeFile(overlaySettingsPath, JSON.stringify(settingsObj, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });

  const env: NodeJS.ProcessEnv = { ...process.env };
  env.HOME = overlayHome;
  if (process.platform === "win32") {
    env.USERPROFILE = overlayHome;
  }

  return {
    homeDir: overlayHome,
    claudeDir: overlayClaudeDir,
    settingsPath: overlaySettingsPath,
    env,
    cleanup: async () => safeRemoveDir(overlayHome),
  };
}
