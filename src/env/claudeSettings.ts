import fs from "node:fs/promises";

export interface ClaudeSettingsNames {
  mcpServers: string[];
  plugins: string[];
}

function keysOfObject(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function namesFromPlugins(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === "string" ? v : undefined))
      .filter((v): v is string => Boolean(v));
  }
  if (typeof value === "object") return keysOfObject(value);
  return [];
}

export async function readClaudeSettingsNames(settingsPath: string): Promise<ClaudeSettingsNames | undefined> {
  try {
    const raw = await fs.readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    const mcpServers = keysOfObject(parsed["mcpServers"]);
    const plugins = namesFromPlugins(parsed["plugins"]);

    return { mcpServers, plugins };
  } catch {
    return undefined;
  }
}

