import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(__filename);

function isExecutable(mode: number): boolean {
  // Any execute bit set (user/group/other).
  return (mode & 0o111) !== 0;
}

export async function ensureNodePtySpawnHelperExecutable(): Promise<void> {
  if (process.platform !== "darwin") return;

  const nodePtyMain = require.resolve("node-pty");
  const nodePtyDir = path.resolve(path.dirname(nodePtyMain), "..");
  const spawnHelperPath = path.join(nodePtyDir, "prebuilds", `darwin-${process.arch}`, "spawn-helper");

  const st = await fs.stat(spawnHelperPath);
  const mode = st.mode & 0o777;
  if (isExecutable(mode)) return;

  await fs.chmod(spawnHelperPath, 0o755);
}

