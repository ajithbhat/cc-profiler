import path from "node:path";

export function isClaudeCommand(command0: string | undefined): boolean {
  if (!command0) return false;
  const base = path.basename(command0).toLowerCase();
  return base === "claude" || base === "claude.exe";
}

